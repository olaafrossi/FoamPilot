/**
 * Plain-English tooltip overlay for CFD field values.
 *
 * Positioned absolutely over the 3D canvas. Shows the field name, formatted
 * value, units, and a human-readable description of what the field means.
 *
 * This is a regular React component (NOT an R3F component).
 */

// ---------------------------------------------------------------------------
// Field description map
// ---------------------------------------------------------------------------

const FIELD_DESCRIPTIONS: Record<string, { label: string; units: string; description: string }> = {
  p: {
    label: "Pressure",
    units: "Pa",
    description: "Static pressure field (kinematic, p/rho for incompressible solvers)",
  },
  U: {
    label: "Velocity",
    units: "m/s",
    description: "Flow velocity vector magnitude",
  },
  k: {
    label: "Turbulent Kinetic Energy",
    units: "m\u00B2/s\u00B2",
    description: "Mean kinetic energy per unit mass in turbulent fluctuations",
  },
  epsilon: {
    label: "Turbulent Dissipation",
    units: "m\u00B2/s\u00B3",
    description: "Rate of dissipation of turbulent kinetic energy",
  },
  omega: {
    label: "Specific Dissipation Rate",
    units: "1/s",
    description: "Rate of dissipation per unit turbulent kinetic energy (k-omega models)",
  },
  nut: {
    label: "Turbulent Viscosity",
    units: "m\u00B2/s",
    description: "Eddy viscosity from the turbulence model",
  },
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatValue(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1e6 || abs < 1e-3) return value.toExponential(3);
  // Add thousands separator for large numbers
  return value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

function getAnnotation(fieldName: string, value: number): string | null {
  if (fieldName === "p") {
    const abs = Math.abs(value);
    if (abs > 100_000 && abs < 103_000) return "(atmospheric)";
    if (value < 0) return "(suction)";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Props & Component
// ---------------------------------------------------------------------------

interface TooltipOverlayProps {
  /** CFD field name (e.g. "p", "U", "k"). */
  fieldName: string;
  /** Scalar value at the probe/hover point. */
  value: number;
  /** Optional override units; defaults from FIELD_DESCRIPTIONS. */
  units?: string;
  /** Screen-space position relative to the canvas container. */
  position: { x: number; y: number };
  /** Whether the tooltip is visible. */
  visible?: boolean;
}

export default function TooltipOverlay({
  fieldName,
  value,
  units: unitsProp,
  position,
  visible = true,
}: TooltipOverlayProps) {
  if (!visible) return null;

  const info = FIELD_DESCRIPTIONS[fieldName];
  const label = info?.label ?? fieldName;
  const units = unitsProp ?? info?.units ?? "";
  const description = info?.description ?? null;
  const annotation = getAnnotation(fieldName, value);

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        transform: "translate(-50%, -100%) translateY(-12px)",
        pointerEvents: "none",
        zIndex: 20,
        maxWidth: 280,
      }}
    >
      <div
        style={{
          background: "rgba(10, 10, 20, 0.92)",
          color: "#eee",
          padding: "6px 10px",
          borderRadius: 4,
          fontSize: 12,
          lineHeight: 1.4,
          fontFamily: "'Inter', system-ui, sans-serif",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ fontWeight: 600 }}>
          {label}: {formatValue(value)} {units}
          {annotation && (
            <span style={{ color: "#aaa", marginLeft: 4 }}>{annotation}</span>
          )}
        </div>
        {description && (
          <div style={{ color: "#999", fontSize: 11, marginTop: 2 }}>
            {description}
          </div>
        )}
      </div>
    </div>
  );
}
