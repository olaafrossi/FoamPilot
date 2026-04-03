import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, Check, AlertTriangle, Loader2, X, ChevronDown, ChevronUp,
  Play, Wrench, Download, RotateCw,
} from "lucide-react";
import VisualizationPanel from "../components/VisualizationPanel";
import { useStatus } from "../hooks/useStatus";
import { useStopwatch, formatElapsed } from "../hooks/useStopwatch";
import {
  createCase,
  uploadGeometry,
  classifyGeometry,
  getSuggestions,
  runCommands,
  connectLogs,
  getJobStatus,
  cancelJob,
  getResults,
  getConfig,
  fetchTemplates,
} from "../api";
import type {
  AeroResults,
  GeometryClassification,
  AeroSuggestions,
  Template,
} from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageState = "idle" | "processing" | "results" | "error";

type PipelineStep =
  | "uploading"
  | "classifying"
  | "configuring"
  | "meshing_sfe"
  | "meshing_block"
  | "meshing_snappy"
  | "solving"
  | "loading_results";

interface StepStatus {
  state: "pending" | "running" | "done" | "error";
  label: string;
  detail?: string;
  elapsed?: number;
}

// ---------------------------------------------------------------------------
// OpenFOAM Error Pattern Map
// ---------------------------------------------------------------------------

interface ErrorDiagnosis {
  title: string;
  diagnosis: string;
  fix: string;
}

function diagnoseError(step: PipelineStep, logLines: string[]): ErrorDiagnosis {
  const tail = logLines.slice(-50).join("\n");

  // Upload / classification errors
  if (step === "uploading" || step === "classifying") {
    if (tail.includes("Empty file") || logLines.length === 0)
      return { title: "Empty file", diagnosis: "Your STL has no geometry data.", fix: "Re-export from your CAD tool and try again." };
  }

  // Mesh errors
  if (step.startsWith("meshing")) {
    if (/not all points unique|Illegal triangles/i.test(tail))
      return { title: "Duplicate vertices", diagnosis: "STL has duplicate vertices or degenerate triangles.", fix: "Repair in MeshLab: Filters > Cleaning and Repairing > Remove Duplicate Vertices." };
    if (/Surface is not closed|open edges/i.test(tail))
      return { title: "Non-manifold geometry", diagnosis: "STL has open edges (non-manifold). snappyHexMesh can't create a watertight mesh.", fix: "Repair in MeshLab: Filters > Repair > Close Holes." };
    if (/Inconsistent number of faces/i.test(tail))
      return { title: "Inconsistent normals", diagnosis: "STL has inconsistent face normals.", fix: "Repair in MeshLab: Filters > Normals > Re-Orient All Faces Coherently." };
    if (/FOAM FATAL ERROR[\s\S]*refinementSurfaces/i.test(tail))
      return { title: "Refinement failed", diagnosis: "Mesh refinement failed around geometry surface.", fix: "Geometry may be too complex for auto-meshing. Try Advanced Mode with manual mesh settings." };
    return { title: "Mesh generation failed", diagnosis: "snappyHexMesh exited with an error.", fix: "Check that your STL is a single closed surface. If it has multiple parts, try Advanced Mode." };
  }

  // Solver errors
  if (step === "solving") {
    if (/nan|inf/i.test(tail) && /residual/i.test(tail))
      return { title: "Solver diverged", diagnosis: "The simulation became unstable (NaN residuals).", fix: "This usually means mesh quality isn't good enough. Try Advanced Mode with finer mesh or lower velocity." };
    if (/matrix singularity/i.test(tail))
      return { title: "Singular matrix", diagnosis: "Solver hit a singular matrix, usually caused by bad mesh cells.", fix: "Try Advanced Mode with stricter mesh quality controls." };
    if (/FOAM FATAL ERROR/i.test(tail))
      return { title: "Solver crashed", diagnosis: "simpleFoam crashed unexpectedly.", fix: "Check the log for details. This may be a mesh quality issue." };
    return { title: "Solver error", diagnosis: "simpleFoam exited with an error.", fix: "Check the log for details." };
  }

  // Results loading
  if (step === "loading_results")
    return { title: "No results available", diagnosis: "The solver may not have written any output.", fix: "Check that at least one write interval completed." };

  return { title: "Pipeline error", diagnosis: "An unexpected error occurred.", fix: "Check the log for details." };
}

// Parse residual from simpleFoam output
function parseIteration(line: string): number | null {
  const m = line.match(/^Time = (\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseResidual(line: string): { field: string; value: number } | null {
  const m = line.match(/Solving for (\w+), Initial residual = ([0-9.eE+-]+)/);
  return m ? { field: m[1], value: parseFloat(m[2]) } : null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CoefficientReadout({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{ padding: "12px 0" }}>
      <p style={{ color: "var(--fg-muted)", fontSize: 11, fontWeight: 600, marginBottom: 2, fontFamily: "var(--font-ui)" }}>
        {label}
      </p>
      <p style={{ color: "var(--fg)", fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)", lineHeight: 1.2 }}>
        {value}
      </p>
      {unit && (
        <p style={{ color: "var(--fg-muted)", fontSize: 11, fontFamily: "var(--font-ui)", marginTop: 2 }}>
          {unit}
        </p>
      )}
    </div>
  );
}

function StepIndicator({ status, isLast }: { status: StepStatus; isLast?: boolean }) {
  const iconSize = 16;
  return (
    <div
      className="flex items-start gap-3 transition-all duration-200"
      style={{
        opacity: status.state === "pending" ? 0.4 : 1,
        paddingBottom: isLast ? 0 : 8,
      }}
    >
      <div className="shrink-0 mt-[2px]">
        {status.state === "done" && <Check size={iconSize} style={{ color: "var(--success)" }} />}
        {status.state === "running" && <Loader2 size={iconSize} className="animate-spin" style={{ color: "var(--accent)" }} />}
        {status.state === "error" && <X size={iconSize} style={{ color: "var(--error)" }} />}
        {status.state === "pending" && (
          <div style={{ width: iconSize, height: iconSize, borderRadius: "50%", border: "2px solid var(--fg-muted)" }} />
        )}
      </div>
      <div className="min-w-0">
        <p style={{
          fontSize: 13,
          fontWeight: status.state === "running" ? 600 : 400,
          color: status.state === "running" ? "var(--accent)" : status.state === "error" ? "var(--error)" : "var(--fg)",
          fontFamily: "var(--font-ui)",
        }}>
          {status.label}
        </p>
        {status.detail && (
          <p style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 2, fontFamily: "var(--font-ui)" }}>
            {status.detail}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template Gallery
// ---------------------------------------------------------------------------

function TemplateCard({ template, onClick }: { template: Template; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left transition-all duration-200"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        padding: "12px 14px",
        cursor: "pointer",
        width: "100%",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(245,158,11,0.2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", fontFamily: "var(--font-ui)" }}>
        {template.name}
      </p>
      <p style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 2, fontFamily: "var(--font-ui)" }}>
        {template.description || template.solver || "OpenFOAM case"}
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DropZonePage() {
  const navigate = useNavigate();
  const { setWorking, setElapsed, setError: setGlobalError } = useStatus();
  const stopwatch = useStopwatch();

  // Page state
  const [pageState, setPageState] = useState<PageState>("idle");
  const [caseName, setCaseName] = useState<string | null>(null);

  // Drop zone state
  const [dragOver, setDragOver] = useState(false);
  const [invalidFile, setInvalidFile] = useState(false);
  const invalidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pipeline state
  const [currentStep, setCurrentStep] = useState<PipelineStep>("uploading");
  const [steps, setSteps] = useState<Record<PipelineStep, StepStatus>>({
    uploading: { state: "pending", label: "Uploading geometry" },
    classifying: { state: "pending", label: "Classifying geometry" },
    configuring: { state: "pending", label: "Generating configuration" },
    meshing_sfe: { state: "pending", label: "Extracting surface features" },
    meshing_block: { state: "pending", label: "Block mesh" },
    meshing_snappy: { state: "pending", label: "snappyHexMesh" },
    solving: { state: "pending", label: "Solving (simpleFoam)" },
    loading_results: { state: "pending", label: "Loading results" },
  });
  const [pipelineProgress, setPipelineProgress] = useState(0); // 0-100
  const [solverIteration, setSolverIteration] = useState(0);
  const [solverMaxIter, setSolverMaxIter] = useState(500);
  const [lastResidual, setLastResidual] = useState<number | null>(null);
  const [residualHistory, setResidualHistory] = useState<number[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const currentJobRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const cancelledRef = useRef(false);

  // Results state
  const [results, setResults] = useState<AeroResults | null>(null);
  const [classification, setClassification] = useState<GeometryClassification | null>(null);
  const [suggestions, setSuggestions] = useState<AeroSuggestions | null>(null);

  // Scale detection toast
  const [scaleToast, setScaleToast] = useState<string | null>(null);

  // Error state
  const [errorInfo, setErrorInfo] = useState<ErrorDiagnosis | null>(null);

  // Narrow window detection
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 900);
  useEffect(() => {
    const handler = () => setIsNarrow(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Templates
  const [templates, setTemplates] = useState<Template[]>([]);
  useEffect(() => {
    fetchTemplates().then(setTemplates).catch(() => {});
  }, []);

  // Sync running state to status bar
  useEffect(() => {
    setWorking(pageState === "processing");
    return () => setWorking(false);
  }, [pageState, setWorking]);

  // Sync elapsed time at 1Hz
  const elapsedRef = useRef(stopwatch.elapsed);
  elapsedRef.current = stopwatch.elapsed;
  useEffect(() => {
    if (pageState !== "processing") return;
    const id = setInterval(() => setElapsed(elapsedRef.current), 1000);
    return () => clearInterval(id);
  }, [pageState, setElapsed]);

  // -------------------------------------------------------------------------
  // Step helpers
  // -------------------------------------------------------------------------

  const updateStep = useCallback((step: PipelineStep, update: Partial<StepStatus>) => {
    setSteps((prev) => ({ ...prev, [step]: { ...prev[step], ...update } }));
  }, []);

  const markDone = useCallback((step: PipelineStep, detail?: string) => {
    updateStep(step, { state: "done", detail });
  }, [updateStep]);

  const markRunning = useCallback((step: PipelineStep, detail?: string) => {
    updateStep(step, { state: "running", detail });
  }, [updateStep]);

  const markError = useCallback((step: PipelineStep) => {
    updateStep(step, { state: "error" });
  }, [updateStep]);

  // -------------------------------------------------------------------------
  // Run a command array, subscribe to WebSocket logs, wait for completion
  // -------------------------------------------------------------------------

  const runAndWait = useCallback(async (
    cName: string,
    commands: string[],
    onLine?: (line: string) => void,
  ): Promise<{ exitCode: number; lines: string[] }> => {
    const job = await runCommands(cName, commands);
    currentJobRef.current = job.job_id;
    const collectedLines: string[] = [];

    return new Promise((resolve, reject) => {
      const ws = connectLogs(job.job_id, (line) => {
        collectedLines.push(line);
        setLogLines((prev) => [...prev, line]);
        onLine?.(line);
      });
      wsRef.current = ws;

      // Poll for job completion
      const poll = setInterval(async () => {
        if (cancelledRef.current) {
          clearInterval(poll);
          ws.close();
          reject(new Error("Cancelled"));
          return;
        }
        try {
          const status = await getJobStatus(job.job_id);
          if (status.status === "completed" || status.status === "failed") {
            clearInterval(poll);
            ws.close();
            wsRef.current = null;
            currentJobRef.current = null;
            resolve({ exitCode: status.exit_code ?? (status.status === "completed" ? 0 : 1), lines: collectedLines });
          }
        } catch {
          // ignore polling errors
        }
      }, 1000);
    });
  }, []);

  // -------------------------------------------------------------------------
  // Main pipeline orchestration
  // -------------------------------------------------------------------------

  const runPipeline = useCallback(async (file: File | null, templateName?: string) => {
    cancelledRef.current = false;
    setPageState("processing");
    setLogLines([]);
    setSolverIteration(0);
    setLastResidual(null);
    setResidualHistory([]);
    setErrorInfo(null);
    setShowLog(false);
    setPipelineProgress(0);
    stopwatch.start();

    // Reset all steps
    setSteps({
      uploading: { state: "pending", label: "Uploading geometry" },
      classifying: { state: "pending", label: "Classifying geometry" },
      configuring: { state: "pending", label: "Generating configuration" },
      meshing_sfe: { state: "pending", label: "Extracting surface features" },
      meshing_block: { state: "pending", label: "Block mesh" },
      meshing_snappy: { state: "pending", label: "snappyHexMesh" },
      solving: { state: "pending", label: "Solving (simpleFoam)" },
      loading_results: { state: "pending", label: "Loading results" },
    });

    try {
      // Generate a unique case name
      const timestamp = Date.now().toString(36);
      const cName = templateName
        ? `dropzone-${templateName}-${timestamp}`
        : `dropzone-${(file?.name ?? "case").replace(/\.stl$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")}-${timestamp}`;
      setCaseName(cName);

      // Step 1: Create case + upload geometry
      setCurrentStep("uploading");
      markRunning("uploading", file ? `Uploading ${file.name}...` : `Loading ${templateName} template...`);
      setPipelineProgress(5);

      await createCase(cName, templateName || "motorBike");

      if (file) {
        // Check scale: if bounds > 100m, likely mm
        const uploadResult = await uploadGeometry(cName, file, 1.0, templateName || "motorBike");
        const bounds = uploadResult.bounds;
        const maxDim = Math.max(
          bounds.max[0] - bounds.min[0],
          bounds.max[1] - bounds.min[1],
          bounds.max[2] - bounds.min[2],
        );
        if (maxDim > 100) {
          setScaleToast("Detected millimeter scale. Auto-converting to meters.");
          await uploadGeometry(cName, file, 0.001, templateName || "motorBike");
          setTimeout(() => setScaleToast(null), 5000);
        }
        markDone("uploading", `${uploadResult.filename} — ${uploadResult.triangles.toLocaleString()} triangles`);
      } else {
        markDone("uploading", `Template: ${templateName}`);
      }
      setPipelineProgress(12);

      // Step 2: Classify geometry
      setCurrentStep("classifying");
      markRunning("classifying");
      const classResult = await classifyGeometry(cName);
      setClassification(classResult);
      const classLabel = classResult.geometry_class === "streamlined" ? "Streamlined body"
        : classResult.geometry_class === "bluff" ? "Bluff body"
        : "Complex geometry";
      markDone("classifying", classLabel);
      setPipelineProgress(18);

      // Step 3: Get suggestions / auto-config
      setCurrentStep("configuring");
      markRunning("configuring");
      const suggestResult = await getSuggestions(cName, 20, classResult.geometry_class);
      setSuggestions(suggestResult);
      setSolverMaxIter(suggestResult.solver.end_time);
      markDone("configuring", `k-ω SST, 20 m/s, ~${suggestResult.mesh.estimated_cells.toLocaleString()} cells`);
      setPipelineProgress(22);

      // Step 4: Mesh — get cores
      const cores = getConfig().cores || 4;

      // 4a: surfaceFeatureExtract
      setCurrentStep("meshing_sfe");
      markRunning("meshing_sfe");
      const sfeResult = await runAndWait(cName, ["surfaceFeatureExtract"]);
      if (sfeResult.exitCode !== 0) throw new Error("surfaceFeatureExtract failed");
      markDone("meshing_sfe");
      setPipelineProgress(30);

      // 4b: blockMesh
      setCurrentStep("meshing_block");
      markRunning("meshing_block");
      const bmResult = await runAndWait(cName, ["blockMesh"]);
      if (bmResult.exitCode !== 0) throw new Error("blockMesh failed");
      markDone("meshing_block");
      setPipelineProgress(38);

      // 4c: decomposePar + snappyHexMesh + reconstructParMesh
      setCurrentStep("meshing_snappy");
      markRunning("meshing_snappy", "Parallel meshing...");

      const meshCommands = cores > 1
        ? [
            "decomposePar -force",
            `mpirun -np ${cores} --oversubscribe snappyHexMesh -overwrite -parallel`,
            "reconstructParMesh -constant",
          ]
        : ["snappyHexMesh -overwrite"];

      const meshResult = await runAndWait(cName, meshCommands, (line) => {
        // Parse snappyHexMesh progress from cell count
        const cellMatch = line.match(/Cells\s*:\s*(\d+)/);
        if (cellMatch) {
          const cells = parseInt(cellMatch[1], 10);
          const target = suggestResult.mesh.estimated_cells;
          const meshProgress = Math.min(cells / target, 1);
          setPipelineProgress(38 + Math.round(meshProgress * 22)); // 38-60
          markRunning("meshing_snappy", `${cells.toLocaleString()} cells`);
        }
      });
      if (meshResult.exitCode !== 0) throw new Error("snappyHexMesh failed");
      markDone("meshing_snappy");
      setPipelineProgress(62);

      // Step 5: Solve
      setCurrentStep("solving");
      markRunning("solving", "Starting simpleFoam...");

      const solveCommands = cores > 1
        ? [
            "decomposePar -force",
            `mpirun -np ${cores} --oversubscribe simpleFoam -parallel`,
            "reconstructPar -latestTime",
          ]
        : ["simpleFoam"];

      const solveResult = await runAndWait(cName, solveCommands, (line) => {
        const iter = parseIteration(line);
        if (iter !== null) {
          setSolverIteration(iter);
          const solveProgress = Math.min(iter / suggestResult.solver.end_time, 1);
          setPipelineProgress(62 + Math.round(solveProgress * 30)); // 62-92
          markRunning("solving", `Iteration ${iter}/${suggestResult.solver.end_time}`);
        }
        const res = parseResidual(line);
        if (res) {
          setLastResidual(res.value);
          setResidualHistory((prev) => [...prev.slice(-20), res.value]);
        }
        // Divergence detection
        if (/nan/i.test(line) && /residual/i.test(line)) {
          cancelledRef.current = true;
          if (currentJobRef.current) cancelJob(currentJobRef.current).catch(() => {});
        }
      });

      if (solveResult.exitCode !== 0 && !cancelledRef.current) throw new Error("simpleFoam failed");
      markDone("solving", cancelledRef.current ? "Diverged — showing partial results" : undefined);
      setPipelineProgress(92);

      // Step 6: Load results
      setCurrentStep("loading_results");
      markRunning("loading_results");
      const aeroResults = await getResults(cName);
      setResults(aeroResults);
      markDone("loading_results");
      setPipelineProgress(100);

      stopwatch.stop();
      setPageState("results");
    } catch (err) {
      stopwatch.stop();
      const errMsg = err instanceof Error ? err.message : "Unknown error";

      // If cancelled by user, go back to idle
      if (cancelledRef.current && errMsg === "Cancelled") {
        setPageState("idle");
        return;
      }

      markError(currentStep);
      setErrorInfo(diagnoseError(currentStep, logLines));
      setPageState("error");
      setGlobalError(errMsg);
    }
  }, [stopwatch, markRunning, markDone, markError, runAndWait, setGlobalError, currentStep, logLines, updateStep]);

  // -------------------------------------------------------------------------
  // Drop handlers
  // -------------------------------------------------------------------------

  const handleFiles = useCallback((files: FileList) => {
    if (files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".stl")) {
      setInvalidFile(true);
      if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
      invalidTimerRef.current = setTimeout(() => setInvalidFile(false), 3000);
      return;
    }
    setInvalidFile(false);
    setDragOver(false);
    runPipeline(file);
  }, [runPipeline]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.relatedTarget || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }, []);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    if (currentJobRef.current) cancelJob(currentJobRef.current).catch(() => {});
    wsRef.current?.close();
  }, []);

  const handleReset = useCallback(() => {
    setPageState("idle");
    setCaseName(null);
    setResults(null);
    setClassification(null);
    setSuggestions(null);
    setErrorInfo(null);
    setLogLines([]);
    setPipelineProgress(0);
    setSolverIteration(0);
    setLastResidual(null);
    setResidualHistory([]);
  }, []);

  // -------------------------------------------------------------------------
  // Keyboard: Enter/Space on drop zone opens file picker
  // -------------------------------------------------------------------------

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  }, []);

  // -------------------------------------------------------------------------
  // Residual sparkline (simple inline SVG)
  // -------------------------------------------------------------------------

  function ResidualSparkline({ data }: { data: number[] }) {
    if (data.length < 2) return null;
    const h = 20;
    const w = 80;
    const logData = data.map((v) => (v > 0 ? Math.log10(v) : -10));
    const min = Math.min(...logData);
    const max = Math.max(...logData);
    const range = max - min || 1;
    const points = logData
      .map((v, i) => `${(i / (logData.length - 1)) * w},${h - ((v - min) / range) * h}`)
      .join(" ");
    return (
      <svg width={w} height={h} style={{ display: "inline-block", verticalAlign: "middle" }}>
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      </svg>
    );
  }

  // -------------------------------------------------------------------------
  // Render: IDLE state
  // -------------------------------------------------------------------------

  if (pageState === "idle") {
    return (
      <div className="flex flex-col items-center justify-center h-full relative" style={{ background: "var(--bg-editor)" }}>
        {/* Ghosted background image placeholder — faint grid pattern as fallback */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.04,
            backgroundImage: "radial-gradient(circle at 1px 1px, var(--fg-muted) 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* Main drop zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload STL file"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onKeyDown={handleKeyDown}
          onClick={() => fileInputRef.current?.click()}
          className="relative z-10 flex flex-col items-center justify-center cursor-pointer transition-all duration-150"
          style={{
            width: "min(600px, 85vw)",
            minHeight: 280,
            padding: 40,
            border: invalidFile
              ? "2px solid var(--error)"
              : dragOver
                ? "2px solid var(--accent)"
                : "2px dashed var(--border)",
            background: dragOver ? "var(--accent-bg)" : "transparent",
            outline: "none",
          }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 2px var(--accent)"; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
        >
          {invalidFile ? (
            <>
              <X size={48} style={{ color: "var(--error)", marginBottom: 16 }} />
              <p style={{ fontSize: 18, fontWeight: 600, color: "var(--error)", fontFamily: "var(--font-display)" }}>
                STL files only
              </p>
            </>
          ) : (
            <>
              <Upload
                size={48}
                style={{
                  color: dragOver ? "var(--accent)" : "var(--fg-muted)",
                  marginBottom: 16,
                  transition: "color 150ms ease",
                }}
              />
              <p style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--fg)",
                fontFamily: "var(--font-display)",
                marginBottom: 8,
              }}>
                Drop your STL.
              </p>
              <p style={{ fontSize: 16, color: "var(--fg-muted)", fontFamily: "var(--font-ui)" }}>
                Get drag, lift, and pressure maps — no config needed.
              </p>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".stl"
          className="hidden"
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); }}
        />

        {/* Template gallery */}
        {templates.length > 0 && (
          <div className="relative z-10 mt-8" style={{ width: "min(600px, 85vw)" }}>
            <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 8, fontFamily: "var(--font-ui)" }}>
              Or try a template:
            </p>
            <div className="grid grid-cols-2 gap-2" style={{ maxWidth: 600 }}>
              {templates.filter((t) => t.has_geometry).slice(0, 4).map((t) => (
                <TemplateCard
                  key={t.name}
                  template={t}
                  onClick={() => runPipeline(null, t.name)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: PROCESSING state
  // -------------------------------------------------------------------------

  if (pageState === "processing") {
    const stepOrder: PipelineStep[] = [
      "uploading", "classifying", "configuring",
      "meshing_sfe", "meshing_block", "meshing_snappy",
      "solving", "loading_results",
    ];

    // Group steps for display
    const displayGroups = [
      { label: "Upload & Classify", steps: ["uploading", "classifying"] as PipelineStep[] },
      { label: "Auto-Configure", steps: ["configuring"] as PipelineStep[] },
      { label: "Meshing", steps: ["meshing_sfe", "meshing_block", "meshing_snappy"] as PipelineStep[] },
      { label: "Solving", steps: ["solving"] as PipelineStep[] },
      { label: "Results", steps: ["loading_results"] as PipelineStep[] },
    ];

    return (
      <div className="flex flex-col h-full" style={{ background: "var(--bg-editor)" }}>
        {/* Progress bar */}
        <div style={{ height: 4, background: "var(--bg-elevated)", width: "100%" }}>
          <div
            className="transition-all duration-500 ease-out"
            style={{ height: 4, background: "var(--accent)", width: `${pipelineProgress}%` }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 flex items-start justify-center overflow-auto" style={{ padding: 40 }}>
          <div style={{ width: "min(500px, 90vw)" }}>
            {/* Time estimate */}
            <p style={{ fontSize: 11, color: "var(--fg-muted)", marginBottom: 20, fontFamily: "var(--font-ui)" }}>
              {stopwatch.isRunning && `Elapsed: ${formatElapsed(stopwatch.elapsed)}`}
              {currentStep === "solving" && solverIteration > 0 && solverMaxIter > 0 && (
                <span className="ml-3">
                  Iteration {solverIteration}/{solverMaxIter}
                  {lastResidual !== null && ` — residual: ${lastResidual.toExponential(1)}`}
                  <span className="ml-2"><ResidualSparkline data={residualHistory} /></span>
                </span>
              )}
            </p>

            {/* Step list */}
            {displayGroups.map((group) => {
              // Show group header only for multi-step groups
              const groupSteps = group.steps.map((s) => steps[s]);
              const groupState = groupSteps.every((s) => s.state === "done") ? "done"
                : groupSteps.some((s) => s.state === "running") ? "running"
                : groupSteps.some((s) => s.state === "error") ? "error"
                : "pending";

              return (
                <div key={group.label} style={{ marginBottom: 16 }}>
                  <p style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: groupState === "running" ? "var(--accent)" : "var(--fg-muted)",
                    marginBottom: 8,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    fontFamily: "var(--font-ui)",
                  }}>
                    {group.label}
                    {groupState === "done" && <Check size={12} className="inline ml-2" style={{ color: "var(--success)" }} />}
                  </p>
                  {group.steps.map((stepKey, idx) => (
                    <div key={stepKey} style={{ paddingLeft: 8 }}>
                      <StepIndicator status={steps[stepKey]} isLast={idx === group.steps.length - 1} />
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Cancel button */}
            <button
              onClick={handleCancel}
              className="mt-6 transition-colors duration-100"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--fg-muted)",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "var(--font-ui)",
                padding: "4px 0",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--fg)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--fg-muted)"; }}
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Scale detection toast */}
        {scaleToast && (
          <div
            className="fixed bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 text-[13px] z-50"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--fg)",
              fontFamily: "var(--font-ui)",
            }}
          >
            {scaleToast}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: ERROR state
  // -------------------------------------------------------------------------

  if (pageState === "error" && errorInfo) {
    return (
      <div className="flex flex-col h-full" style={{ background: "var(--bg-editor)" }}>
        {/* Progress bar (frozen at failure point) */}
        <div style={{ height: 4, background: "var(--bg-elevated)", width: "100%" }}>
          <div style={{ height: 4, background: "var(--error)", width: `${pipelineProgress}%` }} />
        </div>

        <div className="flex-1 flex items-start justify-center overflow-auto" style={{ padding: 40 }}>
          <div style={{ width: "min(500px, 90vw)" }}>
            {/* Error card */}
            <div
              style={{
                border: "1px solid var(--error)",
                background: "var(--bg-surface)",
                padding: 24,
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <AlertTriangle size={20} style={{ color: "var(--error)" }} />
                <p style={{ fontSize: 16, fontWeight: 700, color: "var(--fg)", fontFamily: "var(--font-display)" }}>
                  {errorInfo.title}
                </p>
              </div>

              <p style={{ fontSize: 13, color: "var(--fg)", marginBottom: 8, fontFamily: "var(--font-ui)" }}>
                {errorInfo.diagnosis}
              </p>
              <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 16, fontFamily: "var(--font-ui)" }}>
                {errorInfo.fix}
              </p>

              {/* Log toggle */}
              <button
                onClick={() => setShowLog(!showLog)}
                className="flex items-center gap-1 mb-4 transition-colors duration-100"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--fg-muted)",
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "var(--font-ui)",
                }}
              >
                {showLog ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showLog ? "Hide Log" : "Show Log"}
              </button>

              {showLog && (
                <div
                  className="overflow-auto mb-4"
                  style={{
                    maxHeight: 200,
                    background: "var(--bg-editor)",
                    border: "1px solid var(--border)",
                    padding: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--fg-muted)",
                    lineHeight: 1.4,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {logLines.slice(-30).join("\n")}
                </div>
              )}

              {/* Recovery actions */}
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold transition-colors duration-100"
                  style={{ background: "var(--accent)", color: "#09090B", border: "none", cursor: "pointer" }}
                >
                  <RotateCw size={14} /> Try Again
                </button>
                {caseName && (
                  <button
                    onClick={() => navigate(`/wizard?case=${caseName}`)}
                    className="flex items-center gap-2 px-4 py-2 text-[13px] transition-colors duration-100"
                    style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--fg)", cursor: "pointer" }}
                  >
                    <Wrench size={14} /> Advanced Mode
                  </button>
                )}
                <button
                  onClick={() => {
                    handleReset();
                    setTimeout(() => fileInputRef.current?.click(), 100);
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-[13px] transition-colors duration-100"
                  style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--fg)", cursor: "pointer" }}
                >
                  <Upload size={14} /> Upload New STL
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: RESULTS state (workspace layout)
  // -------------------------------------------------------------------------

  if (pageState === "results" && caseName) {
    const cd = results?.cd != null ? results.cd.toFixed(4) : "—";
    const cl = results?.cl != null ? results.cl.toFixed(4) : "—";
    // Compute drag force: Fd = 0.5 * rho * v^2 * A * Cd
    const velocity = 20; // m/s default
    const rho = 1.225; // kg/m^3 at sea level
    const area = classification?.frontal_area ?? 1;
    const dragForce = results?.cd != null ? (0.5 * rho * velocity * velocity * area * results.cd) : null;
    const fdStr = dragForce != null ? dragForce.toFixed(1) : "—";

    const classLabel = classification
      ? (classification.geometry_class === "streamlined" ? "Streamlined"
        : classification.geometry_class === "bluff" ? "Bluff body"
        : "Complex")
      : "—";

    const inspectionRail = (
      <div
        className="flex flex-col shrink-0 overflow-y-auto"
        style={{
          width: isNarrow ? "100%" : 250,
          background: "var(--bg-sidebar)",
          borderLeft: isNarrow ? "none" : "1px solid var(--border)",
          borderTop: isNarrow ? "1px solid var(--border)" : "none",
          padding: "16px 16px",
        }}
      >
        {/* Coefficients */}
        <CoefficientReadout label="Drag Coefficient" value={cd} />
        <div style={{ borderTop: "1px solid var(--border)" }} />
        <CoefficientReadout label="Lift Coefficient" value={cl} />
        <div style={{ borderTop: "1px solid var(--border)" }} />
        <CoefficientReadout label="Drag Force" value={fdStr} unit={dragForce != null ? "N" : undefined} />
        <div style={{ borderTop: "1px solid var(--border)" }} />

        {/* Config summary */}
        <div style={{ padding: "12px 0" }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", marginBottom: 6, fontFamily: "var(--font-ui)" }}>
            AUTO-CONFIG
          </p>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", fontFamily: "var(--font-ui)", lineHeight: 1.6 }}>
            {classLabel}<br />
            20 m/s freestream<br />
            k-ω SST<br />
            {results?.iterations ?? "—"} iterations<br />
            {results?.converged ? "Converged" : "Not converged"}<br />
            {results?.wall_time_seconds != null ? formatTime(results.wall_time_seconds) : ""}
          </p>
        </div>
        <div style={{ borderTop: "1px solid var(--border)" }} />

        {/* Actions */}
        <div className="flex flex-col gap-2 mt-4">
          <button
            onClick={handleReset}
            className="flex items-center justify-center gap-2 px-4 py-2 text-[13px] font-semibold transition-colors duration-100 w-full"
            style={{ background: "var(--accent)", color: "#09090B", border: "none", cursor: "pointer" }}
          >
            <Play size={14} /> Run Another
          </button>
          <button
            onClick={() => navigate(`/wizard?case=${caseName}`)}
            className="flex items-center justify-center gap-2 px-4 py-2 text-[13px] transition-colors duration-100 w-full"
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--fg)", cursor: "pointer" }}
          >
            <Wrench size={14} /> Advanced Mode
          </button>
          <button
            onClick={() => {
              // TODO: implement zip download
              setGlobalError("Export not yet implemented");
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 text-[13px] transition-colors duration-100 w-full"
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--fg)", cursor: "pointer" }}
          >
            <Download size={14} /> Download Results
          </button>
        </div>
      </div>
    );

    return (
      <div className={`flex h-full ${isNarrow ? "flex-col" : "flex-row"}`} style={{ background: "var(--bg-editor)" }}>
        {/* 3D Canvas */}
        <div className="flex-1 min-w-0 min-h-0">
          <VisualizationPanel caseName={caseName} />
        </div>

        {/* Inspection Rail */}
        {inspectionRail}
      </div>
    );
  }

  // Fallback
  return null;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return seconds.toFixed(1) + "s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return m + "m " + s.toFixed(0) + "s";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}
