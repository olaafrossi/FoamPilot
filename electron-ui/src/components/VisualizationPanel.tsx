import { useReducer, useState, useEffect, useCallback, useRef } from "react";
import {
  Eye, EyeOff, Layers, Palette, Wind, ChevronDown, ChevronUp,
  Scissors, Crosshair, Camera, Sun, Columns, CircleDot, Box, Info,
} from "lucide-react";
import SceneCompositor, { getDefaultVisiblePatches } from "./SceneCompositor";
import SplitView from "./SplitView";
import ScreenshotButton from "./ScreenshotButton";
import { getFieldData, getSliceData } from "../api";
import { getAvailableColorMaps, generateColorLUT } from "../lib/colormap";
import { generateSeedPoints } from "../lib/streamlines";
import { vizReducer, initialVizState } from "../lib/viz-reducer";
import type { SeedOptions } from "../lib/streamlines";
import type { ColorMapName } from "../lib/colormap";
import type { SliceAxis } from "../lib/viz-reducer";
import type { FieldData } from "../types";
import type { SliceData } from "../api";

interface VisualizationPanelProps {
  caseName: string;
}

const COLORMAPS = getAvailableColorMaps();

const FIELD_UNITS: Record<string, string> = {
  p: "Pa",
  U: "m/s",
  k: "m\u00B2/s\u00B2",
  epsilon: "m\u00B2/s\u00B3",
  omega: "1/s",
  nut: "m\u00B2/s",
};

/** Renders a vertical gradient bar with editable upper/lower bound inputs. */
function ColorLegend({
  dataMin, dataMax, rangeMin, rangeMax, onRangeChange, field, palette,
}: {
  dataMin: number; dataMax: number; rangeMin: number; rangeMax: number;
  onRangeChange: (min: number, max: number) => void; field: string; palette: ColorMapName;
}) {
  const lut = generateColorLUT(palette, 64);
  const reversedLut = [...lut].reverse();
  const stops = reversedLut
    .map((c, i) => {
      const pct = (i / (reversedLut.length - 1)) * 100;
      return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)}) ${pct.toFixed(1)}%`;
    })
    .join(", ");

  const unit = FIELD_UNITS[field] ?? "";
  const isCustomRange = rangeMin !== dataMin || rangeMax !== dataMax;

  const inputStyle: React.CSSProperties = {
    width: 72, fontSize: 11, padding: "1px 4px",
    background: "var(--bg-input)", color: "var(--fg)",
    border: "1px solid var(--border)", borderRadius: 2, textAlign: "right",
  };

  const midVal = (rangeMin + rangeMax) / 2;
  const q1Val = (rangeMin + midVal) / 2;
  const q3Val = (midVal + rangeMax) / 2;

  const formatVal = (v: number) => {
    if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2);
    return v.toPrecision(4);
  };

  return (
    <div className="flex gap-2" style={{ height: 200 }}>
      <div style={{ width: 16, height: "100%", background: `linear-gradient(to bottom, ${stops})`, border: "1px solid var(--border)", borderRadius: 1, flexShrink: 0 }} />
      <div style={{ position: "relative", height: "100%", minWidth: 90, fontSize: 11, color: "var(--fg)" }}>
        <div style={{ position: "absolute", top: -2 }}>
          <div className="flex items-center gap-1">
            <input type="number" value={rangeMax} step="any" style={inputStyle} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onRangeChange(rangeMin, v); }} title="Upper bound" />
            <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{unit}</span>
          </div>
        </div>
        <span style={{ position: "absolute", top: "25%", transform: "translateY(-50%)", color: "var(--fg-muted)", fontSize: 10 }}>{formatVal(q3Val)}</span>
        <div style={{ position: "absolute", top: "50%", transform: "translateY(-50%)" }}>
          <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{formatVal(midVal)}</span>
          <div className="flex items-center gap-1" style={{ marginTop: 2 }}>
            <span style={{ color: "var(--fg-muted)", fontWeight: 600 }}>{field}</span>
            {isCustomRange && (
              <button onClick={() => onRangeChange(dataMin, dataMax)} title="Reset to data range" style={{ fontSize: 10, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>reset</button>
            )}
          </div>
        </div>
        <span style={{ position: "absolute", top: "75%", transform: "translateY(-50%)", color: "var(--fg-muted)", fontSize: 10 }}>{formatVal(q1Val)}</span>
        <div style={{ position: "absolute", bottom: -2 }}>
          <div className="flex items-center gap-1">
            <input type="number" value={rangeMin} step="any" style={inputStyle} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onRangeChange(v, rangeMax); }} title="Lower bound" />
            <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{unit}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle button helper
// ---------------------------------------------------------------------------

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 text-[12px] border ${
        active
          ? "bg-[var(--accent-bg)] border-[var(--accent-bg)] text-white"
          : "bg-transparent border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
      }`}
      style={{ borderRadius: 2 }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function VisualizationPanel({ caseName }: VisualizationPanelProps) {
  const [state, dispatch] = useReducer(vizReducer, initialVizState);
  const [fieldData, setFieldData] = useState<FieldData | null>(null);
  const [splitFieldData, setSplitFieldData] = useState<FieldData | null>(null);
  const [sliceData, setSliceData] = useState<SliceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [seeds, setSeeds] = useState<number[][]>([]);
  const [patchVisibility, setPatchVisibility] = useState<Record<string, boolean>>({});
  const patchVisibilityInitialized = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load field data
  const loadFieldData = useCallback(async (field: string, time: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFieldData(caseName, field, time);
      setFieldData(data);
      dispatch({ type: "SET_RANGE", min: data.min, max: data.max });
      setAvailableFields(data.available_fields ?? []);
      setAvailableTimes(data.available_times ?? []);
      if (!patchVisibilityInitialized.current && data.patches?.length > 0) {
        setPatchVisibility(getDefaultVisiblePatches(data.patches));
        patchVisibilityInitialized.current = true;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load field data");
      setFieldData(null);
    } finally {
      setLoading(false);
    }
  }, [caseName]);

  // Load split-view field data
  useEffect(() => {
    if (!state.splitView) { setSplitFieldData(null); return; }
    getFieldData(caseName, state.splitField, state.selectedTime)
      .then(setSplitFieldData)
      .catch(() => setSplitFieldData(null));
  }, [caseName, state.splitView, state.splitField, state.selectedTime]);

  // Load slice data
  useEffect(() => {
    if (!state.sliceAxis) { setSliceData(null); return; }
    getSliceData(caseName, state.selectedField, state.selectedTime, state.sliceAxis, state.slicePosition)
      .then(setSliceData)
      .catch(() => setSliceData(null));
  }, [caseName, state.selectedField, state.selectedTime, state.sliceAxis, state.slicePosition]);

  // Generate streamline seeds
  useEffect(() => {
    if (!fieldData || fieldData.vertices.length === 0 || fieldData.faces.length === 0) { setSeeds([]); return; }
    let faceSubset: number[] | undefined;
    if (state.seedVisibleOnly && fieldData.patches?.length > 0) {
      const indices: number[] = [];
      for (const patch of fieldData.patches) {
        if (patchVisibility[patch.name]) {
          for (let i = 0; i < patch.nFaces; i++) indices.push(patch.startFace + i);
        }
      }
      if (indices.length > 0) faceSubset = indices;
    }
    const opts: SeedOptions = { count: state.seedCount, mode: state.seedMode, faceSubset, vectors: state.seedMode === 'velocity' ? fieldData.vectors : undefined };
    setSeeds(generateSeedPoints(fieldData.vertices, fieldData.faces, opts));
  }, [fieldData, state.seedCount, state.seedMode, state.seedVisibleOnly, patchVisibility]);

  // Initial load
  useEffect(() => {
    patchVisibilityInitialized.current = false;
    loadFieldData(state.selectedField, state.selectedTime);
  }, [caseName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFieldChange = (field: string) => {
    dispatch({ type: "SET_FIELD", field });
    loadFieldData(field, state.selectedTime);
  };

  const handleTimeChange = (time: string) => {
    dispatch({ type: "SET_TIME", time });
    loadFieldData(state.selectedField, time);
  };

  const togglePatch = (name: string) => {
    setPatchVisibility((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)", marginBottom: 12 }}>
        Flow Visualization
      </h3>

      {/* === VIEW CONTROLS === */}
      <div className="flex flex-wrap items-center gap-4 mb-3 p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        {/* Field selector */}
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-[var(--fg-muted)]" />
          <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>Field</label>
          <select value={state.selectedField} onChange={(e) => handleFieldChange(e.target.value)} className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]" style={{ borderRadius: 2 }}>
            {availableFields.length > 0 ? availableFields.map((f) => <option key={f} value={f}>{f}</option>) : <option value={state.selectedField}>{state.selectedField}</option>}
          </select>
        </div>

        {/* Time selector */}
        {availableTimes.length > 1 && (
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>Time</label>
            <select value={state.selectedTime} onChange={(e) => handleTimeChange(e.target.value)} className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]" style={{ borderRadius: 2 }}>
              <option value="latest">Latest</option>
              {availableTimes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}

        {/* Colormap selector */}
        <div className="flex items-center gap-2">
          <Palette size={14} className="text-[var(--fg-muted)]" />
          <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>Colors</label>
          <select value={state.colormap} onChange={(e) => dispatch({ type: "SET_COLORMAP", colormap: e.target.value as ColorMapName })} className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]" style={{ borderRadius: 2 }}>
            {COLORMAPS.map((cm) => <option key={cm.name} value={cm.name}>{cm.label}</option>)}
          </select>
        </div>

        {/* Opacity slider */}
        <div className="flex items-center gap-2">
          {state.opacity < 1 ? <EyeOff size={14} className="text-[var(--fg-muted)]" /> : <Eye size={14} className="text-[var(--fg-muted)]" />}
          <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>Opacity</label>
          <input type="range" min={0.1} max={1} step={0.05} value={state.opacity} onChange={(e) => dispatch({ type: "SET_OPACITY", opacity: Number(e.target.value) })} style={{ width: 80, accentColor: "var(--accent)" }} />
          <span style={{ fontSize: 11, color: "var(--fg-muted)", minWidth: 28 }}>{Math.round(state.opacity * 100)}%</span>
        </div>

        {/* View toggles */}
        <ToggleButton active={state.showWireframe} onClick={() => dispatch({ type: "TOGGLE_WIREFRAME" })}>Wireframe</ToggleButton>
        <ToggleButton active={state.showOutline} onClick={() => dispatch({ type: "TOGGLE_OUTLINE" })}><Box size={12} />Outline</ToggleButton>

        {/* Lighting preset */}
        <div className="flex items-center gap-2">
          <Sun size={14} className="text-[var(--fg-muted)]" />
          <select value={state.lightingPreset} onChange={(e) => dispatch({ type: "SET_LIGHTING", preset: e.target.value as any })} className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]" style={{ borderRadius: 2 }}>
            <option value="studio">Studio</option>
            <option value="technical">Technical</option>
            <option value="dramatic">Dramatic</option>
          </select>
        </div>

        {/* Patch visibility */}
        {fieldData?.patches && fieldData.patches.length > 0 && (
          <ToggleButton active={state.showPatchPanel} onClick={() => dispatch({ type: "TOGGLE_PATCH_PANEL" })}>
            <Layers size={12} />Patches{state.showPatchPanel ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </ToggleButton>
        )}
      </div>

      {/* === ANALYSIS CONTROLS === */}
      <div className="flex flex-wrap items-center gap-4 mb-3 p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        {/* Streamlines */}
        {fieldData?.vectors && (
          <ToggleButton active={state.showStreamlines} onClick={() => dispatch({ type: "TOGGLE_STREAMLINES" })}>
            <Wind size={12} />Streamlines
          </ToggleButton>
        )}

        {/* Particles */}
        {fieldData?.vectors && (
          <ToggleButton active={state.showParticles} onClick={() => dispatch({ type: "TOGGLE_PARTICLES" })}>
            <CircleDot size={12} />Particles
          </ToggleButton>
        )}

        {/* Slice plane */}
        <div className="flex items-center gap-2">
          <Scissors size={14} className="text-[var(--fg-muted)]" />
          <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>Slice</label>
          <select
            value={state.sliceAxis ?? "off"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "off") dispatch({ type: "SET_SLICE", axis: null, position: 0 });
              else dispatch({ type: "SET_SLICE", axis: v as SliceAxis, position: 0 });
            }}
            className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]" style={{ borderRadius: 2 }}
          >
            <option value="off">Off</option>
            <option value="x">X Plane</option>
            <option value="y">Y Plane</option>
            <option value="z">Z Plane</option>
          </select>
          {state.sliceAxis && (
            <input type="range" min={-5} max={5} step={0.1} value={state.slicePosition}
              onChange={(e) => dispatch({ type: "SET_SLICE_POSITION", position: Number(e.target.value) })}
              style={{ width: 100, accentColor: "var(--accent)" }}
            />
          )}
        </div>

        {/* Probe */}
        <ToggleButton active={state.probeMode} onClick={() => dispatch({ type: "TOGGLE_PROBE" })}>
          <Crosshair size={12} />Probe
        </ToggleButton>

        {/* Tooltips */}
        <ToggleButton active={state.showTooltips} onClick={() => dispatch({ type: "TOGGLE_TOOLTIPS" })}>
          <Info size={12} />Tooltips
        </ToggleButton>

        {/* Split view */}
        <ToggleButton active={state.splitView} onClick={() => dispatch({ type: "TOGGLE_SPLIT_VIEW" })}>
          <Columns size={12} />Split View
        </ToggleButton>
        {state.splitView && availableFields.length > 0 && (
          <select value={state.splitField} onChange={(e) => dispatch({ type: "SET_SPLIT_FIELD", field: e.target.value })} className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]" style={{ borderRadius: 2 }}>
            {availableFields.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}

        {/* Screenshot */}
        <ScreenshotButton canvasRef={canvasRef} />
      </div>

      {/* Streamline controls */}
      {state.showStreamlines && fieldData?.vectors && (
        <div className="flex flex-wrap items-center gap-4 mb-3 p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>Seeds</label>
            <input type="range" min={5} max={100} step={5} value={state.seedCount} onChange={(e) => dispatch({ type: "SET_SEED_COUNT", count: Number(e.target.value) })} style={{ width: 80, accentColor: "var(--accent)" }} />
            <span style={{ fontSize: 11, color: "var(--fg-muted)", minWidth: 24 }}>{state.seedCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>Mode</label>
            <select value={state.seedMode} onChange={(e) => dispatch({ type: "SET_SEED_MODE", mode: e.target.value as any })} className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]" style={{ borderRadius: 2 }}>
              <option value="uniform">Uniform</option>
              <option value="velocity">Velocity-weighted</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={state.seedVisibleOnly} onChange={() => dispatch({ type: "TOGGLE_SEED_VISIBLE_ONLY" })} style={{ accentColor: "var(--accent)" }} />
            <span style={{ color: "var(--fg-muted)" }}>Visible patches only</span>
          </label>
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>Tube Scale</label>
            <input type="range" min={0.1} max={5} step={0.1} value={state.tubeScale} onChange={(e) => dispatch({ type: "SET_TUBE_SCALE", scale: Number(e.target.value) })} style={{ width: 80, accentColor: "var(--accent)" }} />
            <span style={{ fontSize: 11, color: "var(--fg-muted)", minWidth: 28 }}>{state.tubeScale.toFixed(1)}x</span>
          </div>
        </div>
      )}

      {/* Particle controls */}
      {state.showParticles && fieldData?.vectors && (
        <div className="flex flex-wrap items-center gap-4 mb-3 p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>Count</label>
            <input type="range" min={500} max={10000} step={500} value={state.particleCount} onChange={(e) => dispatch({ type: "SET_PARTICLE_COUNT", count: Number(e.target.value) })} style={{ width: 120, accentColor: "var(--accent)" }} />
            <span style={{ fontSize: 11, color: "var(--fg-muted)", minWidth: 40 }}>{state.particleCount}</span>
          </div>
        </div>
      )}

      {/* Patch visibility panel */}
      {state.showPatchPanel && fieldData?.patches && (
        <div className="flex flex-wrap gap-3 mb-3 p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          {fieldData.patches.map((patch) => (
            <label key={patch.name} className="flex items-center gap-1.5 cursor-pointer" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={patchVisibility[patch.name] ?? false} onChange={() => togglePatch(patch.name)} style={{ accentColor: "var(--accent)" }} />
              <span style={{ color: patchVisibility[patch.name] ? "var(--fg)" : "var(--fg-muted)" }}>{patch.name}</span>
              <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>({patch.nFaces})</span>
            </label>
          ))}
        </div>
      )}

      {/* Probe readout */}
      {state.probeMode && state.probeValue !== null && (
        <div className="mb-3 p-2 text-[12px]" style={{ background: "var(--bg-surface)", border: "1px solid var(--accent-bg)", color: "var(--fg)" }}>
          <Crosshair size={12} style={{ display: "inline", marginRight: 4 }} />
          <strong>{state.selectedField}:</strong>{" "}
          {state.probeValue.toExponential(4)} {FIELD_UNITS[state.selectedField] ?? ""}
          {state.probePosition && (
            <span style={{ color: "var(--fg-muted)", marginLeft: 8 }}>
              at ({state.probePosition.map((v) => v.toFixed(3)).join(", ")})
            </span>
          )}
        </div>
      )}

      {/* Visualization area */}
      <div className="flex gap-4">
        <div className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center" style={{ height: 400, background: "var(--bg-editor)", border: "1px solid var(--border)" }}>
              <p style={{ color: "var(--fg-muted)", fontSize: 13 }}>Loading field data...</p>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center" style={{ height: 400, background: "var(--bg-editor)", border: "1px solid var(--border)" }}>
              <p style={{ color: "var(--error)", fontSize: 13 }}>{error}</p>
            </div>
          ) : state.splitView && splitFieldData && fieldData ? (
            <SplitView
              fieldDataA={fieldData}
              fieldDataB={splitFieldData}
              colormapA={state.colormap}
              colormapB={state.colormap}
              lightingPreset={state.lightingPreset}
            />
          ) : (
            <SceneCompositor
              fieldData={fieldData}
              colormap={state.colormap}
              opacity={state.opacity}
              showWireframe={state.showWireframe}
              showStreamlines={state.showStreamlines}
              streamlineSeeds={seeds}
              patchVisibility={patchVisibility}
              rangeMin={state.rangeMin}
              rangeMax={state.rangeMax}
              tubeScale={state.tubeScale}
              streamlineOffsetX={state.streamlineOffsetX}
              streamlineOffsetY={state.streamlineOffsetY}
              showParticles={state.showParticles}
              particleCount={state.particleCount}
              showOutline={state.showOutline}
              lightingPreset={state.lightingPreset}
              sliceAxis={state.sliceAxis}
              slicePosition={state.slicePosition}
              sliceData={sliceData}
              probeMode={state.probeMode}
              onProbeValue={(result) => dispatch({ type: "SET_PROBE_VALUE", value: result.value, position: result.position })}
              canvasRef={canvasRef}
            />
          )}
        </div>

        {/* Color legend */}
        {fieldData && !loading && !error && (
          <div className="flex-shrink-0 pt-2">
            <ColorLegend
              dataMin={fieldData.min}
              dataMax={fieldData.max}
              rangeMin={state.rangeMin}
              rangeMax={state.rangeMax}
              onRangeChange={(min, max) => dispatch({ type: "SET_RANGE", min, max })}
              field={fieldData.field}
              palette={state.colormap}
            />
          </div>
        )}
      </div>
    </div>
  );
}
