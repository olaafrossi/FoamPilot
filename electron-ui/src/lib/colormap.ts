/**
 * Color mapping library for CFD scalar visualization.
 *
 * Converts scalar field values to RGB colors using scientific visualization
 * palettes. All palettes are defined as piecewise-linear control points and
 * interpolated in RGB space.
 *
 * Pure math — zero external dependencies.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Available scientific color map names. */
export type ColorMapName = 'jet' | 'viridis' | 'coolwarm' | 'plasma' | 'inferno';

/** A single control point: position in [0,1] and its RGB color. */
interface ControlPoint {
  t: number;
  r: number;
  g: number;
  b: number;
}

// ---------------------------------------------------------------------------
// Palette definitions (hardcoded control points)
// ---------------------------------------------------------------------------

const JET: ControlPoint[] = [
  { t: 0.00, r: 0.0, g: 0.0, b: 0.5 },
  { t: 0.11, r: 0.0, g: 0.0, b: 1.0 },
  { t: 0.25, r: 0.0, g: 0.5, b: 1.0 },
  { t: 0.36, r: 0.0, g: 1.0, b: 1.0 },
  { t: 0.50, r: 0.0, g: 1.0, b: 0.0 },
  { t: 0.64, r: 1.0, g: 1.0, b: 0.0 },
  { t: 0.75, r: 1.0, g: 0.5, b: 0.0 },
  { t: 0.89, r: 1.0, g: 0.0, b: 0.0 },
  { t: 1.00, r: 0.5, g: 0.0, b: 0.0 },
];

const VIRIDIS: ControlPoint[] = [
  { t: 0.00, r: 0.267, g: 0.004, b: 0.329 },
  { t: 0.25, r: 0.282, g: 0.141, b: 0.458 },
  { t: 0.50, r: 0.127, g: 0.567, b: 0.551 },
  { t: 0.75, r: 0.525, g: 0.812, b: 0.251 },
  { t: 1.00, r: 0.993, g: 0.906, b: 0.144 },
];

const COOLWARM: ControlPoint[] = [
  { t: 0.00, r: 0.230, g: 0.299, b: 0.754 },
  { t: 0.25, r: 0.552, g: 0.628, b: 0.900 },
  { t: 0.50, r: 0.865, g: 0.865, b: 0.865 },
  { t: 0.75, r: 0.906, g: 0.533, b: 0.420 },
  { t: 1.00, r: 0.706, g: 0.016, b: 0.150 },
];

const PLASMA: ControlPoint[] = [
  { t: 0.00, r: 0.050, g: 0.030, b: 0.528 },
  { t: 0.25, r: 0.494, g: 0.012, b: 0.658 },
  { t: 0.50, r: 0.798, g: 0.280, b: 0.470 },
  { t: 0.75, r: 0.973, g: 0.585, b: 0.253 },
  { t: 1.00, r: 0.940, g: 0.975, b: 0.131 },
];

const INFERNO: ControlPoint[] = [
  { t: 0.00, r: 0.001, g: 0.000, b: 0.014 },
  { t: 0.25, r: 0.341, g: 0.063, b: 0.429 },
  { t: 0.50, r: 0.735, g: 0.216, b: 0.330 },
  { t: 0.75, r: 0.978, g: 0.557, b: 0.035 },
  { t: 1.00, r: 0.988, g: 0.998, b: 0.645 },
];

const PALETTES: Record<ColorMapName, ControlPoint[]> = {
  jet: JET,
  viridis: VIRIDIS,
  coolwarm: COOLWARM,
  plasma: PLASMA,
  inferno: INFERNO,
};

const LABELS: Record<ColorMapName, string> = {
  jet: 'Jet (Classic Rainbow)',
  viridis: 'Viridis (Perceptually Uniform)',
  coolwarm: 'Cool-Warm (Diverging)',
  plasma: 'Plasma',
  inferno: 'Inferno',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const GRAY: [number, number, number] = [0.5, 0.5, 0.5];

/**
 * Linearly interpolate a color from the given control points at parameter `t`
 * in [0, 1]. Assumes control points are sorted by ascending `t`.
 */
function samplePalette(points: ControlPoint[], t: number): [number, number, number] {
  // Clamp
  if (t <= points[0].t) return [points[0].r, points[0].g, points[0].b];
  const last = points[points.length - 1];
  if (t >= last.t) return [last.r, last.g, last.b];

  // Find surrounding control points
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return [
        a.r + f * (b.r - a.r),
        a.g + f * (b.g - a.g),
        a.b + f * (b.b - a.b),
      ];
    }
  }

  // Fallback (should not happen with well-formed data)
  return [last.r, last.g, last.b];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a scalar value within `[min, max]` to an RGB color using the specified
 * palette. Each channel is in [0, 1].
 *
 * Edge cases:
 * - `NaN` or `Infinity` values return gray `(0.5, 0.5, 0.5)`.
 * - `min === max` returns the middle color of the palette.
 * - Values outside `[min, max]` are clamped.
 */
export function mapScalarToColor(
  value: number,
  min: number,
  max: number,
  palette: ColorMapName,
): [number, number, number] {
  if (!Number.isFinite(value)) return GRAY;

  const points = PALETTES[palette];

  if (min === max) {
    return samplePalette(points, 0.5);
  }

  // Normalize and clamp to [0, 1]
  let t = (value - min) / (max - min);
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  return samplePalette(points, t);
}

/**
 * Generate a full color lookup table for a palette.
 *
 * @param palette - Palette name.
 * @param steps   - Number of entries (default 256).
 * @returns Array of `[r, g, b]` tuples, each channel in [0, 1].
 */
export function generateColorLUT(
  palette: ColorMapName,
  steps: number = 256,
): [number, number, number][] {
  const points = PALETTES[palette];
  const lut: [number, number, number][] = new Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0.5 : i / (steps - 1);
    lut[i] = samplePalette(points, t);
  }
  return lut;
}

/**
 * Get a human-readable label for a palette.
 */
export function getColorMapLabel(palette: ColorMapName): string {
  return LABELS[palette];
}

/**
 * List all available color maps with their names and labels.
 */
export function getAvailableColorMaps(): { name: ColorMapName; label: string }[] {
  return (Object.keys(PALETTES) as ColorMapName[]).map((name) => ({
    name,
    label: LABELS[name],
  }));
}
