import { useState, useEffect, useRef, useCallback } from "react";
import FoamEditor from "../components/FoamEditor";
import MeshPreview from "../components/MeshPreview";
import LogViewer from "../components/LogViewer";
import { useStatus } from "../hooks/useStatus";
import {
  readFile,
  writeFile,
  runCommands,
  connectLogs,
  getJobStatus,
  getMeshQuality,
  cancelJob,
  getConfig,
} from "../api";
import { useStopwatch, formatElapsed } from "../hooks/useStopwatch";
import type { MeshQuality } from "../types";

interface StepProps {
  caseName: string | null;
  setCaseName: (name: string) => void;
  templateName: string | null;
  setTemplateName: (name: string) => void;
  goNext: () => void;
  goBack: () => void;
  completeStep: (step: number) => void;
}

const MESH_FILES = [
  {
    key: "blockMeshDict",
    path: "system/blockMeshDict",
    label: "blockMeshDict",
  },
  {
    key: "snappyHexMeshDict",
    path: "system/snappyHexMeshDict",
    label: "snappyHexMeshDict",
  },
  {
    key: "surfaceFeatureExtractDict",
    path: "system/surfaceFeatureExtractDict",
    label: "surfaceFeatureExtractDict",
  },
];

export default function MeshStep({
  caseName,
  goNext,
  goBack,
  completeStep,
}: StepProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [meshQuality, setMeshQuality] = useState<MeshQuality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [meshDone, setMeshDone] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const stopwatch = useStopwatch();
  const { setWorking, setElapsed } = useStatus();

  // Sync running state and elapsed time to global status bar
  useEffect(() => {
    setWorking(running);
    return () => setWorking(false);
  }, [running, setWorking]);

  useEffect(() => {
    setElapsed(stopwatch.elapsed);
  }, [stopwatch.elapsed, setElapsed]);

  // Load all files on mount
  useEffect(() => {
    if (!caseName) return;
    setLoading(true);
    Promise.allSettled(
      MESH_FILES.map((f) =>
        readFile(caseName, f.path).then((content) => ({ key: f.key, content })),
      ),
    ).then((results) => {
      const contents: Record<string, string> = {};
      for (const r of results) {
        if (r.status === "fulfilled") {
          contents[r.value.key] = r.value.content;
        }
      }
      setFileContents(contents);
      setLoading(false);
    });
  }, [caseName]);

  const saveFile = useCallback(
    async (key: string) => {
      if (!caseName || !dirty[key]) return;
      const fileDef = MESH_FILES.find((f) => f.key === key);
      if (!fileDef) return;
      try {
        await writeFile(caseName, fileDef.path, fileContents[key]);
        setDirty((d) => ({ ...d, [key]: false }));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to save file");
      }
    },
    [caseName, fileContents, dirty],
  );

  const handleTabChange = async (idx: number) => {
    const currentKey = MESH_FILES[activeTab].key;
    await saveFile(currentKey);
    setActiveTab(idx);
  };

  const handleEditorChange = (value: string | undefined) => {
    const key = MESH_FILES[activeTab].key;
    setFileContents((prev) => ({ ...prev, [key]: value ?? "" }));
    setDirty((d) => ({ ...d, [key]: true }));
  };

  const generateMesh = async () => {
    if (!caseName) return;
    setError(null);
    setRunning(true);
    setLogLines([]);
    setMeshQuality(null);

    // Save all dirty files first
    for (const f of MESH_FILES) {
      if (dirty[f.key]) {
        await writeFile(caseName, f.path, fileContents[f.key]);
        setDirty((d) => ({ ...d, [f.key]: false }));
      }
    }

    stopwatch.start();
    const cores = getConfig().cores;

    const commands = [
      "bash -c 'cat > system/decomposeParDict << ENDOFDICT\nFoamFile { version 2.0; format ascii; class dictionary; object decomposeParDict; }\nnumberOfSubdomains " +
        cores +
        ";\nmethod scotch;\nENDOFDICT'",
      "surfaceFeatureExtract",
      "blockMesh",
      "decomposePar -force",
      "mpirun -np " + cores + " --oversubscribe snappyHexMesh -overwrite -parallel",
      "reconstructParMesh -constant",
    ];

    try {
      const job = await runCommands(caseName, commands);
      setCurrentJobId(job.job_id);
      const ws = connectLogs(job.job_id, (line) => {
        setLogLines((prev) => [...prev, line]);
      });
      wsRef.current = ws;

      // Poll job status
      const poll = setInterval(async () => {
        try {
          const status = await getJobStatus(job.job_id);
          if (
            status.status === "completed" ||
            status.status === "failed" ||
            status.status === "cancelled"
          ) {
            clearInterval(poll);
            setRunning(false);
            setCurrentJobId(null);
            stopwatch.stop();
            ws.close();
            wsRef.current = null;

            if (status.status === "completed") {
              setMeshDone(true);
              try {
                const quality = await getMeshQuality(caseName);
                setMeshQuality(quality);
              } catch {
                // Mesh quality endpoint may not be ready
              }
            } else if (status.status === "cancelled") {
              setError("Mesh generation cancelled.");
            } else {
              setError(
                "Mesh generation failed. Check the log output for details.",
              );
            }
          }
        } catch {
          // Ignore transient poll errors
        }
      }, 2000);
    } catch (e: unknown) {
      setRunning(false);
      setCurrentJobId(null);
      stopwatch.stop();
      setError(
        e instanceof Error ? e.message : "Failed to start mesh generation",
      );
    }
  };

  const handleCancel = async () => {
    if (currentJobId) {
      try { await cancelJob(currentJobId); } catch {}
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setRunning(false);
    setCurrentJobId(null);
    stopwatch.stop();
    setError("Mesh generation cancelled.");
  };

  const handleNext = () => {
    completeStep(1);
    goNext();
  };

  const currentFile = MESH_FILES[activeTab];

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, color: "var(--fg)", fontFamily: "var(--font-display)" }}>Mesh</h2>
      <p style={{ color: "var(--fg-muted)", fontSize: 13, marginBottom: 24 }}>
        Edit mesh dictionaries, then generate the computational mesh.
      </p>

      {error && (
        <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {/* Tab bar */}
      <div
        className="flex mb-4"
        style={{ height: 35, background: "var(--bg-tab-inactive)", borderBottom: "1px solid var(--border)" }}
      >
        {MESH_FILES.map((f, idx) => (
          <button
            key={f.key}
            onClick={() => handleTabChange(idx)}
            className="px-4 text-[13px] transition-colors"
            style={{
              height: 35,
              display: "flex",
              alignItems: "center",
              background: idx === activeTab ? "var(--bg-editor)" : "var(--bg-tab-inactive)",
              color: idx === activeTab ? "var(--fg)" : "var(--fg-muted)",
              borderTop: idx === activeTab ? "2px solid var(--border-tab-active)" : "2px solid transparent",
              borderRadius: 0,
              borderLeft: "none",
              borderRight: "none",
              borderBottom: "none",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Editor */}
      {loading ? (
        <div className="h-[400px] flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
          Loading files...
        </div>
      ) : (
        <FoamEditor
          height="400px"
          value={fileContents[currentFile.key] ?? ""}
          onChange={handleEditorChange}
        />
      )}

      {/* Generate Mesh / Cancel buttons */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={generateMesh}
          disabled={running || !caseName}
          className="px-6 py-2 rounded-sm font-semibold text-[13px]"
          style={
            running
              ? { background: "var(--bg-elevated)", color: "var(--fg-disabled)", cursor: "wait" }
              : { background: "var(--accent)", color: "#09090B" }
          }
          onMouseEnter={(e) => {
            if (!running) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            if (!running) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent)";
          }}
        >
          {running ? "Generating Mesh..." : "Generate Mesh"}
        </button>
        {running && (
          <button
            onClick={handleCancel}
            className="px-6 py-2 rounded-sm font-semibold text-[13px]"
            style={{ background: "var(--danger)", color: "var(--fg)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--danger-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--danger)";
            }}
          >
            Stop
          </button>
        )}
      </div>

      {/* Log output */}
      {logLines.length > 0 && (
        <div className="mt-4">
          <LogViewer lines={logLines} height="300px" />
        </div>
      )}

      {/* Mesh quality stats */}
      {meshQuality && (
        <div className="p-4 mt-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)", marginBottom: 12 }}>Mesh Quality</h3>
          <div className="grid grid-cols-3 gap-4 text-[13px]">
            <div>
              <span style={{ color: "var(--fg-muted)" }}>Cells:</span>{" "}
              <span style={{ color: "var(--fg)" }}>
                {meshQuality.cells.toLocaleString()}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--fg-muted)" }}>Faces:</span>{" "}
              <span style={{ color: "var(--fg)" }}>
                {meshQuality.faces.toLocaleString()}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--fg-muted)" }}>Points:</span>{" "}
              <span style={{ color: "var(--fg)" }}>
                {meshQuality.points.toLocaleString()}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--fg-muted)" }}>Max Non-Orthogonality:</span>{" "}
              <span style={{ color: "var(--fg)" }}>
                {meshQuality.max_non_orthogonality.toFixed(1)}&deg;
              </span>
            </div>
            <div>
              <span style={{ color: "var(--fg-muted)" }}>Max Skewness:</span>{" "}
              <span style={{ color: "var(--fg)" }}>
                {meshQuality.max_skewness.toFixed(3)}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--fg-muted)" }}>Max Aspect Ratio:</span>{" "}
              <span style={{ color: "var(--fg)" }}>
                {meshQuality.max_aspect_ratio.toFixed(1)}
              </span>
            </div>
          </div>
          {!meshQuality.ok && (
            <div className="mt-3 text-[13px]" style={{ color: "var(--error)" }}>
              Mesh has quality issues: {meshQuality.errors.join(", ")}
            </div>
          )}
          {meshQuality.ok && (
            <div className="mt-3 text-[13px] animate-amber-dot" style={{ color: "var(--success)" }}>
              Mesh quality OK
            </div>
          )}
          {/* 3D Mesh Preview */}
          {meshDone && caseName && (
            <div className="mt-4">
              <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", marginBottom: 8 }}>Geometry Preview</h4>
              <MeshPreview caseName={caseName} />
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={goBack}
          className="px-6 py-2 rounded-sm"
          style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--fg)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          &larr; Back
        </button>
        <button
          onClick={handleNext}
          disabled={!meshQuality}
          className="px-6 py-2 rounded-sm font-semibold text-[13px]"
          style={
            meshQuality
              ? { background: "var(--accent)", color: "#09090B" }
              : { background: "var(--bg-elevated)", color: "var(--fg-disabled)", cursor: "not-allowed" }
          }
          onMouseEnter={(e) => {
            if (meshQuality) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            if (meshQuality) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent)";
          }}
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
