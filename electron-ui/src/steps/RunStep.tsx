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
  ReferenceLine,
} from "recharts";
import { AlertTriangle, CheckCircle, TrendingDown, Clock } from "lucide-react";
import LogViewer from "../components/LogViewer";
import { useStatus } from "../hooks/useStatus";
import { runCommands, connectLogs, getJobStatus, cancelJob, getConfig, getSuggestions } from "../api";
import { useStopwatch, formatElapsed } from "../hooks/useStopwatch";
import type { ConvergencePrediction } from "../types";

interface StepProps {
  caseName: string | null;
  setCaseName: (name: string) => void;
  templateName: string | null;
  setTemplateName: (name: string) => void;
  goNext: () => void;
  goBack: () => void;
  completeStep: (step: number) => void;
  velocity: number;
  setVelocity: (v: number) => void;
  geometryClass: string | null;
  setGeometryClass: (c: string | null) => void;
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

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "var(--success)",
  medium: "var(--warning)",
  low: "var(--error)",
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

// Detect NaN residuals (divergence)
function hasNaN(line: string): boolean {
  return /residual\s*=\s*nan/i.test(line) || /\bnan\b/i.test(line);
}

export default function RunStep({
  caseName,
  goNext,
  goBack,
  completeStep,
  velocity,
  geometryClass,
}: StepProps) {
  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [residuals, setResiduals] = useState<ResidualPoint[]>([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const stopwatch = useStopwatch();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setWorking, setElapsed } = useStatus();

  // Convergence predictor state
  const [prediction, setPrediction] = useState<ConvergencePrediction | null>(null);
  const [liveStatus, setLiveStatus] = useState<string>("pending");
  const [diverged, setDiverged] = useState(false);

  // Sync running state and elapsed time to global status bar
  useEffect(() => {
    setWorking(running);
    return () => setWorking(false);
  }, [running, setWorking]);

  useEffect(() => {
    setElapsed(stopwatch.elapsed);
  }, [stopwatch.elapsed, setElapsed]);

  // Fetch convergence prediction
  useEffect(() => {
    if (!caseName || velocity <= 0) return;
    let cancelled = false;
    getSuggestions(caseName, velocity, geometryClass ?? undefined)
      .then((s) => { if (!cancelled) setPrediction(s.convergence); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [caseName, velocity, geometryClass]);

  // Live convergence status detection
  useEffect(() => {
    if (residuals.length < 10) return;
    const recent = residuals.slice(-10);
    const pValues = recent.map((r) => r.p).filter((v): v is number => v !== undefined);
    if (pValues.length < 5) return;

    // Check for NaN (diverged)
    if (pValues.some((v) => isNaN(v))) {
      setLiveStatus("diverged");
      setDiverged(true);
      return;
    }

    // Check if residuals are decreasing (converging)
    const first5 = pValues.slice(0, 5);
    const last5 = pValues.slice(-5);
    const avgFirst = first5.reduce((a, b) => a + b, 0) / first5.length;
    const avgLast = last5.reduce((a, b) => a + b, 0) / last5.length;

    if (avgLast < avgFirst * 0.8) {
      setLiveStatus("converging");
    } else if (avgLast > avgFirst * 1.5) {
      setLiveStatus("diverged");
      setDiverged(true);
    } else {
      setLiveStatus("stalled");
    }
  }, [residuals]);

  // Buffer for log lines to avoid overwhelming React
  const lineBufferRef = useRef<string[]>([]);
  const residualBufferRef = useRef<ResidualPoint>({ iteration: 0 });
  const iterationRef = useRef(0);

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
    setDiverged(false);
    setLiveStatus("pending");
    lineBufferRef.current = [];
    iterationRef.current = 0;
    stopwatch.start();

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

        // Check for NaN divergence
        if (hasNaN(line)) {
          setDiverged(true);
          setLiveStatus("diverged");
        }

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
            stopwatch.stop();
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
              // Toast notification
              if ("Notification" in window && Notification.permission === "granted") {
                new Notification("FoamPilot", { body: "Solver run complete" });
              }
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
      stopwatch.stop();
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
    stopwatch.stop();
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

  const statusIcon = {
    pending: <Clock size={14} style={{ color: "var(--fg-muted)" }} />,
    converging: <TrendingDown size={14} style={{ color: "var(--success)" }} />,
    stalled: <AlertTriangle size={14} style={{ color: "var(--warning)" }} />,
    diverged: <AlertTriangle size={14} style={{ color: "var(--error)" }} />,
    completed: <CheckCircle size={14} style={{ color: "var(--success)" }} />,
  }[finished ? "completed" : liveStatus] ?? null;

  const statusLabel = finished ? "Completed" : {
    pending: "Waiting for data...",
    converging: "Converging",
    stalled: "Stalled — residuals not decreasing",
    diverged: "Diverged — NaN residuals detected",
  }[liveStatus] ?? "Unknown";

  return (
    <div className="flex flex-col h-full">
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, marginBottom: 4, color: "var(--fg)" }}>Run Simulation</h2>
      <p className="text-[var(--fg-muted)] text-[13px] mb-6">
        Start the solver, monitor convergence, and track progress in real
        time.
      </p>

      {error && (
        <div className="text-[var(--error)] text-[13px] mb-4">{error}</div>
      )}

      {/* Convergence predictor card */}
      {prediction && (
        <div
          className="p-4 mb-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {statusIcon}
              <span className="text-[13px] font-semibold" style={{ color: "var(--fg)" }}>
                Convergence: {statusLabel}
              </span>
            </div>
            <span
              className="text-[11px] px-2 py-0.5"
              style={{
                background: `${CONFIDENCE_COLORS[prediction.confidence]}20`,
                color: CONFIDENCE_COLORS[prediction.confidence],
                border: `1px solid ${CONFIDENCE_COLORS[prediction.confidence]}40`,
              }}
            >
              {prediction.confidence} confidence
            </span>
          </div>

          {!running && !finished && (
            <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
              Expected ~{prediction.expected_iterations} iterations to converge.
            </p>
          )}

          {running && currentIteration > 0 && prediction.expected_iterations > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-1.5" style={{ background: "var(--bg-elevated)" }}>
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, (currentIteration / prediction.expected_iterations) * 100)}%`,
                      background: diverged ? "var(--error)" : "var(--accent)",
                    }}
                  />
                </div>
                <span className="text-[11px]" style={{ color: "var(--fg-muted)" }}>
                  {currentIteration}/{prediction.expected_iterations}
                </span>
              </div>
            </div>
          )}

          {prediction.risk_factors.length > 0 && (
            <div className="mt-2">
              {prediction.risk_factors.map((risk, i) => (
                <p key={i} className="text-[11px] flex items-center gap-1" style={{ color: "var(--fg-muted)" }}>
                  <span style={{ color: "var(--warning)" }}>!</span> {risk}
                </p>
              ))}
            </div>
          )}
        </div>
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
              <Legend wrapperStyle={{ fontSize: 12 }} align="left" verticalAlign="bottom" />
              {prediction && (
                <ReferenceLine
                  y={prediction.convergence_target ?? 1e-4}
                  stroke="var(--success)"
                  strokeDasharray="5 5"
                  label={{ value: "target", fill: "var(--success)", fontSize: 10, position: "right" }}
                />
              )}
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

      {/* Divergence warning */}
      {diverged && (
        <div
          className="p-3 mb-4 flex items-center gap-2 text-[13px]"
          style={{
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "var(--error)",
          }}
        >
          <AlertTriangle size={14} />
          Divergence detected (NaN residuals). Consider reducing relaxation factors or checking mesh quality.
        </div>
      )}

      {/* Log output */}
      {logLines.length > 0 && (
        <div className="flex-1 min-h-0 mt-4 overflow-hidden">
          <LogViewer lines={logLines} className="h-full" />
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
