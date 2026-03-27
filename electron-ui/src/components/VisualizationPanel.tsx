import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, Layers, Palette, Wind } from "lucide-react";
import FieldMeshRenderer from "./FieldMeshRenderer";
import { getFieldData } from "../api";
import { getAvailableColorMaps, generateColorLUT } from "../lib/colormap";
import { generateSeedPoints } from "../lib/streamlines";
import type { ColorMapName } from "../lib/colormap";
import type { FieldData } from "../types";

interface VisualizationPanelProps {
  caseName: string;
}

const COLORMAPS = getAvailableColorMaps();

/** Renders a vertical gradient bar from the given color LUT. */
function ColorLegend({
  min,
  max,
  field,
  palette,
}: {
  min: number;
  max: number;
  field: string;
  palette: ColorMapName;
}) {
  const lut = generateColorLUT(palette, 64);

  // Build a CSS linear-gradient from top (max) to bottom (min)
  const stops = lut
    .map((c, i) => {
      const pct = (1 - i / (lut.length - 1)) * 100;
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

  return (
    <div className="flex gap-2" style={{ height: 200 }}>
      <div
        style={{
          width: 16,
          height: "100%",
          background: `linear-gradient(to bottom, ${stops})`,
          border: "1px solid var(--border)",
          borderRadius: 1,
        }}
      />
      <div className="flex flex-col justify-between" style={{ fontSize: 11, color: "var(--fg)" }}>
        <span>{max.toPrecision(4)} {unit}</span>
        <span style={{ color: "var(--fg-muted)" }}>{field}</span>
        <span>{min.toPrecision(4)} {unit}</span>
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

  // Available options from the backend response
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);

  // Seed points for streamlines (generated from mesh)
  const [seeds, setSeeds] = useState<number[][]>([]);

  const loadFieldData = useCallback(async (field: string, time: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFieldData(caseName, field, time);
      setFieldData(data);
      setAvailableFields(data.available_fields ?? []);
      setAvailableTimes(data.available_times ?? []);

      // Generate streamline seeds from the mesh
      if (data.vertices.length > 0 && data.faces.length > 0) {
        const seedPts = generateSeedPoints(data.vertices, data.faces, 20);
        setSeeds(seedPts);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load field data";
      setError(msg);
      setFieldData(null);
    } finally {
      setLoading(false);
    }
  }, [caseName]);

  // Load initial field data
  useEffect(() => {
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
      </div>

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
            />
          )}
        </div>

        {/* Color legend */}
        {fieldData && !loading && !error && (
          <div className="flex-shrink-0 pt-2">
            <ColorLegend
              min={fieldData.min}
              max={fieldData.max}
              field={fieldData.field}
              palette={colormap}
            />
          </div>
        )}
      </div>
    </div>
  );
}
