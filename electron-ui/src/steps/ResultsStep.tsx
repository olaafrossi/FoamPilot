import { useState, useEffect } from "react";
import { getResults, getMeshQuality, getConfig } from "../api";
import VisualizationPanel from "../components/VisualizationPanel";
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
    <div className="bg-[#252526] border border-[#474747] p-4" style={{ borderRadius: 0 }}>
      <p
        className="text-[#858585] mb-1"
        style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}
      >
        {label}
      </p>
      <p className="text-white" style={{ fontSize: 20, fontWeight: 600 }}>
        {value !== null && value !== undefined ? value : "\u2014"}
        {unit && (
          <span className="text-[#858585] font-normal ml-1" style={{ fontSize: 13 }}>
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

  const handleOpenParaView = async () => {
    if (!caseName) return;
    const config = getConfig();
    const casePath = config.localCasesPath + "/" + caseName;
    try {
      const result = await window.foamPilot.openParaView(casePath);
      if (!result.ok) {
        setError(result.error ?? "Failed to open ParaView");
      }
    } catch {
      setError("ParaView not available");
    }
  };

  const handleOpenFolder = async () => {
    if (!caseName) return;
    const config = getConfig();
    const casePath = config.localCasesPath + "/" + caseName;
    try {
      await window.foamPilot.openFolder(casePath);
    } catch {
      setError("Failed to open folder");
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
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: "#ffffff" }}>Results</h2>
        <p className="text-[#858585] text-[13px] mb-6">
          Loading results...
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: "#ffffff" }}>Results</h2>
      <p className="text-[#858585] text-[13px] mb-6">
        Aerodynamic coefficients and simulation summary for{" "}
        <span className="text-white font-semibold">{caseName}</span>.
      </p>

      {error && (
        <div className="text-[#f48771] text-[13px] mb-4">{error}</div>
      )}

      {/* Aero coefficients */}
      {results && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#ffffff", marginBottom: 12 }}>
            Aerodynamic Coefficients
          </h3>
          <div className="grid grid-cols-3 gap-4 mb-6">
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
            <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
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
        <div className="mb-6">
          <VisualizationPanel caseName={caseName} />
        </div>
      )}

      {/* Simulation summary */}
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#ffffff", marginBottom: 12 }}>Simulation Summary</h3>
      <div className="grid grid-cols-4 gap-4 mb-6">
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
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={handleOpenParaView}
          className="bg-[#0e639c] hover:bg-[#1177bb] text-white px-6 py-2 rounded-sm font-semibold text-[13px]"
        >
          Open in ParaView
        </button>
        <button
          onClick={handleOpenFolder}
          className="bg-transparent border border-[#474747] text-[#cccccc] hover:bg-[#2a2d2e] px-6 py-2 rounded-sm"
        >
          Open Case Folder
        </button>
        <button
          onClick={handleRunAgain}
          className="bg-transparent border border-[#474747] text-[#cccccc] hover:bg-[#2a2d2e] px-6 py-2 rounded-sm"
        >
          Run Again
        </button>
        <button
          onClick={resetWizard}
          className="bg-transparent border border-[#474747] text-[#cccccc] hover:bg-[#2a2d2e] px-6 py-2 rounded-sm"
        >
          New Simulation
        </button>
      </div>

      {/* Navigation */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={goBack}
          className="bg-transparent border border-[#474747] text-[#cccccc] hover:bg-[#2a2d2e] px-6 py-2 rounded-sm"
        >
          &larr; Back
        </button>
      </div>
    </div>
  );
}
