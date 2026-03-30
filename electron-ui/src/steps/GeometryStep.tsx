import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { fetchTemplates, createCase, uploadGeometry, transformGeometry } from "../api";
import type { Template } from "../types";
import MeshPreview from "../components/MeshPreview";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";

const UNIT_OPTIONS = [
  { label: "Millimeters (mm)", value: "mm", scale: 0.001, hint: "Most CAD tools export in mm" },
  { label: "Meters (m)", value: "m", scale: 1.0, hint: "Already in SI units" },
  { label: "Centimeters (cm)", value: "cm", scale: 0.01, hint: "" },
  { label: "Inches (in)", value: "in", scale: 0.0254, hint: "Common in imperial CAD" },
  { label: "Feet (ft)", value: "ft", scale: 0.3048, hint: "" },
] as const;

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

function isAvailable(_t: Template): boolean {
  return true;
}

function deriveVelocity(t: Template): number {
  const physics = (t as any).physics;
  if (physics?.magUInf) return physics.magUInf;
  if (physics?.velocity) {
    const v = physics.velocity;
    if (Array.isArray(v)) return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
    if (typeof v === "number") return v;
  }
  return 20;
}

export default function GeometryStep({
  caseName,
  setCaseName,
  templateName,
  setTemplateName,
  goNext,
  completeStep,
  setVelocity,
}: StepProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [tutorialStatus, setTutorialStatus] = useState<Record<string, unknown>>({});
  const [retryCount, setRetryCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // STL upload state
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [stlUnit, setStlUnit] = useState("mm");
  const [dragOver, setDragOver] = useState(false);
  const [rawBounds, setRawBounds] = useState<{ size: [number, number, number] } | null>(null);

  // Post-upload state (STL uploaded, case created — show preview + transform controls)
  const [uploadInfo, setUploadInfo] = useState<{
    filename: string;
    triangles: number;
    bounds: { min: number[]; max: number[] };
  } | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [transforming, setTransforming] = useState(false);

  // Parse pending STL client-side to get raw dimensions for scale preview
  useEffect(() => {
    if (!pendingFile) { setRawBounds(null); return; }
    let cancelled = false;
    pendingFile.arrayBuffer().then((buf) => {
      if (cancelled) return;
      try {
        const loader = new STLLoader();
        const geo = loader.parse(buf);
        geo.computeBoundingBox();
        const s = new THREE.Vector3();
        geo.boundingBox!.getSize(s);
        setRawBounds({ size: [s.x, s.y, s.z] });
      } catch {
        setRawBounds(null);
      }
    });
    return () => { cancelled = true; };
  }, [pendingFile]);

  // Resulting dimensions after applying the selected scale factor
  const scaledDims = useMemo(() => {
    if (!rawBounds) return null;
    const unitOpt = UNIT_OPTIONS.find((u) => u.value === stlUnit);
    const scale = unitOpt?.scale ?? 1.0;
    const [rx, ry, rz] = rawBounds.size;
    const m = { x: rx * scale, y: ry * scale, z: rz * scale };
    const mToFt = 3.28084;
    const ft = { x: m.x * mToFt, y: m.y * mToFt, z: m.z * mToFt };
    return { m, ft };
  }, [rawBounds, stlUnit]);

  // Load tutorial status + templates together
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      window.foamPilot?.tutorials?.getStatus()?.catch(() => ({} as Record<string, unknown>)) ?? Promise.resolve({} as Record<string, unknown>),
      fetchTemplates(),
    ])
      .then(([status, tpls]) => {
        if (cancelled) return;
        setTutorialStatus(status);
        setTemplates(tpls);
        setLoading(false);

        if (caseName && templateName) {
          setSelectedPath(templateName);
        } else if (!status.onboarding_completed) {
          const firstTutorial = tpls.find((t) => t.category === "verification" && isAvailable(t));
          if (firstTutorial) setSelectedPath(firstTutorial.path);
        } else {
          const firstSim = tpls.find((t) => t.category !== "verification" && isAvailable(t));
          if (firstSim) setSelectedPath(firstSim.path);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load templates");
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group templates
  const simulations = templates.filter((t) => t.category !== "verification");
  const verification = templates.filter((t) => t.category === "verification");
  const selected = templates.find((t) => t.path === selectedPath) ?? null;
  const isFirstRun = !tutorialStatus.onboarding_completed;
  const caseAlreadyCreated = caseName !== null && templateName === selectedPath;

  const handleSelect = useCallback((t: Template) => {
    if (!isAvailable(t)) return;
    setSelectedPath(t.path);
    setCreateError(null);
    setPendingFile(null);
    setUploadInfo(null);
  }, []);

  const handleFileDrop = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".stl")) {
      setCreateError("Please upload an STL file");
      return;
    }
    setCreateError(null);
    setPendingFile(file);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!selected || creating) return;
    setCreating(true);
    setCreateError(null);

    const caseSuffix = selected.path.split("/").pop() ?? selected.path;
    const name = caseSuffix.replace(/[^a-zA-Z0-9_-]/g, "_");

    try {
      await createCase(name, selected.path);

      // Upload custom STL if provided
      if (pendingFile) {
        const unitOption = UNIT_OPTIONS.find((u) => u.value === stlUnit) ?? UNIT_OPTIONS[0];
        const info = await uploadGeometry(name, pendingFile, unitOption.scale, selected.path);
        setUploadInfo(info);
        setPendingFile(null);
      }

      setCaseName(name);
      setTemplateName(selected.path);
      setVelocity(deriveVelocity(selected));
      completeStep(0);

      // If no STL was uploaded, proceed immediately
      if (!pendingFile) goNext();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create case");
    } finally {
      setCreating(false);
    }
  }, [selected, creating, pendingFile, stlUnit, setCaseName, setTemplateName, setVelocity, completeStep, goNext]);

  const handleContinue = useCallback(() => {
    completeStep(0);
    goNext();
  }, [completeStep, goNext]);

  const handleTransform = useCallback(async (transform: {
    rotate_x?: number;
    rotate_y?: number;
    rotate_z?: number;
    translate_x?: number;
    translate_y?: number;
    translate_z?: number;
  }) => {
    if (!caseName) return;
    setTransforming(true);
    setCreateError(null);
    try {
      const info = await transformGeometry(caseName, transform);
      setUploadInfo((prev) => prev ? { ...prev, bounds: info.bounds } : prev);
      setPreviewKey((k) => k + 1);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Failed to transform geometry");
    } finally {
      setTransforming(false);
    }
  }, [caseName]);

  // Keyboard navigation
  const selectableItems = [...simulations, ...verification].filter(isAvailable);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectableItems.length) return;
      const currentIndex = selectableItems.findIndex((t) => t.path === selectedPath);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = currentIndex < selectableItems.length - 1 ? currentIndex + 1 : 0;
        setSelectedPath(selectableItems[next].path);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : selectableItems.length - 1;
        setSelectedPath(selectableItems[prev].path);
      } else if (e.key === "Enter" && selected) {
        e.preventDefault();
        if (uploadInfo) handleContinue();
        else if (caseAlreadyCreated) handleContinue();
        else handleCreate();
      }
    },
    [selectableItems, selectedPath, selected, uploadInfo, caseAlreadyCreated, handleCreate, handleContinue],
  );

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="flex h-full gap-0" style={{ minHeight: 400 }}>
      {/* Left pane: template list */}
      <div
        ref={listRef}
        className="flex flex-col overflow-y-auto"
        style={{
          width: 250,
          minWidth: 200,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-sidebar)",
        }}
        role="listbox"
        aria-label="Template list"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {loading ? (
          <>
            <GroupHeader label="SIMULATIONS" />
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="mx-2 my-1 rounded"
                style={{ height: 28, background: "var(--bg-elevated)", opacity: 0.5, animation: "pulse 1.5s infinite" }}
              />
            ))}
            <GroupHeader label="SETUP VERIFICATION" />
            {[1, 2].map((i) => (
              <div
                key={`v${i}`}
                className="mx-2 my-1 rounded"
                style={{ height: 28, background: "var(--bg-elevated)", opacity: 0.5, animation: "pulse 1.5s infinite" }}
              />
            ))}
          </>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-3">
            <span style={{ fontSize: 24 }}>!</span>
            <p style={{ color: "var(--error)", fontSize: 13 }}>Could not connect to backend</p>
            <p style={{ color: "var(--fg-muted)", fontSize: 11 }}>Is Docker running?</p>
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              className="px-3 py-1 rounded"
              style={{
                background: "var(--accent)",
                color: "#09090B",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex items-center justify-center h-full px-4" style={{ color: "var(--fg-muted)", fontSize: 13 }}>
            No templates found
          </div>
        ) : (
          <>
            <GroupHeader label="SIMULATIONS" />
            {simulations.map((t) => (
              <ListItem
                key={t.path}
                template={t}
                selected={t.path === selectedPath}
                available={isAvailable(t)}
                tutorialCompleted={false}
                onClick={() => handleSelect(t)}
              />
            ))}

            {verification.length > 0 && (
              <>
                <GroupHeader label="SETUP VERIFICATION" />
                {verification.map((t) => (
                  <ListItem
                    key={t.path}
                    template={t}
                    selected={t.path === selectedPath}
                    available={isAvailable(t)}
                    tutorialCompleted={!!tutorialStatus[t.path.split("/").pop() ?? t.path]}
                    onClick={() => handleSelect(t)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Right pane: detail inspector */}
      <div
        className="flex-1 flex flex-col overflow-y-auto px-6 py-5"
        style={{ background: "var(--bg-editor)" }}
        aria-live="polite"
      >
        {loading ? (
          <p style={{ color: "var(--fg-muted)", fontSize: 13, textAlign: "center", marginTop: 80 }}>
            Loading templates...
          </p>
        ) : selected ? (
          <>
            {/* Template name */}
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 16,
                fontWeight: 700,
                color: "var(--fg)",
                margin: 0,
              }}
            >
              {selected.name}
            </h2>

            {/* First-run nudge */}
            {isFirstRun && selected.category === "verification" && (
              <p
                style={{
                  color: "var(--accent)",
                  fontSize: 13,
                  fontWeight: 600,
                  marginTop: 8,
                  marginBottom: 0,
                }}
              >
                First time? Start here.
              </p>
            )}

            {/* Description */}
            <p
              style={{
                color: "var(--fg)",
                fontSize: 13,
                lineHeight: 1.5,
                marginTop: 10,
              }}
            >
              {isFirstRun && selected.category === "verification"
                ? `${selected.description} Once it completes, you'll know your environment is ready for real simulations.`
                : selected.description}
            </p>

            {/* Metadata row */}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginTop: 10,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {selected.solver && (
                <span style={{ color: "var(--fg-muted)" }}>{selected.solver}</span>
              )}
              {selected.solver && selected.difficulty && (
                <span style={{ color: "var(--fg-muted)" }}>&middot;</span>
              )}
              {selected.difficulty && (
                <span
                  style={{
                    color: selected.difficulty === "beginner" ? "var(--success)" : "var(--warning)",
                  }}
                >
                  {selected.difficulty.charAt(0).toUpperCase() + selected.difficulty.slice(1)}
                </span>
              )}
              {selected.estimated_runtime && (
                <>
                  <span style={{ color: "var(--fg-muted)" }}>&middot;</span>
                  <span style={{ color: "var(--fg-muted)" }}>{selected.estimated_runtime}</span>
                </>
              )}
            </div>

            {/* ── STL Upload (pre-upload state) ── */}
            {selected.category !== "verification" && !uploadInfo && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", marginBottom: 6 }}>
                  {selected.has_geometry !== false ? "Replace geometry (optional)" : "Upload geometry (required)"}
                </p>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileDrop(e.dataTransfer.files); }}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".stl";
                    input.onchange = () => handleFileDrop(input.files);
                    input.click();
                  }}
                  style={{
                    border: `1px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 3,
                    padding: pendingFile ? "8px 12px" : "16px 12px",
                    textAlign: "center",
                    cursor: "pointer",
                    background: dragOver ? "var(--bg-selection)" : "transparent",
                    transition: "border-color 150ms, background 150ms",
                  }}
                >
                  {pendingFile ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "var(--fg)" }}>{pendingFile.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPendingFile(null); }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--fg-muted)",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "0 4px",
                        }}
                        aria-label="Remove file"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: 0 }}>
                      Drop STL here or click to browse
                    </p>
                  )}
                </div>

                {/* Unit selector + scale preview — shown when a file is staged */}
                {pendingFile && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label style={{ fontSize: 11, color: "var(--fg-muted)", whiteSpace: "nowrap" }}>
                        STL units:
                      </label>
                      <select
                        value={stlUnit}
                        onChange={(e) => setStlUnit(e.target.value)}
                        style={{
                          flex: 1,
                          fontSize: 12,
                          padding: "3px 6px",
                          background: "var(--bg-elevated)",
                          color: "var(--fg)",
                          border: "1px solid var(--border)",
                          borderRadius: 2,
                        }}
                      >
                        {UNIT_OPTIONS.map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.label}{u.hint ? ` — ${u.hint}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {stlUnit !== "m" && (
                      <p style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 4 }}>
                        Vertices will be scaled by {UNIT_OPTIONS.find((u) => u.value === stlUnit)?.scale} to convert to meters.
                      </p>
                    )}

                    {/* Resulting dimensions preview */}
                    {scaledDims && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 8,
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--border)",
                          borderRadius: 2,
                        }}
                      >
                        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", marginBottom: 4 }}>
                          Resulting dimensions after scaling
                        </p>
                        <div style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)" }}>
                          <div style={{ display: "flex", gap: 16, color: "var(--fg)" }}>
                            <span style={{ color: "var(--fg-muted)", minWidth: 40 }}>Meters:</span>
                            <span>{scaledDims.m.x.toFixed(3)} &times; {scaledDims.m.y.toFixed(3)} &times; {scaledDims.m.z.toFixed(3)} m</span>
                          </div>
                          <div style={{ display: "flex", gap: 16, color: "var(--fg)", marginTop: 2 }}>
                            <span style={{ color: "var(--fg-muted)", minWidth: 40 }}>Feet:</span>
                            <span>{scaledDims.ft.x.toFixed(2)} &times; {scaledDims.ft.y.toFixed(2)} &times; {scaledDims.ft.z.toFixed(2)} ft</span>
                          </div>
                        </div>
                        {scaledDims.m.x < 0.01 && scaledDims.m.y < 0.01 && scaledDims.m.z < 0.01 && (
                          <p style={{ fontSize: 11, color: "var(--warning)", marginTop: 6 }}>
                            Very small — dimensions are all under 1 cm. Check if the correct unit is selected.
                          </p>
                        )}
                        {(scaledDims.m.x > 1000 || scaledDims.m.y > 1000 || scaledDims.m.z > 1000) && (
                          <p style={{ fontSize: 11, color: "var(--warning)", marginTop: 6 }}>
                            Very large — a dimension exceeds 1 km. Check if the correct unit is selected.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Post-upload: 3D preview + transform controls ── */}
            {uploadInfo && caseName && (
              <div style={{ marginTop: 16 }}>
                {/* Upload info summary */}
                <div style={{ display: "flex", gap: 6, fontSize: 11, color: "var(--fg-muted)", marginBottom: 8 }}>
                  <span>{uploadInfo.filename}</span>
                  <span>&middot;</span>
                  <span>{uploadInfo.triangles.toLocaleString()} triangles</span>
                </div>

                {/* 3D preview */}
                <div style={{ height: 250, border: "1px solid var(--border)", borderRadius: 2, overflow: "hidden" }}>
                  <MeshPreview caseName={caseName} refreshKey={previewKey} />
                </div>

                {/* Bounding box readout */}
                {uploadInfo.bounds && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 8,
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: 2,
                    }}
                  >
                    <p style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", marginBottom: 4 }}>
                      Bounding box (meters)
                    </p>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--fg)" }}>
                      <span>
                        <span style={{ color: "#ef4444" }}>X:</span>{" "}
                        {uploadInfo.bounds.min[0].toFixed(3)} to {uploadInfo.bounds.max[0].toFixed(3)}
                        <span style={{ color: "var(--fg-muted)" }}> ({(uploadInfo.bounds.max[0] - uploadInfo.bounds.min[0]).toFixed(3)})</span>
                      </span>
                      <span>
                        <span style={{ color: "#22c55e" }}>Y:</span>{" "}
                        {uploadInfo.bounds.min[1].toFixed(3)} to {uploadInfo.bounds.max[1].toFixed(3)}
                        <span style={{ color: "var(--fg-muted)" }}> ({(uploadInfo.bounds.max[1] - uploadInfo.bounds.min[1]).toFixed(3)})</span>
                      </span>
                      <span>
                        <span style={{ color: "#3b82f6" }}>Z:</span>{" "}
                        {uploadInfo.bounds.min[2].toFixed(3)} to {uploadInfo.bounds.max[2].toFixed(3)}
                        <span style={{ color: "var(--fg-muted)" }}> ({(uploadInfo.bounds.max[2] - uploadInfo.bounds.min[2]).toFixed(3)})</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* Axis alignment controls */}
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: 2,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)" }}>
                      Align Geometry to Simulation Axes
                    </span>
                    {transforming && (
                      <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>Applying...</span>
                    )}
                  </div>

                  <p style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.5, marginBottom: 8 }}>
                    Expected: <span style={{ color: "#ef4444" }}>X = flow direction</span>,{" "}
                    <span style={{ color: "#22c55e" }}>Y = lateral (symmetry at Y=0)</span>,{" "}
                    <span style={{ color: "#3b82f6" }}>Z = up</span>.
                  </p>

                  {/* Rotate 90° */}
                  <p style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", marginBottom: 4 }}>
                    Rotate 90&deg;
                  </p>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                    {([
                      { label: "X +90°", axis: "rotate_x", neg: false },
                      { label: "X -90°", axis: "rotate_x", neg: true },
                      { label: "Y +90°", axis: "rotate_y", neg: false },
                      { label: "Y -90°", axis: "rotate_y", neg: true },
                      { label: "Z +90°", axis: "rotate_z", neg: false },
                      { label: "Z -90°", axis: "rotate_z", neg: true },
                    ] as const).map(({ label, axis, neg }) => (
                      <TransformBtn
                        key={label}
                        label={label}
                        disabled={transforming}
                        onClick={() => handleTransform({ [axis]: neg ? -90 : 90 })}
                      />
                    ))}
                  </div>

                  {/* Common axis swaps */}
                  <p style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", marginBottom: 4 }}>
                    Common axis swaps
                  </p>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                    <TransformBtn label="Y-up → Z-up" disabled={transforming} onClick={() => handleTransform({ rotate_x: 90 })} />
                    <TransformBtn label="Front Y → Front X" disabled={transforming} onClick={() => handleTransform({ rotate_z: 90 })} />
                    <TransformBtn label="Z-forward → X-forward" disabled={transforming} onClick={() => handleTransform({ rotate_x: -90 })} />
                    <TransformBtn label="Flip upside-down" disabled={transforming} onClick={() => handleTransform({ rotate_x: 180 })} />
                  </div>

                  {/* Auto-position */}
                  <p style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", marginBottom: 4 }}>
                    Auto-position
                  </p>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {uploadInfo.bounds && (
                      <>
                        <TransformBtn
                          label="Snap to ground (Z=0)"
                          disabled={transforming}
                          onClick={() => {
                            const minZ = uploadInfo.bounds.min[2];
                            if (Math.abs(minZ) > 0.001) handleTransform({ translate_z: -minZ });
                          }}
                        />
                        <TransformBtn
                          label="Snap to symmetry (Y=0)"
                          disabled={transforming}
                          onClick={() => {
                            const minY = uploadInfo.bounds.min[1];
                            if (Math.abs(minY) > 0.001) handleTransform({ translate_y: -minY });
                          }}
                        />
                        <TransformBtn
                          label="Center X at origin"
                          disabled={transforming}
                          onClick={() => {
                            const cx = (uploadInfo.bounds.min[0] + uploadInfo.bounds.max[0]) / 2;
                            if (Math.abs(cx) > 0.001) handleTransform({ translate_x: -cx });
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Action button */}
            <div style={{ marginTop: 24 }}>
              {createError && (
                <p
                  style={{
                    color: "var(--error)",
                    fontSize: 12,
                    marginBottom: 8,
                    padding: "6px 10px",
                    border: "1px solid var(--error)",
                    borderRadius: 3,
                  }}
                >
                  {createError}
                </p>
              )}
              {uploadInfo ? (
                /* After STL upload — user has reviewed preview + transforms, continue to next step */
                <button
                  onClick={handleContinue}
                  style={{
                    background: "var(--accent)",
                    color: "#09090B",
                    border: "none",
                    borderRadius: 2,
                    padding: "8px 20px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Continue &#9654;
                </button>
              ) : caseAlreadyCreated ? (
                <button
                  onClick={handleContinue}
                  style={{
                    background: "var(--accent)",
                    color: "#09090B",
                    border: "none",
                    borderRadius: 2,
                    padding: "8px 20px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Continue &#9654;
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  style={{
                    background: creating ? "var(--bg-elevated)" : "var(--accent)",
                    color: creating ? "var(--fg-disabled)" : "#09090B",
                    border: "none",
                    borderRadius: 2,
                    padding: "8px 20px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: creating ? "not-allowed" : "pointer",
                  }}
                >
                  {creating
                    ? pendingFile ? "Uploading STL..." : "Creating case..."
                    : selected.category === "verification"
                      ? "Run Tutorial \u25B6"
                      : "Create Case \u25B6"}
                </button>
              )}
            </div>
          </>
        ) : (
          <p style={{ color: "var(--fg-muted)", fontSize: 13, textAlign: "center", marginTop: 80 }}>
            Select a template to see details
          </p>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function TransformBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: "3px 8px",
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: 2,
        color: disabled ? "var(--fg-disabled)" : "var(--fg)",
        cursor: disabled ? "wait" : "pointer",
        transition: "border-color 100ms",
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
      }}
    >
      {label}
    </button>
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <div
      role="presentation"
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--fg-muted)",
        letterSpacing: "0.05em",
        padding: "12px 12px 4px",
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}

function ListItem({
  template,
  selected,
  available,
  tutorialCompleted,
  onClick,
}: {
  template: Template;
  selected: boolean;
  available: boolean;
  tutorialCompleted: boolean;
  onClick: () => void;
}) {
  const isVerification = template.category === "verification";

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={!available}
      aria-label={
        !available
          ? `${template.name} (coming soon)`
          : isVerification
            ? `${template.name} (${tutorialCompleted ? "completed" : "not yet run"})`
            : template.name
      }
      onClick={available ? onClick : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: "0 12px",
        fontSize: 13,
        cursor: available ? "pointer" : "default",
        color: available ? "var(--fg)" : "var(--fg-disabled)",
        background: selected ? "var(--bg-selection)" : "transparent",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 100ms ease",
      }}
      onMouseEnter={(e) => {
        if (available && !selected) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {isVerification && (
        <span style={{ fontSize: 10, lineHeight: 1 }}>
          {tutorialCompleted ? "\u25CF" : "\u25CB"}
        </span>
      )}
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {template.name}
      </span>
      {!available && (
        <span style={{ fontSize: 11, color: "var(--fg-disabled)" }}>(soon)</span>
      )}
    </div>
  );
}
