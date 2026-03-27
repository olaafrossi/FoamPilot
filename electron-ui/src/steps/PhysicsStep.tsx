import { useState, useEffect, useCallback } from "react";
import FoamEditor from "../components/FoamEditor";
import { readFile, writeFile } from "../api";

interface StepProps {
  caseName: string | null;
  setCaseName: (name: string) => void;
  templateName: string | null;
  setTemplateName: (name: string) => void;
  goNext: () => void;
  goBack: () => void;
  completeStep: (step: number) => void;
}

const BC_FILES = [
  {
    key: "U",
    path: "0/U",
    label: "U",
    description:
      "Velocity \u2014 how fast the air moves. Default: 20 m/s in X direction (freestream)",
  },
  {
    key: "p",
    path: "0/p",
    label: "p",
    description:
      "Pressure \u2014 the pressure field. Default: 0 at outlet, zero-gradient elsewhere",
  },
  {
    key: "k",
    path: "0/k",
    label: "k",
    description:
      "Turbulent kinetic energy \u2014 measures turbulence intensity. Auto-calculated from velocity",
  },
  {
    key: "omega",
    path: "0/omega",
    label: "omega",
    description:
      "Specific dissipation rate \u2014 turbulence frequency. Auto-calculated from velocity",
  },
  {
    key: "nut",
    path: "0/nut",
    label: "nut",
    description:
      "Turbulent viscosity \u2014 computed by the solver. Usually just needs boundary types",
  },
];

export default function PhysicsStep({
  caseName,
  goNext,
  goBack,
  completeStep,
}: StepProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load all BC files on mount
  useEffect(() => {
    if (!caseName) return;
    setLoading(true);
    Promise.allSettled(
      BC_FILES.map((f) =>
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
      const fileDef = BC_FILES.find((f) => f.key === key);
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
    const currentKey = BC_FILES[activeTab].key;
    await saveFile(currentKey);
    setActiveTab(idx);
  };

  const handleEditorChange = (value: string | undefined) => {
    const key = BC_FILES[activeTab].key;
    setFileContents((prev) => ({ ...prev, [key]: value ?? "" }));
    setDirty((d) => ({ ...d, [key]: true }));
  };

  const handleNext = async () => {
    // Save current tab before moving on
    const currentKey = BC_FILES[activeTab].key;
    await saveFile(currentKey);
    completeStep(2);
    goNext();
  };

  const currentFile = BC_FILES[activeTab];

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: "#ffffff" }}>Physics</h2>
      <p className="text-[#858585] text-[13px] mb-6">
        Set boundary conditions for velocity, pressure, and turbulence fields.
      </p>

      {error && (
        <div className="text-[#f48771] text-[13px] mb-4">{error}</div>
      )}

      {/* Tab bar */}
      <div
        className="flex border-b border-[#474747] mb-2"
        style={{ height: 35, background: "var(--bg-tab-inactive)" }}
      >
        {BC_FILES.map((f, idx) => (
          <button
            key={f.key}
            onClick={() => handleTabChange(idx)}
            className="px-4 text-[13px] transition-colors"
            style={{
              height: 35,
              display: "flex",
              alignItems: "center",
              background: idx === activeTab ? "var(--bg-editor)" : "var(--bg-tab-inactive)",
              color: idx === activeTab ? "#ffffff" : "#858585",
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

      {/* Description for active file */}
      <div
        className="px-4 py-2 mb-4 text-[13px] text-[#858585] border-b border-[#474747]"
        style={{ background: "var(--bg-sidebar)" }}
      >
        {currentFile.description}
      </div>

      {/* Editor */}
      {loading ? (
        <div className="h-[400px] flex items-center justify-center text-[#858585]">
          Loading files...
        </div>
      ) : (
        <FoamEditor
          height="400px"
          defaultLanguage="plaintext"
          theme="vs-dark"
          value={fileContents[currentFile.key] ?? ""}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "Cascadia Code, Consolas, monospace",
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "off",
            automaticLayout: true,
          }}
        />
      )}

      {/* Navigation */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={goBack}
          className="bg-transparent border border-[#474747] text-[#cccccc] hover:bg-[#2a2d2e] px-6 py-2 rounded-sm"
        >
          &larr; Back
        </button>
        <button
          onClick={handleNext}
          className="bg-[#0e639c] hover:bg-[#1177bb] text-white px-6 py-2 rounded-sm font-semibold text-[13px]"
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
