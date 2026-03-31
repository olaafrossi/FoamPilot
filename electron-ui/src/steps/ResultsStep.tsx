import { useState, useEffect } from "react";
import { getResults, getMeshQuality, getConfig } from "../api";
import VisualizationPanel from "../components/VisualizationPanel";
import { useStatus } from "../hooks/useStatus";
import type { AeroResults, MeshQuality } from "../types";

interface StepProps {
  caseName: string | null;
  setCaseName: (name: string) => void;
  templateName: string | null;
  setTemplateName: (name: string) => void;
  goNext: () => void;
  goBack: () => void;
  completeStep: (step: number) => void;
  resetWizard: () => void;
  velocity: number;
  setVelocity: (v: number) => void;
  geometryClass: string | null;
  setGeometryClass: (c: string | null) => void;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return seconds.toFixed(1) + "s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return m + "m " + s.toFixed(0) + "s";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
}) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        padding: 16,
        borderRadius: 0,
      }}
    >
      <p
        style={{
          color: "var(--fg-muted)",
          marginBottom: 4,
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </p>
      <p style={{ color: "var(--fg)", fontSize: 20, fontWeight: 600 }}>
        {value !== null && value !== undefined ? value : "\u2014"}
        {unit && (
          <span
            style={{
              color: "var(--fg-muted)",
              fontWeight: 400,
              marginLeft: 4,
              fontSize: 13,
            }}
          >
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

export default function ResultsStep({
  caseName,
  goBack,
  completeStep,
  resetWizard,
}: StepProps) {
  const [results, setResults] = useState<AeroResults | null>(null);
  const [meshQuality, setMeshQuality] = useState<MeshQuality | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setError: setStatusError } = useStatus();

  useEffect(() => {
    if (!caseName) return;
    setLoading(true);
    Promise.allSettled([
      getResults(caseName),
      getMeshQuality(caseName),
    ]).then(([resResult, meshResult]) => {
      if (resResult.status === "fulfilled") setResults(resResult.value);
      if (meshResult.status === "fulfilled")
        setMeshQuality(meshResult.value);
      if (resResult.status === "rejected") {
        setError("Failed to load results");
      }
      setLoading(false);
    });
  }, [caseName]);

  const isElectron = typeof window.foamPilot?.openParaView === "function";

  const handleOpenParaView = async () => {
    if (!caseName) return;
    const config = getConfig();
    if (!config.localCasesPath) {
      setStatusError("localCasesPath not configured — check Settings");
      return;
    }
    const casePath = config.localCasesPath + "/" + caseName;
    if (!isElectron) {
      await navigator.clipboard.writeText(casePath);
      setStatusError(`Path copied: ${casePath} — run "npm run dev:electron" for native open`);
      return;
    }
    try {
      const result = await window.foamPilot.openParaView(casePath);
      if (!result.ok) {
        setStatusError(result.error ?? "Failed to open ParaView");
      }
    } catch (e: unknown) {
      setStatusError(e instanceof Error ? e.message : "Failed to open ParaView");
    }
  };

  const handleOpenFolder = async () => {
    if (!caseName) return;
    const config = getConfig();
    if (!config.localCasesPath) {
      setStatusError("localCasesPath not configured — check Settings");
      return;
    }
    const casePath = config.localCasesPath + "/" + caseName;
    if (!isElectron) {
      await navigator.clipboard.writeText(casePath);
      setStatusError(`Path copied: ${casePath} — run "npm run dev:electron" for native open`);
      return;
    }
    try {
      const result = await window.foamPilot.openFolder(casePath);
      if (result && !result.ok) {
        setStatusError(result.error ?? "Failed to open folder");
      }
    } catch (e: unknown) {
      setStatusError(e instanceof Error ? e.message : "Failed to open folder");
    }
  };

  const handleRunAgain = () => {
    // Go back to Physics step (step 2)
    goBack(); // 5 -> 4
    goBack(); // 4 -> 3
    goBack(); // 3 -> 2
  };

  if (loading) {
    return (
      <div>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 24,
            marginBottom: 4,
            color: "var(--fg)",
          }}
        >
          Results
        </h2>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, marginBottom: 24 }}>
          Loading results...
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 24,
          marginBottom: 4,
          color: "var(--fg)",
        }}
      >
        Results
      </h2>
      <p style={{ color: "var(--fg-muted)", fontSize: 13, marginBottom: 24 }}>
        Aerodynamic coefficients and simulation summary for{" "}
        <span style={{ color: "var(--fg)", fontWeight: 600 }}>{caseName}</span>.
      </p>

      {error && (
        <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Aero coefficients */}
      {results && (
        <>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--fg)",
              marginBottom: 12,
            }}
          >
            Aerodynamic Coefficients
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <StatCard
              label="Drag Coefficient (Cd)"
              value={results.cd?.toFixed(4) ?? null}
            />
            <StatCard
              label="Lift Coefficient (Cl)"
              value={results.cl?.toFixed(4) ?? null}
            />
            <StatCard
              label="Moment Coefficient (Cm)"
              value={results.cm?.toFixed(4) ?? null}
            />
          </div>

          {(results.cd_pressure !== null ||
            results.cd_viscous !== null) && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 16,
                marginBottom: 24,
                maxWidth: 448,
              }}
            >
              <StatCard
                label="Cd (Pressure)"
                value={results.cd_pressure?.toFixed(4) ?? null}
              />
              <StatCard
                label="Cd (Viscous)"
                value={results.cd_viscous?.toFixed(4) ?? null}
              />
            </div>
          )}
        </>
      )}

      {/* 3D Flow Visualization */}
      {caseName && (
        <div style={{ marginBottom: 24 }}>
          <VisualizationPanel caseName={caseName} />
        </div>
      )}

      {/* Simulation summary */}
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--fg)",
          marginBottom: 12,
        }}
      >
        Simulation Summary
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {meshQuality && (
          <StatCard
            label="Cells"
            value={meshQuality.cells.toLocaleString()}
          />
        )}
        {results && (
          <>
            <StatCard label="Iterations" value={results.iterations} />
            <StatCard
              label="Wall Time"
              value={formatTime(results.wall_time_seconds)}
            />
            <StatCard
              label="Convergence"
              value={
                results.converged ? "Converged" : "Not converged"
              }
            />
          </>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <button
          onClick={handleOpenParaView}
          style={{
            background: "var(--accent)",
            color: "#09090B",
            paddingLeft: 24,
            paddingRight: 24,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: 2,
            fontWeight: 600,
            fontSize: 13,
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--accent-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "var(--accent)")
          }
        >
          Open in ParaView
        </button>
        <button
          onClick={handleOpenFolder}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            paddingLeft: 24,
            paddingRight: 24,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: 2,
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          Open Case Folder
        </button>
        <button
          onClick={handleRunAgain}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            paddingLeft: 24,
            paddingRight: 24,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: 2,
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          Run Again
        </button>
        <button
          onClick={resetWizard}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            paddingLeft: 24,
            paddingRight: 24,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: 2,
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          New Simulation
        </button>
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
        <button
          onClick={goBack}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            paddingLeft: 24,
            paddingRight: 24,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: 2,
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          &larr; Back
        </button>
      </div>
    </div>
  );
}
