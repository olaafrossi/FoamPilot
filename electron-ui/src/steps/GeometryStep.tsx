import { useState, useEffect, useCallback } from "react";
import { LayoutGrid, Upload, Info } from "lucide-react";
import { fetchTemplates, createCase, deleteCase, uploadGeometry } from "../api";
import type { Template } from "../types";
import MeshPreview from "../components/MeshPreview";

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
}: StepProps) {
  const [mode, setMode] = useState<Mode>("choose");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
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
            // Retry every 3s so the error auto-clears when the backend recovers
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

  const handleSelectTemplate = useCallback(
    async (tmpl: Template) => {
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
    try {
      const name = pendingFile.name.replace(/\.stl$/i, "").replace(/\s+/g, "_").toLowerCase();
      setCaseName(name);
      const info = await uploadGeometry(name, pendingFile, unitOption.scale);
      setUploadInfo(info);
      setPendingFile(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to upload geometry");
    } finally {
      setLoading(false);
    }
  }, [pendingFile, stlUnit, setCaseName]);

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
              Use a pre-configured case — Ahmed body, NACA airfoil, and more.
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

  // --- Template mode ---
  if (mode === "template") {
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

        <div className="grid grid-cols-3 gap-4 mb-6">
          {templates.map((tmpl) => (
            <button
              key={tmpl.name}
              onClick={() => handleSelectTemplate(tmpl)}
              disabled={loading}
              className="p-4 text-left transition-all duration-200"
              style={{
                background: "var(--bg-surface)",
                border: selectedTemplate?.name === tmpl.name
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border)",
                borderRadius: 0,
                opacity: loading ? 0.5 : 1,
                cursor: loading ? "wait" : "pointer",
                boxShadow: selectedTemplate?.name === tmpl.name
                  ? "0 0 0 1px rgba(245, 158, 11, 0.2)"
                  : "none",
              }}
              onMouseEnter={(e) => {
                if (selectedTemplate?.name !== tmpl.name) {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--fg-muted)";
                }
              }}
              onMouseLeave={(e) => {
                if (selectedTemplate?.name !== tmpl.name) {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                }
              }}
            >
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
              files in millimeters. The motorBike tutorial ships its STL
              already scaled to meters — if your geometry was exported in mm,
              select "Millimeters" above and the vertices will be rescaled
              before meshing. Everything in the case setup (domain bounds,
              refinement regions, boundary conditions) must agree on meters.
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
          </div>
          {caseName && (
            <div className="flex-1" style={{ minHeight: 300 }}>
              <MeshPreview caseName={caseName} />
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button
          onClick={() => {
            setMode("choose");
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
