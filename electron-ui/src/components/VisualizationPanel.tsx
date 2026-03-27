import { useState, useEffect, useCallback, useRef } from "react";
import { Eye, EyeOff, Layers, Palette, Wind, ChevronDown, ChevronUp } from "lucide-react";
import FieldMeshRenderer, { getDefaultVisiblePatches } from "./FieldMeshRenderer";
import { getFieldData } from "../api";
import { getAvailableColorMaps, generateColorLUT } from "../lib/colormap";
import { generateSeedPoints } from "../lib/streamlines";
import type { SeedOptions } from "../lib/streamlines";
import type { ColorMapName } from "../lib/colormap";
import type { FieldData } from "../types";

interface VisualizationPanelProps {
  caseName: string;
}

const COLORMAPS = getAvailableColorMaps();

/** Renders a vertical gradient bar with editable upper/lower bound inputs. */
function ColorLegend({
  dataMin,
  dataMax,
  rangeMin,
  rangeMax,
  onRangeChange,
  field,
  palette,
}: {
  dataMin: number;
  dataMax: number;
  rangeMin: number;
  rangeMax: number;
  onRangeChange: (min: number, max: number) => void;
  field: string;
  palette: ColorMapName;
}) {
  const lut = generateColorLUT(palette, 64);

  // Build a CSS linear-gradient from top (max/red) to bottom (min/blue).
  // Reverse the LUT so stops go in ascending CSS percentage order (0% → 100%).
  const reversedLut = [...lut].reverse();
  const stops = reversedLut
    .map((c, i) => {
      const pct = (i / (reversedLut.length - 1)) * 100;
      return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)}) ${pct.toFixed(1)}%`;
    })
    .join(", ");

  const fieldUnits: Record<string, string> = {
    p: "Pa",
    U: "m/s",
    k: "m\u00B2/s\u00B2",
    epsilon: "m\u00B2/s\u00B3",
    omega: "1/s",
    nut: "m\u00B2/s",
  };

  const unit = fieldUnits[field] ?? "";

  const isCustomRange = rangeMin !== dataMin || rangeMax !== dataMax;

  const inputStyle: React.CSSProperties = {
    width: 72,
    fontSize: 11,
    padding: "1px 4px",
    background: "var(--bg-input)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: 2,
    textAlign: "right" as const,
  };

  // Compute intermediate tick values (25%, 50%, 75%)
  const midVal = (rangeMin + rangeMax) / 2;
  const q1Val = (rangeMin + midVal) / 2;
  const q3Val = (midVal + rangeMax) / 2;

  const formatVal = (v: number) => {
    if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) {
      return v.toExponential(2);
    }
    return v.toPrecision(4);
  };

  return (
    <div className="flex gap-2" style={{ height: 200 }}>
      {/* Gradient bar */}
      <div
        style={{
          width: 16,
          height: "100%",
          background: `linear-gradient(to bottom, ${stops})`,
          border: "1px solid var(--border)",
          borderRadius: 1,
          flexShrink: 0,
        }}
      />

      {/* Labels column: inputs at top/bottom, ticks in between */}
      <div
        style={{
          position: "relative",
          height: "100%",
          minWidth: 90,
          fontSize: 11,
          color: "var(--fg)",
        }}
      >
        {/* Upper bound input — top */}
        <div style={{ position: "absolute", top: -2 }}>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={rangeMax}
              step="any"
              style={inputStyle}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onRangeChange(rangeMin, v);
              }}
              title="Upper bound"
            />
            <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{unit}</span>
          </div>
        </div>

        {/* 75% tick */}
        <span
          style={{ position: "absolute", top: "25%", transform: "translateY(-50%)", color: "var(--fg-muted)", fontSize: 10 }}
        >
          {formatVal(q3Val)}
        </span>

        {/* 50% tick + field label */}
        <div
          style={{ position: "absolute", top: "50%", transform: "translateY(-50%)" }}
        >
          <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>
            {formatVal(midVal)}
          </span>
          <div className="flex items-center gap-1" style={{ marginTop: 2 }}>
            <span style={{ color: "var(--fg-muted)", fontWeight: 600 }}>{field}</span>
            {isCustomRange && (
              <button
                onClick={() => onRangeChange(dataMin, dataMax)}
                title="Reset to data range"
                style={{
                  fontSize: 10,
                  color: "var(--accent)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                reset
              </button>
            )}
          </div>
        </div>

        {/* 25% tick */}
        <span
          style={{ position: "absolute", top: "75%", transform: "translateY(-50%)", color: "var(--fg-muted)", fontSize: 10 }}
        >
          {formatVal(q1Val)}
        </span>

        {/* Lower bound input — bottom */}
        <div style={{ position: "absolute", bottom: -2 }}>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={rangeMin}
              step="any"
              style={inputStyle}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onRangeChange(v, rangeMax);
              }}
              title="Lower bound"
            />
            <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{unit}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VisualizationPanel({ caseName }: VisualizationPanelProps) {
  const [fieldData, setFieldData] = useState<FieldData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Controls
  const [selectedField, setSelectedField] = useState("p");
  const [selectedTime, setSelectedTime] = useState("latest");
  const [colormap, setColormap] = useState<ColorMapName>("jet");
  const [opacity, setOpacity] = useState(1);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showStreamlines, setShowStreamlines] = useState(false);
  const [seedCount, setSeedCount] = useState(20);
  const [seedMode, setSeedMode] = useState<'uniform' | 'velocity'>('uniform');
  const [seedVisibleOnly, setSeedVisibleOnly] = useState(true);
  const [showPatchPanel, setShowPatchPanel] = useState(false);

  // Available options from the backend response
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);

  // Color range bounds (user-adjustable)
  const [rangeMin, setRangeMin] = useState<number>(0);
  const [rangeMax, setRangeMax] = useState<number>(1);

  // Seed points for streamlines (generated from mesh)
  const [seeds, setSeeds] = useState<number[][]>([]);

  // Patch visibility — persisted across field/time changes
  const [patchVisibility, setPatchVisibility] = useState<Record<string, boolean>>({});
  const patchVisibilityInitialized = useRef(false);

  const loadFieldData = useCallback(async (field: string, time: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFieldData(caseName, field, time);
      setFieldData(data);
      setRangeMin(data.min);
      setRangeMax(data.max);
      setAvailableFields(data.available_fields ?? []);
      setAvailableTimes(data.available_times ?? []);

      // Initialize patch visibility only on first load (persist across field/time changes)
      if (!patchVisibilityInitialized.current && data.patches?.length > 0) {
        setPatchVisibility(getDefaultVisiblePatches(data.patches));
        patchVisibilityInitialized.current = true;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load field data";
      setError(msg);
      setFieldData(null);
    } finally {
      setLoading(false);
    }
  }, [caseName]);

  // Generate streamline seeds when field data or seed controls change
  useEffect(() => {
    if (!fieldData || fieldData.vertices.length === 0 || fieldData.faces.length === 0) {
      setSeeds([]);
      return;
    }

    // Compute face subset from visible patches
    let faceSubset: number[] | undefined;
    if (seedVisibleOnly && fieldData.patches?.length > 0) {
      const indices: number[] = [];
      for (const patch of fieldData.patches) {
        if (patchVisibility[patch.name]) {
          for (let i = 0; i < patch.nFaces; i++) {
            indices.push(patch.startFace + i);
          }
        }
      }
      // Only filter if we got some faces; otherwise fall back to all
      if (indices.length > 0) {
        faceSubset = indices;
      }
    }

    const opts: SeedOptions = {
      count: seedCount,
      mode: seedMode,
      faceSubset,
      vectors: seedMode === 'velocity' ? fieldData.vectors : undefined,
    };
    const seedPts = generateSeedPoints(fieldData.vertices, fieldData.faces, opts);
    setSeeds(seedPts);
  }, [fieldData, seedCount, seedMode, seedVisibleOnly, patchVisibility]);

  // Load initial field data
  useEffect(() => {
    patchVisibilityInitialized.current = false;
    loadFieldData(selectedField, selectedTime);
  }, [caseName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFieldChange = (field: string) => {
    setSelectedField(field);
    loadFieldData(field, selectedTime);
  };

  const handleTimeChange = (time: string) => {
    setSelectedTime(time);
    loadFieldData(selectedField, time);
  };

  const togglePatch = (name: string) => {
    setPatchVisibility((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div>
      <h3
        style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)", marginBottom: 12 }}
      >
        Flow Visualization
      </h3>

      {/* Controls bar */}
      <div
        className="flex flex-wrap items-center gap-4 mb-3 p-3"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        {/* Field selector */}
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-[var(--fg-muted)]" />
          <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>
            Field
          </label>
          <select
            value={selectedField}
            onChange={(e) => handleFieldChange(e.target.value)}
            className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]"
            style={{ borderRadius: 2 }}
          >
            {availableFields.length > 0
              ? availableFields.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))
              : <option value={selectedField}>{selectedField}</option>
            }
          </select>
        </div>

        {/* Time selector */}
        {availableTimes.length > 1 && (
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>
              Time
            </label>
            <select
              value={selectedTime}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]"
              style={{ borderRadius: 2 }}
            >
              <option value="latest">Latest</option>
              {availableTimes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}

        {/* Colormap selector */}
        <div className="flex items-center gap-2">
          <Palette size={14} className="text-[var(--fg-muted)]" />
          <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>
            Colors
          </label>
          <select
            value={colormap}
            onChange={(e) => setColormap(e.target.value as ColorMapName)}
            className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]"
            style={{ borderRadius: 2 }}
          >
            {COLORMAPS.map((cm) => (
              <option key={cm.name} value={cm.name}>{cm.label}</option>
            ))}
          </select>
        </div>

        {/* Opacity slider */}
        <div className="flex items-center gap-2">
          {opacity < 1 ? (
            <EyeOff size={14} className="text-[var(--fg-muted)]" />
          ) : (
            <Eye size={14} className="text-[var(--fg-muted)]" />
          )}
          <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>
            Opacity
          </label>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            style={{ width: 80, accentColor: "var(--accent)" }}
          />
          <span style={{ fontSize: 11, color: "var(--fg-muted)", minWidth: 28 }}>
            {Math.round(opacity * 100)}%
          </span>
        </div>

        {/* Wireframe toggle */}
        <button
          onClick={() => setShowWireframe(!showWireframe)}
          className={`flex items-center gap-1 px-2 py-1 text-[12px] border ${
            showWireframe
              ? "bg-[var(--accent-bg)] border-[var(--accent-bg)] text-white"
              : "bg-transparent border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
          }`}
          style={{ borderRadius: 2 }}
        >
          Wireframe
        </button>

        {/* Streamlines toggle */}
        {fieldData?.vectors && (
          <button
            onClick={() => setShowStreamlines(!showStreamlines)}
            className={`flex items-center gap-1 px-2 py-1 text-[12px] border ${
              showStreamlines
                ? "bg-[var(--accent-bg)] border-[var(--accent-bg)] text-white"
                : "bg-transparent border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
            style={{ borderRadius: 2 }}
          >
            <Wind size={12} />
            Streamlines
          </button>
        )}

        {/* Patch visibility toggle */}
        {fieldData?.patches && fieldData.patches.length > 0 && (
          <button
            onClick={() => setShowPatchPanel(!showPatchPanel)}
            className={`flex items-center gap-1 px-2 py-1 text-[12px] border ${
              showPatchPanel
                ? "bg-[var(--accent-bg)] border-[var(--accent-bg)] text-white"
                : "bg-transparent border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
            style={{ borderRadius: 2 }}
          >
            <Layers size={12} />
            Patches
            {showPatchPanel ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
      </div>

      {/* Streamline controls — visible when streamlines are on */}
      {showStreamlines && fieldData?.vectors && (
        <div
          className="flex flex-wrap items-center gap-4 mb-3 p-3"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          {/* Seed count */}
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>
              Seeds
            </label>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={seedCount}
              onChange={(e) => setSeedCount(Number(e.target.value))}
              style={{ width: 80, accentColor: "var(--accent)" }}
            />
            <span style={{ fontSize: 11, color: "var(--fg-muted)", minWidth: 24 }}>
              {seedCount}
            </span>
          </div>

          {/* Seeding mode */}
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, textTransform: "uppercase" }}>
              Mode
            </label>
            <select
              value={seedMode}
              onChange={(e) => setSeedMode(e.target.value as 'uniform' | 'velocity')}
              className="bg-[var(--bg-input)] text-[var(--fg)] border border-[var(--border)] px-2 py-1 text-[13px]"
              style={{ borderRadius: 2 }}
            >
              <option value="uniform">Uniform</option>
              <option value="velocity">Velocity-weighted</option>
            </select>
          </div>

          {/* Visible patches only */}
          <label className="flex items-center gap-1.5 cursor-pointer" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={seedVisibleOnly}
              onChange={(e) => setSeedVisibleOnly(e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
            />
            <span style={{ color: "var(--fg-muted)" }}>
              Visible patches only
            </span>
          </label>
        </div>
      )}

      {/* Patch visibility panel */}
      {showPatchPanel && fieldData?.patches && (
        <div
          className="flex flex-wrap gap-3 mb-3 p-3"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          {fieldData.patches.map((patch) => (
            <label
              key={patch.name}
              className="flex items-center gap-1.5 cursor-pointer"
              style={{ fontSize: 12 }}
            >
              <input
                type="checkbox"
                checked={patchVisibility[patch.name] ?? false}
                onChange={() => togglePatch(patch.name)}
                style={{ accentColor: "var(--accent)" }}
              />
              <span style={{ color: patchVisibility[patch.name] ? "var(--fg)" : "var(--fg-muted)" }}>
                {patch.name}
              </span>
              <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>
                ({patch.nFaces})
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Visualization area */}
      <div className="flex gap-4">
        {/* 3D renderer */}
        <div className="flex-1">
          {loading ? (
            <div
              className="flex items-center justify-center"
              style={{ height: 400, background: "var(--bg-editor)", border: "1px solid var(--border)" }}
            >
              <p style={{ color: "var(--fg-muted)", fontSize: 13 }}>Loading field data...</p>
            </div>
          ) : error ? (
            <div
              className="flex items-center justify-center"
              style={{ height: 400, background: "var(--bg-editor)", border: "1px solid var(--border)" }}
            >
              <p style={{ color: "var(--error)", fontSize: 13 }}>{error}</p>
            </div>
          ) : (
            <FieldMeshRenderer
              fieldData={fieldData}
              colormap={colormap}
              opacity={opacity}
              showWireframe={showWireframe}
              showStreamlines={showStreamlines}
              streamlineSeeds={seeds}
              patchVisibility={patchVisibility}
              rangeMin={rangeMin}
              rangeMax={rangeMax}
            />
          )}
        </div>

        {/* Color legend */}
        {fieldData && !loading && !error && (
          <div className="flex-shrink-0 pt-2">
            <ColorLegend
              dataMin={fieldData.min}
              dataMax={fieldData.max}
              rangeMin={rangeMin}
              rangeMax={rangeMax}
              onRangeChange={(min, max) => { setRangeMin(min); setRangeMax(max); }}
              field={fieldData.field}
              palette={colormap}
            />
          </div>
        )}
      </div>
    </div>
  );
}
