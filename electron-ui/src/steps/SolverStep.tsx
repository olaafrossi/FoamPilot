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
  velocity: number;
  setVelocity: (v: number) => void;
  geometryClass: string | null;
  setGeometryClass: (c: string | null) => void;
}

const SOLVER_FILES = [
  {
    key: "controlDict",
    path: "system/controlDict",
    label: "controlDict",
    description:
      "Simulation control \u2014 endTime sets iterations (e.g. 500), writeInterval controls how often results are saved",
  },
  {
    key: "fvSchemes",
    path: "system/fvSchemes",
    label: "fvSchemes",
    description:
      "Numerical schemes \u2014 how equations are discretized. The defaults are good for most cases",
  },
  {
    key: "fvSolution",
    path: "system/fvSolution",
    label: "fvSolution",
    description:
      "Solver settings \u2014 linear solver tolerances and algorithm. Rarely needs changing",
  },
];

export default function SolverStep({
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

  // Load all solver files on mount
  useEffect(() => {
    if (!caseName) return;
    setLoading(true);
    Promise.allSettled(
      SOLVER_FILES.map((f) =>
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
      const fileDef = SOLVER_FILES.find((f) => f.key === key);
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
    const currentKey = SOLVER_FILES[activeTab].key;
    await saveFile(currentKey);
    setActiveTab(idx);
  };

  const handleEditorChange = (value: string | undefined) => {
    const key = SOLVER_FILES[activeTab].key;
    setFileContents((prev) => ({ ...prev, [key]: value ?? "" }));
    setDirty((d) => ({ ...d, [key]: true }));
  };

  const handleNext = async () => {
    const currentKey = SOLVER_FILES[activeTab].key;
    await saveFile(currentKey);
    completeStep(3);
    goNext();
  };

  const currentFile = SOLVER_FILES[activeTab];

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, marginBottom: 4, color: "var(--fg)" }}>Solver Settings</h2>
      <p style={{ color: "var(--fg-muted)", fontSize: 13, marginBottom: 24 }}>
        Configure simulation control, numerical schemes, and solver parameters.
      </p>

      {error && (
        <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {/* Tab bar */}
      <div
        className="flex mb-2"
        style={{ height: 35, background: "var(--bg-tab-inactive)", borderBottom: "1px solid var(--border)" }}
      >
        {SOLVER_FILES.map((f, idx) => (
          <button
            key={f.key}
            onClick={() => handleTabChange(idx)}
            className="px-4 transition-colors"
            style={{
              height: 35,
              display: "flex",
              alignItems: "center",
              fontSize: 13,
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

      {/* Description for active file */}
      <div
        className="px-4 py-2 mb-4"
        style={{ fontSize: 13, color: "var(--fg-muted)", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)" }}
      >
        {currentFile.description}
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

      {/* Navigation */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={goBack}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            padding: "8px 24px",
            borderRadius: 2,
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
