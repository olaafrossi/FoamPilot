import { useState, useEffect, useCallback } from "react";
import { fetchTemplates, createCase, deleteCase, uploadGeometry } from "../api";
import type { Template } from "../types";

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
  const [uploadInfo, setUploadInfo] = useState<{
    filename: string;
    triangles: number;
    bounds: { min: number[]; max: number[] };
  } | null>(null);

  useEffect(() => {
    if (mode === "template") {
      fetchTemplates()
        .then(setTemplates)
        .catch((e) => setError(e.message));
    }
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
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.name.toLowerCase().endsWith(".stl")) {
        setError("Please upload an STL file");
        return;
      }
      setUploadedFile(file);
      setError(null);
      setLoading(true);
      try {
        const name = file.name.replace(/\.stl$/i, "").replace(/\s+/g, "_").toLowerCase();
        setCaseName(name);
        const info = await uploadGeometry(name, file);
        setUploadInfo(info);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to upload geometry");
      } finally {
        setLoading(false);
      }
    },
    [setCaseName],
  );

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
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: "#ffffff" }}>Geometry</h2>
        <p className="text-[#858585] text-[13px] mb-6">
          Choose how to start your simulation. Pick a built-in template or
          upload your own STL file.
        </p>

        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          <button
            onClick={() => setMode("template")}
            className="bg-[#252526] border border-[#474747] p-6 text-left hover:border-[#0078d4] transition-colors"
            style={{ borderRadius: 0 }}
          >
            <h3 className="text-white font-semibold mb-2 text-[14px]">Start from Template</h3>
            <p className="text-[#858585] text-[13px]">
              Use a pre-configured case — Ahmed body, NACA airfoil, and more.
            </p>
          </button>

          <button
            onClick={() => setMode("upload")}
            className="bg-[#252526] border border-[#474747] p-6 text-left hover:border-[#0078d4] transition-colors"
            style={{ borderRadius: 0 }}
          >
            <h3 className="text-white font-semibold mb-2 text-[14px]">Upload STL</h3>
            <p className="text-[#858585] text-[13px]">
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
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: "#ffffff" }}>
          Geometry — Pick a Template
        </h2>
        <p className="text-[#858585] text-[13px] mb-6">
          Select a pre-built OpenFOAM case to get started quickly.
        </p>

        {error && (
          <div className="text-[#f48771] text-[13px] mb-4">{error}</div>
        )}

        <div className="grid grid-cols-3 gap-4 mb-6">
          {templates.map((tmpl) => (
            <button
              key={tmpl.name}
              onClick={() => handleSelectTemplate(tmpl)}
              disabled={loading}
              className={
                "bg-[#252526] border p-4 text-left transition-colors " +
                (selectedTemplate?.name === tmpl.name
                  ? "border-[#0078d4]"
                  : "border-[#474747] hover:border-[#858585]") +
                (loading ? " opacity-50 cursor-wait" : "")
              }
              style={{ borderRadius: 0 }}
            >
              <h3 className="text-white font-semibold mb-1 text-[13px]">{tmpl.name}</h3>
              <p className="text-[#858585] text-[11px] leading-relaxed">
                {tmpl.description}
              </p>
            </button>
          ))}
        </div>

        {selectedTemplate && !loading && (
          <div className="bg-[#252526] border border-[#474747] p-4 mb-4 max-w-md" style={{ borderRadius: 0 }}>
            <p className="text-[13px] text-[#cccccc]">
              <span className="text-[#858585]">Template:</span>{" "}
              {selectedTemplate.name}
            </p>
            <p className="text-[13px] text-[#cccccc]">
              <span className="text-[#858585]">Case name:</span> {caseName}
            </p>
          </div>
        )}

        {loading && (
          <p className="text-[#858585] text-[13px]">
            Creating case from template...
          </p>
        )}

        <div className="flex justify-between mt-6">
          <button
            onClick={() => {
              setMode("choose");
              setSelectedTemplate(null);
            }}
            className="bg-transparent border border-[#474747] text-[#cccccc] hover:bg-[#2a2d2e] px-6 py-2 rounded-sm"
          >
            &larr; Back
          </button>
          <button
            onClick={handleNext}
            disabled={!ready}
            className={
              "px-6 py-2 rounded-sm font-semibold text-[13px] " +
              (ready
                ? "bg-[#0e639c] hover:bg-[#1177bb] text-white"
                : "bg-[#3c3c3c] text-[#858585] cursor-not-allowed")
            }
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
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: "#ffffff" }}>Geometry — Upload STL</h2>
      <p className="text-[#858585] text-[13px] mb-6">
        Drag and drop your STL file or click to browse.
      </p>

      {error && (
        <div className="text-[#f48771] text-[13px] mb-4">{error}</div>
      )}

      {!uploadInfo && (
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
          className={
            "border-2 border-dashed p-12 text-center transition-colors max-w-xl " +
            (dragOver
              ? "border-[#0078d4] bg-[rgba(0,120,212,0.1)]"
              : "border-[#474747] hover:border-[#858585]")
          }
          style={{ borderRadius: 4 }}
        >
          <p className="text-[#cccccc] mb-3 text-[13px]">Drop your .stl file here</p>
          <label className="bg-transparent border border-[#474747] text-[#cccccc] hover:bg-[#2a2d2e] px-4 py-2 rounded-sm cursor-pointer text-[13px]">
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

      {loading && (
        <p className="text-[#858585] text-[13px] mt-4">Uploading geometry...</p>
      )}

      {uploadInfo && (
        <div className="bg-[#252526] border border-[#474747] p-4 max-w-md mb-4" style={{ borderRadius: 0 }}>
          <p className="text-[13px] text-[#cccccc]">
            <span className="text-[#858585]">File:</span>{" "}
            {uploadInfo.filename}
          </p>
          <p className="text-[13px] text-[#cccccc]">
            <span className="text-[#858585]">Triangles:</span>{" "}
            {uploadInfo.triangles.toLocaleString()}
          </p>
          <p className="text-[13px] text-[#cccccc]">
            <span className="text-[#858585]">Case name:</span> {caseName}
          </p>
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button
          onClick={() => {
            setMode("choose");
            setUploadedFile(null);
            setUploadInfo(null);
          }}
          className="bg-transparent border border-[#474747] text-[#cccccc] hover:bg-[#2a2d2e] px-6 py-2 rounded-sm"
        >
          &larr; Back
        </button>
        <button
          onClick={handleNext}
          disabled={!ready}
          className={
            "px-6 py-2 rounded-sm font-semibold text-[13px] " +
            (ready
              ? "bg-[#0e639c] hover:bg-[#1177bb] text-white"
              : "bg-[#3c3c3c] text-[#858585] cursor-not-allowed")
          }
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
