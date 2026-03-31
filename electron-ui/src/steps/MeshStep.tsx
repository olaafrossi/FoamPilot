import { useState, useEffect, useRef, useCallback } from "react";
import { Lightbulb, Calculator } from "lucide-react";
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
  getSuggestions,
  getYPlus,
} from "../api";
import { useStopwatch, formatElapsed } from "../hooks/useStopwatch";
import type { MeshQuality, MeshSuggestion, YPlusResult } from "../types";

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

const MESH_FILES = [
  { key: "blockMeshDict", path: "system/blockMeshDict", label: "blockMeshDict" },
  { key: "snappyHexMeshDict", path: "system/snappyHexMeshDict", label: "snappyHexMeshDict" },
  { key: "surfaceFeatureExtractDict", path: "system/surfaceFeatureExtractDict", label: "surfaceFeatureExtractDict" },
];

export default function MeshStep({
  caseName,
  goNext,
  goBack,
  completeStep,
  velocity,
  geometryClass,
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

  // Pre-meshed detection: check for polyMesh boundary (or .gz / polyMesh.orig fallback)
  const [preMeshed, setPreMeshed] = useState(false);
  const [preMeshChecked, setPreMeshChecked] = useState(false);

  useEffect(() => {
    if (!caseName) return;
    let cancelled = false;
    setPreMeshChecked(false);
    readFile(caseName, "constant/polyMesh/boundary")
      .catch(() => readFile(caseName, "constant/polyMesh/boundary.gz"))
      .catch(() => readFile(caseName, "constant/polyMesh.orig/boundary"))
      .then(() => { if (!cancelled) setPreMeshed(true); })
      .catch(() => { if (!cancelled) setPreMeshed(false); })
      .finally(() => { if (!cancelled) setPreMeshChecked(true); });
    return () => { cancelled = true; };
  }, [caseName]);

  // Suggestions state
  const [meshSuggestion, setMeshSuggestion] = useState<MeshSuggestion | null>(null);
  const [yPlusResult, setYPlusResult] = useState<YPlusResult | null>(null);
  const [yPlusTarget, setYPlusTarget] = useState(30);
  const [suggestionApplied, setSuggestionApplied] = useState(false);

  // Sync running state and elapsed time to global status bar
  useEffect(() => {
    setWorking(running);
    return () => setWorking(false);
  }, [running, setWorking]);

  // Sync elapsed to status bar at 1Hz (not 60fps) to avoid re-render cascade
  const elapsedRef = useRef(stopwatch.elapsed);
  elapsedRef.current = stopwatch.elapsed;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(elapsedRef.current), 1000);
    return () => clearInterval(id);
  }, [running, setElapsed]);

  // Load mesh config files — skip for pre-meshed cases (they don't have these files)
  useEffect(() => {
    if (!caseName || !preMeshChecked || preMeshed) {
      if (preMeshChecked && preMeshed) setLoading(false);
      return;
    }
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
  }, [caseName, preMeshChecked, preMeshed]);

  // Fetch suggestions — skip for pre-meshed cases (suggest endpoint needs geometry classification)
  useEffect(() => {
    if (!caseName || velocity <= 0 || !preMeshChecked || preMeshed) return;
    let cancelled = false;
    getSuggestions(caseName, velocity, geometryClass ?? undefined)
      .then((s) => {
        if (!cancelled) setMeshSuggestion(s.mesh);
      })
      .catch(() => {});
    getYPlus(caseName, velocity, yPlusTarget)
      .then((y) => {
        if (!cancelled) setYPlusResult(y);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [caseName, velocity, geometryClass, yPlusTarget, preMeshed]);

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

  const applySuggestions = useCallback(async () => {
    if (!caseName || !meshSuggestion) return;
    setError(null);
    try {
      // Update snappyHexMeshDict with suggested values
      let snappy = fileContents["snappyHexMeshDict"] ?? "";

      // Update surface refinement levels
      snappy = snappy.replace(
        /level\s*\(\s*\d+\s+\d+\s*\)/,
        `level (${meshSuggestion.surface_refinement_min} ${meshSuggestion.surface_refinement_max})`,
      );

      // Update feature level
      snappy = snappy.replace(
        /level\s+\d+;\s*\n(\s*\})/,
        `level ${meshSuggestion.feature_level};\n$1`,
      );

      // Update nSurfaceLayers
      snappy = snappy.replace(
        /nSurfaceLayers\s+\d+/,
        `nSurfaceLayers ${meshSuggestion.n_surface_layers}`,
      );

      // Update expansionRatio
      snappy = snappy.replace(
        /expansionRatio\s+[\d.]+/,
        `expansionRatio ${meshSuggestion.expansion_ratio}`,
      );

      setFileContents((prev) => ({ ...prev, snappyHexMeshDict: snappy }));
      setDirty((d) => ({ ...d, snappyHexMeshDict: true }));
      await writeFile(caseName, "system/snappyHexMeshDict", snappy);
      setDirty((d) => ({ ...d, snappyHexMeshDict: false }));
      setSuggestionApplied(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to apply suggestions");
    }
  }, [caseName, meshSuggestion, fileContents]);

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
      "bash -c 'gunzip -k constant/triSurface/*.gz 2>/dev/null; true'",
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
              // Send toast notification
              window.foamPilot?.showNotification?.("FoamPilot", "Mesh generation complete");
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

  const verifyPreMesh = async () => {
    if (!caseName) return;
    setError(null);
    setRunning(true);
    setLogLines([]);
    setMeshQuality(null);
    stopwatch.start();

    try {
      const job = await runCommands(caseName, [
        // Restore mesh from polyMesh.orig or decompress .gz files if needed
        "bash -c 'if [ ! -f constant/polyMesh/points ]; then if [ -d constant/polyMesh.orig ]; then rm -rf constant/polyMesh && cp -r constant/polyMesh.orig constant/polyMesh; elif [ -f constant/polyMesh/points.gz ]; then gunzip constant/polyMesh/*.gz; fi; fi'",
        "checkMesh",
      ]);
      setCurrentJobId(job.job_id);
      const ws = connectLogs(job.job_id, (line) => {
        setLogLines((prev) => [...prev, line]);
      });
      wsRef.current = ws;

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
              } catch {}
            } else {
              setError("checkMesh failed. Check the log output.");
            }
          }
        } catch {}
      }, 2000);
    } catch (e: unknown) {
      setRunning(false);
      setCurrentJobId(null);
      stopwatch.stop();
      setError(e instanceof Error ? e.message : "Failed to run checkMesh");
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
        {preMeshed
          ? "This case includes a pre-built mesh. Verify it with checkMesh, then continue."
          : "Edit mesh dictionaries, then generate the computational mesh."
        }
      </p>

      {error && (
        <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {/* Pre-meshed info banner */}
      {preMeshed && !meshDone && !running && (
        <div
          className="p-4 mb-4 flex items-start gap-3"
          style={{
            background: "rgba(34, 197, 94, 0.06)",
            border: "1px solid rgba(34, 197, 94, 0.3)",
          }}
        >
          <Lightbulb size={16} className="shrink-0 mt-0.5" style={{ color: "var(--success)" }} />
          <div>
            <p className="text-[13px] font-semibold mb-1" style={{ color: "var(--fg)" }}>
              Pre-built mesh detected
            </p>
            <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
              This case ships with a ready-to-use mesh. Click "Verify Mesh" to run checkMesh
              and confirm quality, then proceed to boundary conditions.
            </p>
          </div>
        </div>
      )}

      {/* Suggestion banner */}
      {!preMeshed && meshSuggestion && !suggestionApplied && (
        <div
          className="p-4 mb-4 flex items-start gap-3"
          style={{
            background: "rgba(245, 158, 11, 0.06)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
          }}
        >
          <Lightbulb size={16} className="shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
          <div className="flex-1">
            <p className="text-[13px] font-semibold mb-1" style={{ color: "var(--fg)" }}>
              Mesh suggestions available
            </p>
            <p className="text-[12px] mb-2" style={{ color: "var(--fg-muted)" }}>
              {meshSuggestion.rationale}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] mb-3" style={{ color: "var(--fg-muted)" }}>
              <span>Surface: L{meshSuggestion.surface_refinement_min}–{meshSuggestion.surface_refinement_max}</span>
              <span>Layers: {meshSuggestion.n_surface_layers}</span>
              <span>Expansion: {meshSuggestion.expansion_ratio}</span>
              <span>~{(meshSuggestion.estimated_cells / 1e6).toFixed(1)}M cells</span>
              {meshSuggestion.first_layer_height && (
                <span>1st layer: {(meshSuggestion.first_layer_height * 1000).toFixed(3)} mm</span>
              )}
            </div>
            <button
              onClick={applySuggestions}
              className="px-4 py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                background: "var(--accent)",
                color: "#09090B",
                border: "none",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
            >
              Apply Suggestions
            </button>
          </div>
        </div>
      )}

      {!preMeshed && suggestionApplied && (
        <div
          className="p-3 mb-4 text-[12px]"
          style={{ background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.3)", color: "var(--success)" }}
        >
          Suggestions applied to snappyHexMeshDict.
        </div>
      )}

      {/* y+ calculator widget */}
      {!preMeshed && yPlusResult && (
        <div
          className="p-4 mb-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Calculator size={14} style={{ color: "var(--accent)" }} />
            <span className="text-[13px] font-semibold" style={{ color: "var(--fg)" }}>y+ Calculator</span>
          </div>
          <div className="flex items-center gap-3 mb-2">
            <label className="text-[12px]" style={{ color: "var(--fg-muted)" }}>Target y+:</label>
            <input
              type="number"
              value={yPlusTarget}
              onChange={(e) => setYPlusTarget(Math.max(1, parseFloat(e.target.value) || 30))}
              className="w-20 px-2 py-1 text-[12px]"
              style={{
                background: "#1a1a1e",
                border: "1px solid var(--border)",
                color: "#e4e4e7",
                outline: "none",
              }}
              min={1}
              step={1}
            />
          </div>
          {yPlusResult.message ? (
            <p className="text-[12px]" style={{ color: "var(--warning)" }}>{yPlusResult.message}</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]" style={{ color: "var(--fg-muted)" }}>
              <span>
                1st cell height: <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                  {yPlusResult.first_cell_height !== null ? `${(yPlusResult.first_cell_height * 1000).toFixed(4)} mm` : "—"}
                </span>
              </span>
              <span>Re = {yPlusResult.re.toExponential(2)}</span>
              <span>Cf = {yPlusResult.cf.toExponential(3)}</span>
              <span>u* = {yPlusResult.u_tau.toFixed(3)} m/s</span>
            </div>
          )}
        </div>
      )}

      {/* Tab bar + editor (only for cases that need mesh generation) */}
      {!preMeshed && (
        <>
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
        </>
      )}

      {/* Generate Mesh / Verify Mesh / Cancel buttons */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={preMeshed ? verifyPreMesh : generateMesh}
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
          {running
            ? (preMeshed ? "Verifying Mesh..." : "Generating Mesh...")
            : (preMeshed ? "Verify Mesh" : "Generate Mesh")
          }
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
          {/* 3D Mesh Preview (only for cases with imported geometry, not pre-meshed tutorials) */}
          {meshDone && caseName && !preMeshed && (
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
          disabled={!meshQuality && !preMeshed}
          className="px-6 py-2 rounded-sm font-semibold text-[13px]"
          style={
            (meshQuality || preMeshed)
              ? { background: "var(--accent)", color: "#09090B" }
              : { background: "var(--bg-elevated)", color: "var(--fg-disabled)", cursor: "not-allowed" }
          }
          onMouseEnter={(e) => {
            if (meshQuality || preMeshed) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            if (meshQuality || preMeshed) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent)";
          }}
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
