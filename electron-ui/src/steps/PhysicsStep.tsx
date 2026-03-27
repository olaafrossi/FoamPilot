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
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, color: "var(--fg)", fontFamily: "var(--font-display)" }}>Physics</h2>
      <p style={{ color: "var(--fg-muted)", fontSize: 13, marginBottom: 24 }}>
        Set boundary conditions for velocity, pressure, and turbulence fields.
      </p>

      {error && (
        <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          marginBottom: 8,
          height: 35,
          background: "var(--bg-surface)",
        }}
      >
        {BC_FILES.map((f, idx) => (
          <button
            key={f.key}
            onClick={() => handleTabChange(idx)}
            style={{
              height: 35,
              display: "flex",
              alignItems: "center",
              padding: "0 16px",
              fontSize: 13,
              background: idx === activeTab ? "var(--bg-editor)" : "var(--bg-surface)",
              color: idx === activeTab ? "var(--fg)" : "var(--fg-muted)",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              borderBottom: idx === activeTab ? "2px solid var(--accent)" : "2px solid transparent",
              borderRadius: 0,
              cursor: "pointer",
              transition: "color 0.15s",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Description for active file */}
      <div
        style={{
          padding: "8px 16px",
          marginBottom: 16,
          fontSize: 13,
          color: "var(--fg-muted)",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        {currentFile.description}
      </div>

      {/* Editor */}
      {loading ? (
        <div style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-muted)" }}>
          Loading files...
        </div>
      ) : (
        <FoamEditor
          height="400px"
          value={fileContents[currentFile.key] ?? ""}
          onChange={handleEditorChange}
        />
      )}

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
        <button
          onClick={goBack}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            padding: "8px 24px",
            borderRadius: 2,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          &larr; Back
        </button>
        <button
          onClick={handleNext}
          style={{
            background: "var(--accent)",
            color: "#09090B",
            padding: "8px 24px",
            borderRadius: 2,
            fontWeight: 600,
            fontSize: 13,
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
