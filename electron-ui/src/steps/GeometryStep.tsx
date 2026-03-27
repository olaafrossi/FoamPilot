import { useState, useEffect, useCallback } from "react";
import { LayoutGrid, Upload, Info, Wind, Tag } from "lucide-react";
import { fetchTemplates, createCase, deleteCase, uploadGeometry, classifyGeometry } from "../api";
import type { Template, GeometryClassification } from "../types";
import MeshPreview from "../components/MeshPreview";

const UNIT_OPTIONS = [
  { label: "Millimeters (mm)", value: "mm", scale: 0.001, hint: "Most CAD tools export in mm" },
  { label: "Meters (m)", value: "m", scale: 1.0, hint: "Already in SI units" },
  { label: "Centimeters (cm)", value: "cm", scale: 0.01, hint: "" },
  { label: "Inches (in)", value: "in", scale: 0.0254, hint: "Common in imperial CAD" },
  { label: "Feet (ft)", value: "ft", scale: 0.3048, hint: "" },
] as const;

const USE_CASES = [
  { label: "External Aerodynamics", value: "external_aero", velocityHint: "10–80 m/s" },
  { label: "Drone / UAV", value: "drone", velocityHint: "5–30 m/s" },
  { label: "Automotive", value: "automotive", velocityHint: "20–60 m/s" },
  { label: "Wind Engineering", value: "wind_eng", velocityHint: "5–40 m/s" },
  { label: "Custom", value: "custom", velocityHint: "" },
] as const;

const GEO_CLASS_COLORS: Record<string, string> = {
  streamlined: "var(--success)",
  bluff: "var(--warning)",
  complex: "var(--error)",
};

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

type Mode = "choose" | "template" | "upload";

export default function GeometryStep({
  caseName,
  setCaseName,
  templateName,
  setTemplateName,
  goNext,
  goBack,
  completeStep,
  velocity,
  setVelocity,
  geometryClass,
  setGeometryClass,
}: StepProps) {
  const [mode, setMode] = useState<Mode>("choose");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [scaffoldTemplate, setScaffoldTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [stlUnit, setStlUnit] = useState("mm");
  const [uploadInfo, setUploadInfo] = useState<{
    filename: string;
    triangles: number;
    bounds: { min: number[]; max: number[] };
  } | null>(null);
  const [useCase, setUseCase] = useState("external_aero");
  const [classification, setClassification] = useState<GeometryClassification | null>(null);
  const [classOverride, setClassOverride] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "template") return;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const load = () => {
      fetchTemplates()
        .then((t) => {
          if (!cancelled) {
            setTemplates(t);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e.message);
            retryTimer = setTimeout(load, 3000);
          }
        });
    };

    load();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [mode]);

  // Auto-classify geometry when case is ready
  useEffect(() => {
    if (!caseName) return;
    let cancelled = false;
    classifyGeometry(caseName)
      .then((c) => {
        if (!cancelled) {
          setClassification(c);
          setGeometryClass(c.geometry_class);
        }
      })
      .catch(() => {/* geometry may not be uploaded yet for templates */});
    return () => { cancelled = true; };
  }, [caseName, uploadInfo, setGeometryClass]);

  const handleSelectTemplate = useCallback(
    async (tmpl: Template) => {
      // If template has no geometry, auto-switch to upload mode with this template as scaffold
      if (!tmpl.has_geometry) {
        setScaffoldTemplate(tmpl);
        setTemplateName(tmpl.name);
        setMode("upload");
        return;
      }

      setSelectedTemplate(tmpl);
      setError(null);
      setLoading(true);
      try {
        const name = tmpl.path.replace(/[^a-zA-Z0-9_-]/g, "");
        try {
          await deleteCase(name);
        } catch {
          // Case may not exist yet
        }
        await createCase(name, tmpl.path);
        setCaseName(name);
        setTemplateName(tmpl.name);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to create case");
      } finally {
        setLoading(false);
      }
    },
    [setCaseName, setTemplateName],
  );

  const handleFileDrop = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.name.toLowerCase().endsWith(".stl")) {
        setError("Please upload an STL file");
        return;
      }
      setError(null);
      setPendingFile(file);
    },
    [],
  );

  const handleUpload = useCallback(async () => {
    if (!pendingFile) return;
    setUploadedFile(pendingFile);
    setLoading(true);
    setError(null);
    const unitOption = UNIT_OPTIONS.find((u) => u.value === stlUnit) ?? UNIT_OPTIONS[0];
    const tplPath = scaffoldTemplate?.path ?? "motorBike";
    try {
      const name = pendingFile.name.replace(/\.stl$/i, "").replace(/\s+/g, "_").toLowerCase();
      setCaseName(name);
      const info = await uploadGeometry(name, pendingFile, unitOption.scale, tplPath);
      setUploadInfo(info);
      setPendingFile(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to upload geometry");
    } finally {
      setLoading(false);
    }
  }, [pendingFile, stlUnit, setCaseName, scaffoldTemplate]);

  const handleClassOverride = (value: string) => {
    setClassOverride(value);
    setGeometryClass(value);
  };

  const handleNext = () => {
    completeStep(0);
    goNext();
  };

  const ready =
    mode === "template"
      ? selectedTemplate !== null && !loading
      : uploadInfo !== null && !loading;

  // --- Choose mode ---
  if (mode === "choose") {
    return (
      <div>
        <h2
          className="mb-1"
          style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--fg)", letterSpacing: "-0.3px" }}
        >
          Geometry
        </h2>
        <p className="text-[13px] mb-8" style={{ color: "var(--fg-muted)" }}>
          Choose how to start your simulation. Pick a built-in template or
          upload your own STL file.
        </p>

        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          <button
            onClick={() => setMode("template")}
            className="p-6 text-left transition-all duration-200 group"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 0,
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--accent)";
              el.style.boxShadow = "0 0 0 1px rgba(245, 158, 11, 0.2), 0 4px 12px rgba(0,0,0,0.3)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--border)";
              el.style.boxShadow = "none";
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <LayoutGrid size={20} style={{ color: "var(--accent)" }} />
              <h3 className="font-semibold text-[14px]" style={{ color: "var(--fg)", fontFamily: "var(--font-display)" }}>
                Start from Template
              </h3>
            </div>
            <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
              Use a pre-configured case — race car, drone, plane, and more.
            </p>
          </button>

          <button
            onClick={() => setMode("upload")}
            className="p-6 text-left transition-all duration-200 group"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 0,
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--accent)";
              el.style.boxShadow = "0 0 0 1px rgba(245, 158, 11, 0.2), 0 4px 12px rgba(0,0,0,0.3)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--border)";
              el.style.boxShadow = "none";
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <Upload size={20} style={{ color: "var(--accent)" }} />
              <h3 className="font-semibold text-[14px]" style={{ color: "var(--fg)", fontFamily: "var(--font-display)" }}>
                Upload STL
              </h3>
            </div>
            <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
              Bring your own geometry as an STL mesh file.
            </p>
          </button>
        </div>
      </div>
    );
  }

  // --- Velocity & classification panel (shared by template + upload modes) ---
  const velocityPanel = (caseName || selectedTemplate) && (
    <div className="mt-6 space-y-4 max-w-2xl">
      {/* Use-case picker */}
      <div
        className="p-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Tag size={14} style={{ color: "var(--accent)" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--fg)" }}>Use Case</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {USE_CASES.map((uc) => (
            <button
              key={uc.value}
              onClick={() => setUseCase(uc.value)}
              className="px-3 py-1.5 text-[12px] transition-all"
              style={{
                background: useCase === uc.value ? "var(--accent)" : "transparent",
                color: useCase === uc.value ? "#09090B" : "var(--fg-muted)",
                border: useCase === uc.value ? "1px solid var(--accent)" : "1px solid var(--border)",
                fontWeight: useCase === uc.value ? 600 : 400,
              }}
            >
              {uc.label}
              {uc.velocityHint && (
                <span className="ml-1 opacity-60">({uc.velocityHint})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Velocity input */}
      <div
        className="p-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Wind size={14} style={{ color: "var(--accent)" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--fg)" }}>Freestream Velocity</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={velocity}
            onChange={(e) => setVelocity(Math.max(0, parseFloat(e.target.value) || 0))}
            className="w-32 px-3 py-2 text-[13px]"
            style={{
              background: "#1a1a1e",
              border: "1px solid var(--border)",
              color: "#e4e4e7",
              outline: "none",
            }}
            min={0}
            step={1}
          />
          <span className="text-[13px]" style={{ color: "var(--fg-muted)" }}>m/s</span>
          <span className="text-[11px] ml-2" style={{ color: "var(--fg-muted)" }}>
            {velocity > 0 ? `${(velocity * 3.6).toFixed(0)} km/h` : ""}
            {velocity > 0 ? ` / ${(velocity * 2.237).toFixed(0)} mph` : ""}
          </span>
        </div>
      </div>

      {/* Geometry classification */}
      {classification && (
        <div
          className="p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: GEO_CLASS_COLORS[geometryClass ?? classification.geometry_class] ?? "var(--fg-muted)" }}
              />
              <span className="text-[13px] font-semibold" style={{ color: "var(--fg)" }}>
                Geometry: {(geometryClass ?? classification.geometry_class).charAt(0).toUpperCase() + (geometryClass ?? classification.geometry_class).slice(1)}
              </span>
            </div>
            <select
              value={classOverride ?? classification.geometry_class}
              onChange={(e) => handleClassOverride(e.target.value)}
              className="text-[11px] px-2 py-1"
              style={{
                background: "#1a1a1e",
                border: "1px solid var(--border)",
                color: "var(--fg-muted)",
                outline: "none",
              }}
            >
              <option value="streamlined">Streamlined</option>
              <option value="bluff">Bluff</option>
              <option value="complex">Complex</option>
            </select>
          </div>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            {classification.description}
          </p>
          {classification.warning && (
            <p className="text-[12px] mt-1" style={{ color: "var(--warning)" }}>
              {classification.warning}
            </p>
          )}
          <div className="flex gap-6 mt-2 text-[11px]" style={{ color: "var(--fg-muted)" }}>
            <span>L = {classification.characteristic_length.toFixed(3)} m</span>
            <span>A = {classification.frontal_area.toFixed(4)} m²</span>
            <span>AR = {classification.aspect_ratio.toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );

  // --- Template mode ---
  if (mode === "template") {
    const aeroTemplates = templates.filter((t) => t.category !== "learning");
    const learningTemplates = templates.filter((t) => t.category === "learning");

    return (
      <div>
        <h2
          className="mb-1"
          style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--fg)", letterSpacing: "-0.3px" }}
        >
          Geometry — Pick a Template
        </h2>
        <p className="text-[13px] mb-6" style={{ color: "var(--fg-muted)" }}>
          Select a pre-built OpenFOAM case to get started quickly.
        </p>

        {error && (
          <div className="text-[13px] mb-4" style={{ color: "var(--error)" }}>{error}</div>
        )}

        {/* External Aero templates */}
        {aeroTemplates.length > 0 && (
          <>
            <h3
              className="mb-3 text-[16px]"
              style={{ fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--fg)" }}
            >
              {/* Template thumbnail placeholder */}
              <div
                className="mb-3 flex items-center justify-center text-[11px]"
                style={{
                  height: 80,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  color: "var(--fg-muted)",
                  overflow: "hidden",
                }}
              >
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <rect x="4" y="12" width="32" height="16" rx="2" stroke="var(--fg-muted)" strokeWidth="1" fill="none" opacity="0.4" />
                  <path d="M8 20 L16 16 L24 22 L32 18" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.6" />
                </svg>
              </div>
              <h3 className="font-semibold mb-1 text-[13px]" style={{ color: "var(--fg)" }}>{tmpl.name}</h3>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
                {tmpl.description}
              </p>
            </button>
          ))}
        </div>

        {selectedTemplate && !loading && (
          <div
            className="p-4 mb-4 max-w-md"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 0,
            }}
          >
            <p className="text-[13px]" style={{ color: "var(--fg)" }}>
              <span style={{ color: "var(--fg-muted)" }}>Template:</span>{" "}
              {selectedTemplate.name}
            </p>
            <p className="text-[13px]" style={{ color: "var(--fg)" }}>
              <span style={{ color: "var(--fg-muted)" }}>Case name:</span> {caseName}
            </p>
          </div>
        )}

        {loading && (
          <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
            Creating case from template...
          </p>
        )}

        {velocityPanel}

        <div className="flex justify-between mt-6">
          <button
            onClick={() => {
              setMode("choose");
              setSelectedTemplate(null);
            }}
            className="px-6 py-2 rounded-sm transition-colors duration-100"
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--fg)",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            &larr; Back
          </button>
          <button
            onClick={handleNext}
            disabled={!ready}
            className="px-6 py-2 rounded-sm font-semibold text-[13px] transition-colors duration-100"
            style={{
              background: ready ? "var(--accent)" : "var(--bg-elevated)",
              color: ready ? "#09090B" : "var(--fg-disabled)",
              cursor: ready ? "pointer" : "not-allowed",
            }}
            onMouseEnter={(e) => {
              if (ready) (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)";
            }}
            onMouseLeave={(e) => {
              if (ready) (e.currentTarget as HTMLElement).style.background = "var(--accent)";
            }}
          >
            Next &rarr;
          </button>
        </div>
      </div>
    );
  }

  // --- Upload mode ---
  return (
    <div>
      <h2
        className="mb-1"
        style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--fg)", letterSpacing: "-0.3px" }}
      >
        Geometry — Upload STL
      </h2>
      <p className="text-[13px] mb-6" style={{ color: "var(--fg-muted)" }}>
        Drag and drop your STL file or click to browse.
      </p>

      {error && (
        <div className="text-[13px] mb-4" style={{ color: "var(--error)" }}>{error}</div>
      )}

      {/* Physics scaffold banner */}
      {scaffoldTemplate && (
        <div
          className="p-4 mb-4 max-w-xl flex gap-3 items-start"
          style={{
            background: "var(--bg-surface)",
            borderLeft: "2px solid var(--accent)",
            border: "1px solid var(--border)",
            borderLeftColor: "var(--accent)",
            borderLeftWidth: 2,
            borderRadius: 0,
          }}
        >
          <Info size={16} className="shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
          <div>
            <p className="text-[13px] font-semibold mb-1" style={{ color: "var(--fg)", fontFamily: "var(--font-display)" }}>
              Using {scaffoldTemplate.name} physics
            </p>
            <p className="text-[11px]" style={{ color: "var(--fg-muted)" }}>
              {scaffoldTemplate.domain_type === "freestream"
                ? "Freestream domain — no ground plane. "
                : "Ground-effect domain — moving road surface. "}
              Upload your geometry below and the boundary conditions, solver settings, and
              force coefficients will be configured for this template.
            </p>
          </div>
        </div>
      )}

      {!uploadInfo && !pendingFile && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFileDrop(e.dataTransfer.files);
          }}
          className="border-2 border-dashed p-12 text-center transition-all duration-200 max-w-xl"
          style={{
            borderColor: dragOver ? "var(--accent)" : "var(--border)",
            background: dragOver ? "var(--accent-bg)" : "transparent",
            borderRadius: 4,
          }}
        >
          <p className="mb-3 text-[13px]" style={{ color: "var(--fg)" }}>Drop your .stl file here</p>
          <label
            className="px-4 py-2 rounded-sm cursor-pointer text-[13px] transition-colors duration-100"
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--fg)",
            }}
          >
            Browse Files
            <input
              type="file"
              accept=".stl"
              className="hidden"
              onChange={(e) => handleFileDrop(e.target.files)}
            />
          </label>
        </div>
      )}

      {/* --- Unit selector (shown after file picked, before upload) --- */}
      {pendingFile && !uploadInfo && !loading && (
        <div className="max-w-xl space-y-4">
          <div
            className="p-4"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 0,
            }}
          >
            <p className="text-[13px] mb-3" style={{ color: "var(--fg)" }}>
              <span style={{ color: "var(--fg-muted)" }}>File:</span>{" "}
              {pendingFile.name}
            </p>

            <label className="block text-[13px] mb-1.5 font-semibold" style={{ color: "var(--fg)", fontFamily: "var(--font-display)" }}>
              STL unit format
            </label>
            <select
              value={stlUnit}
              onChange={(e) => setStlUnit(e.target.value)}
              className="w-full px-3 py-2 text-[13px] mb-1"
              style={{
                background: "#1a1a1e",
                border: "1px solid var(--border)",
                borderRadius: 0,
                color: "#e4e4e7",
                outline: "none",
              }}
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value} style={{ background: "#1a1a1e", color: "#e4e4e7" }}>
                  {u.label}{u.hint ? ` — ${u.hint}` : ""}
                </option>
              ))}
            </select>
            {stlUnit !== "m" && (
              <p className="text-[11px] mt-1" style={{ color: "var(--fg-muted)" }}>
                Vertices will be scaled by {UNIT_OPTIONS.find((u) => u.value === stlUnit)?.scale} to convert to meters.
              </p>
            )}
          </div>

          <div
            className="p-4 flex gap-3 items-start"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 0,
            }}
          >
            <Info size={16} className="shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              OpenFOAM works in SI units (meters). Most CAD tools export STL
              files in millimeters. If your geometry was exported in mm,
              select "Millimeters" above and the vertices will be rescaled
              before meshing.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setPendingFile(null)}
              className="px-4 py-2 text-[13px] transition-colors duration-100"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--fg)",
                borderRadius: 0,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              Choose different file
            </button>
            <button
              onClick={handleUpload}
              className="px-6 py-2 font-semibold text-[13px] transition-colors duration-100"
              style={{
                background: "var(--accent)",
                color: "#09090B",
                borderRadius: 0,
                border: "none",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent)"; }}
            >
              Upload &amp; Scale
            </button>
          </div>
        </div>
      )}

      {loading && (
        <p className="text-[13px] mt-4" style={{ color: "var(--fg-muted)" }}>
          Uploading{stlUnit !== "m" ? " and scaling" : ""} geometry...
        </p>
      )}

      {uploadInfo && (
        <div className="flex gap-4 mb-4 max-w-3xl">
          <div
            className="p-4 shrink-0"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 0,
              minWidth: 200,
            }}
          >
            <p className="text-[13px]" style={{ color: "var(--fg)" }}>
              <span style={{ color: "var(--fg-muted)" }}>File:</span>{" "}
              {uploadInfo.filename}
            </p>
            <p className="text-[13px]" style={{ color: "var(--fg)" }}>
              <span style={{ color: "var(--fg-muted)" }}>Triangles:</span>{" "}
              {uploadInfo.triangles.toLocaleString()}
            </p>
            <p className="text-[13px]" style={{ color: "var(--fg)" }}>
              <span style={{ color: "var(--fg-muted)" }}>Case name:</span> {caseName}
            </p>
            {scaffoldTemplate && (
              <p className="text-[13px]" style={{ color: "var(--fg)" }}>
                <span style={{ color: "var(--fg-muted)" }}>Physics:</span>{" "}
                {scaffoldTemplate.name}
              </p>
            )}
          </div>
          {caseName && (
            <div className="flex-1" style={{ minHeight: 300 }}>
              <MeshPreview caseName={caseName} />
            </div>
          )}
        </div>
      )}

      {velocityPanel}

      <div className="flex justify-between mt-6">
        <button
          onClick={() => {
            if (scaffoldTemplate) {
              // Go back to template picker, not choose mode
              setScaffoldTemplate(null);
              setMode("template");
            } else {
              setMode("choose");
            }
            setUploadedFile(null);
            setPendingFile(null);
            setUploadInfo(null);
          }}
          className="px-6 py-2 rounded-sm transition-colors duration-100"
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--fg)",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          &larr; Back
        </button>
        <button
          onClick={handleNext}
          disabled={!ready}
          className="px-6 py-2 rounded-sm font-semibold text-[13px] transition-colors duration-100"
          style={{
            background: ready ? "var(--accent)" : "var(--bg-elevated)",
            color: ready ? "#09090B" : "var(--fg-disabled)",
            cursor: ready ? "pointer" : "not-allowed",
          }}
          onMouseEnter={(e) => {
            if (ready) (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            if (ready) (e.currentTarget as HTMLElement).style.background = "var(--accent)";
          }}
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}


// --- Template Card Component ---

function TemplateCard({
  tmpl,
  Icon,
  selected,
  loading,
  onSelect,
}: {
  tmpl: Template;
  Icon: typeof Bike;
  selected: boolean;
  loading: boolean;
  onSelect: (tmpl: Template) => void;
}) {
  return (
    <button
      onClick={() => onSelect(tmpl)}
      disabled={loading}
      aria-pressed={selected}
      className="p-4 text-left transition-all duration-200"
      style={{
        background: "var(--bg-surface)",
        border: selected
          ? "1px solid var(--accent)"
          : "1px solid var(--border)",
        borderRadius: 0,
        opacity: loading ? 0.5 : 1,
        cursor: loading ? "wait" : "pointer",
        boxShadow: selected
          ? "0 0 0 1px rgba(245, 158, 11, 0.2)"
          : "none",
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = "var(--fg-muted)";
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
        }
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={16} style={{ color: "var(--accent)" }} />
        <h3 className="font-semibold text-[13px] flex-1" style={{ color: "var(--fg)" }}>{tmpl.name}</h3>
        {tmpl.difficulty && (
          <span
            className="text-[11px] px-1.5 py-0.5"
            style={{
              color: "var(--fg-muted)",
              background: "var(--bg-elevated)",
              borderRadius: 2,
            }}
          >
            {tmpl.difficulty}
          </span>
        )}
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        {tmpl.description}
      </p>
      {!tmpl.has_geometry && tmpl.category !== "learning" && (
        <p className="text-[11px] mt-1.5" style={{ color: "var(--accent)" }}>
          Bring your own STL
        </p>
      )}
    </button>
  );
}
