import { useState, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { runCommands, connectLogs, getJobStatus, cancelJob, getConfig } from "../api";

interface StepProps {
  caseName: string | null;
  setCaseName: (name: string) => void;
  templateName: string | null;
  setTemplateName: (name: string) => void;
  goNext: () => void;
  goBack: () => void;
  completeStep: (step: number) => void;
}

interface ResidualPoint {
  iteration: number;
  Ux?: number;
  Uy?: number;
  Uz?: number;
  p?: number;
  k?: number;
  omega?: number;
  [key: string]: number | undefined;
}

const FIELD_COLORS: Record<string, string> = {
  Ux: "#3794ff",
  Uy: "#c586c0",
  Uz: "#4ec9b0",
  p: "var(--error)",
  k: "var(--warning)",
  omega: "var(--success)",
};

// Parse: "Solving for Ux, Initial residual = 0.123, Final residual = 0.00456"
function parseResidualLine(
  line: string,
): { field: string; initial: number } | null {
  const match = line.match(
    /Solving for (\w+), Initial residual = ([0-9.eE+-]+)/,
  );
  if (!match) return null;
  return { field: match[1], initial: parseFloat(match[2]) };
}

// Parse: "Time = 42"
function parseTimeStep(line: string): number | null {
  const match = line.match(/^Time = (\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export default function RunStep({
  caseName,
  goNext,
  goBack,
  completeStep,
}: StepProps) {
  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [residuals, setResiduals] = useState<ResidualPoint[]>([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Buffer for log lines to avoid overwhelming React
  const lineBufferRef = useRef<string[]>([]);
  const residualBufferRef = useRef<ResidualPoint>({ iteration: 0 });
  const iterationRef = useRef(0);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  // Flush buffer every 200ms
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      if (lineBufferRef.current.length > 0) {
        const newLines = [...lineBufferRef.current];
        lineBufferRef.current = [];
        setLogLines((prev) => [...prev, ...newLines]);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [running]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startSolver = async () => {
    if (!caseName) return;
    setError(null);
    setRunning(true);
    setLogLines([]);
    setResiduals([]);
    setCurrentIteration(0);
    setFinished(false);
    lineBufferRef.current = [];
    iterationRef.current = 0;

    const cores = getConfig().cores;

    const commands = [
      "decomposePar -force",
      "mpirun -np " + cores + " --oversubscribe simpleFoam -parallel",
      "reconstructPar",
    ];

    try {
      const job = await runCommands(caseName, commands);
      setCurrentJobId(job.job_id);

      const ws = connectLogs(job.job_id, (line) => {
        lineBufferRef.current.push(line);

        // Parse time step
        const timeStep = parseTimeStep(line);
        if (timeStep !== null) {
          iterationRef.current = timeStep;
          setCurrentIteration(timeStep);
          residualBufferRef.current = { iteration: timeStep };
        }

        // Parse residual
        const residual = parseResidualLine(line);
        if (residual && iterationRef.current > 0) {
          residualBufferRef.current = {
            ...residualBufferRef.current,
            iteration: iterationRef.current,
            [residual.field]: residual.initial,
          };

          // Flush the point when we see the pressure residual (usually last)
          if (residual.field === "p") {
            const point = { ...residualBufferRef.current };
            setResiduals((prev) => [...prev, point]);
          }
        }
      });
      wsRef.current = ws;

      // Poll job status
      pollRef.current = setInterval(async () => {
        try {
          const status = await getJobStatus(job.job_id);
          if (
            status.status === "completed" ||
            status.status === "failed" ||
            status.status === "cancelled"
          ) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRunning(false);
            setCurrentJobId(null);
            ws.close();
            wsRef.current = null;

            // Flush remaining buffer
            if (lineBufferRef.current.length > 0) {
              setLogLines((prev) => [
                ...prev,
                ...lineBufferRef.current,
              ]);
              lineBufferRef.current = [];
            }

            if (status.status === "completed") {
              setFinished(true);
            } else if (status.status === "cancelled") {
              setError("Solver run cancelled.");
            } else {
              setError(
                "Solver run failed. Check the log output for details.",
              );
            }
          }
        } catch {
          // Ignore transient poll errors
        }
      }, 2000);
    } catch (e: unknown) {
      setRunning(false);
      setError(
        e instanceof Error ? e.message : "Failed to start solver",
      );
    }
  };

  const cancelRun = async () => {
    if (currentJobId) {
      try { await cancelJob(currentJobId); } catch {}
    }
    wsRef.current?.close();
    wsRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setRunning(false);
    setCurrentJobId(null);
    setError("Solver run cancelled.");
    if (lineBufferRef.current.length > 0) {
      setLogLines((prev) => [...prev, ...lineBufferRef.current]);
      lineBufferRef.current = [];
    }
  };

  const handleNext = () => {
    completeStep(4);
    goNext();
  };

  // Determine which fields are present in residuals
  const activeFields = new Set<string>();
  for (const pt of residuals) {
    for (const key of Object.keys(pt)) {
      if (key !== "iteration") activeFields.add(key);
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, marginBottom: 4, color: "var(--fg)" }}>Run Simulation</h2>
      <p className="text-[var(--fg-muted)] text-[13px] mb-6">
        Start the solver, monitor convergence, and track progress in real
        time.
      </p>

      {error && (
        <div className="text-[var(--error)] text-[13px] mb-4">{error}</div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4 mb-4">
        {!running && !finished && (
          <button
            onClick={startSolver}
            disabled={!caseName}
            className="hover:bg-[var(--accent-hover)] px-6 py-2 rounded-sm font-semibold text-[13px]"
            style={{ backgroundColor: "var(--accent)", color: "#09090B" }}
          >
            Start Solver
          </button>
        )}
        {running && (
          <>
            <button
              onClick={cancelRun}
              className="hover:bg-[var(--danger-hover)] text-white px-6 py-2 rounded-sm font-semibold text-[13px]"
              style={{ backgroundColor: "var(--danger)" }}
            >
              Stop
            </button>
            <span className="text-[var(--fg-muted)] text-[13px] animate-amber-dot">
              Running... iteration {currentIteration}
            </span>
          </>
        )}
        {finished && (
          <span className="text-[var(--success)] text-[13px] font-semibold animate-amber-dot">
            Solver completed at iteration {currentIteration}
          </span>
        )}
      </div>

      {/* Convergence chart */}
      {residuals.length > 1 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] p-4 mb-4" style={{ borderRadius: 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)", marginBottom: 12 }}>Convergence</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={residuals}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="iteration"
                stroke="var(--fg-muted)"
                tick={{ fill: "var(--fg-muted)", fontSize: 11 }}
                label={{
                  value: "Iteration",
                  position: "insideBottom",
                  offset: -5,
                  fill: "var(--fg-muted)",
                }}
              />
              <YAxis
                scale="log"
                domain={["auto", "auto"]}
                stroke="var(--fg-muted)"
                tick={{ fill: "var(--fg-muted)", fontSize: 11 }}
                label={{
                  value: "Residual",
                  angle: -90,
                  position: "insideLeft",
                  fill: "var(--fg-muted)",
                }}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 0,
                }}
                labelStyle={{ color: "var(--fg-muted)" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {[...activeFields].map((field) => (
                <Line
                  key={field}
                  type="monotone"
                  dataKey={field}
                  stroke={FIELD_COLORS[field] ?? "var(--fg-muted)"}
                  dot={false}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Log output */}
      {logLines.length > 0 && (
        <div
          className="border border-[var(--border)] p-3 h-64 overflow-y-auto font-mono text-[13px] text-[var(--fg)]"
          style={{ background: "var(--bg-editor)", borderRadius: 0 }}
        >
          {logLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={goBack}
          disabled={running}
          className="bg-transparent border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--bg-hover)] px-6 py-2 rounded-sm"
        >
          &larr; Back
        </button>
        <button
          onClick={handleNext}
          disabled={!finished}
          className={
            "px-6 py-2 rounded-sm font-semibold text-[13px] " +
            (finished
              ? "hover:bg-[var(--accent-hover)]"
              : "bg-[var(--bg-input)] text-[var(--fg-muted)] cursor-not-allowed")
          }
          style={finished ? { backgroundColor: "var(--accent)", color: "#09090B" } : undefined}
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
