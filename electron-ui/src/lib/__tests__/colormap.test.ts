import { describe, it, expect } from 'vitest';
import {
  mapScalarToColor,
  generateColorLUT,
  getColorMapLabel,
  getAvailableColorMaps,
  type ColorMapName,
} from '../colormap';

const ALL_PALETTES: ColorMapName[] = ['jet', 'viridis', 'coolwarm', 'plasma', 'inferno', 'turbo'];

function isValidRGB(rgb: [number, number, number]): boolean {
  return (
    rgb.length === 3 &&
    rgb.every((c) => typeof c === 'number' && c >= 0 && c <= 1)
  );
}

/** Assert each RGB channel is within tolerance of expected. */
function expectColor(
  actual: [number, number, number],
  expected: [number, number, number],
  tolerance = 0.05,
) {
  expect(actual[0]).toBeCloseTo(expected[0], 1);
  expect(actual[1]).toBeCloseTo(expected[1], 1);
  expect(actual[2]).toBeCloseTo(expected[2], 1);
  for (const c of actual) {
    expect(c).toBeGreaterThanOrEqual(-tolerance);
    expect(c).toBeLessThanOrEqual(1 + tolerance);
  }
}

describe('mapScalarToColor', () => {
  it.each(ALL_PALETTES)('returns valid RGB for palette "%s"', (palette) => {
    const color = mapScalarToColor(0.5, 0, 1, palette);
    expect(isValidRGB(color)).toBe(true);
  });

  it('returns valid RGB for turbo palette specifically', () => {
    const color = mapScalarToColor(0.5, 0, 1, 'turbo');
    expect(isValidRGB(color)).toBe(true);
  });

  describe('known palette values', () => {
    it('jet value 0.0 -> dark blue', () => {
      expectColor(mapScalarToColor(0, 0, 1, 'jet'), [0, 0, 0.5]);
    });

    it('jet value 1.0 -> dark red', () => {
      expectColor(mapScalarToColor(1, 0, 1, 'jet'), [0.5, 0, 0]);
    });

    it('viridis value 0.0 -> deep purple', () => {
      expectColor(mapScalarToColor(0, 0, 1, 'viridis'), [0.267, 0.004, 0.329]);
    });

    it('viridis value 1.0 -> yellow', () => {
      expectColor(mapScalarToColor(1, 0, 1, 'viridis'), [0.993, 0.906, 0.144]);
    });

    it('coolwarm value 0.5 -> near white/neutral', () => {
      expectColor(mapScalarToColor(0.5, 0, 1, 'coolwarm'), [0.865, 0.865, 0.865]);
    });
  });

  describe('edge cases', () => {
    it('handles value at 0 (min boundary)', () => {
      const color = mapScalarToColor(0, 0, 1, 'viridis');
      expect(isValidRGB(color)).toBe(true);
      expect(color[0]).toBeCloseTo(0.267);
      expect(color[1]).toBeCloseTo(0.004);
      expect(color[2]).toBeCloseTo(0.329);
    });

    it('handles value at 1 (max boundary)', () => {
      const color = mapScalarToColor(1, 0, 1, 'viridis');
      expect(isValidRGB(color)).toBe(true);
      expect(color[0]).toBeCloseTo(0.993);
      expect(color[1]).toBeCloseTo(0.906);
      expect(color[2]).toBeCloseTo(0.144);
    });

    it('clamps value below 0', () => {
      const color = mapScalarToColor(-10, 0, 1, 'viridis');
      const colorAtMin = mapScalarToColor(0, 0, 1, 'viridis');
      expect(color).toEqual(colorAtMin);
    });

    it('clamps value above 1', () => {
      const color = mapScalarToColor(100, 0, 1, 'viridis');
      const colorAtMax = mapScalarToColor(1, 0, 1, 'viridis');
      expect(color).toEqual(colorAtMax);
    });

    it('returns gray for NaN', () => {
      expect(mapScalarToColor(NaN, 0, 1, 'viridis')).toEqual([0.5, 0.5, 0.5]);
    });

    it('returns gray for Infinity', () => {
      expect(mapScalarToColor(Infinity, 0, 1, 'jet')).toEqual([0.5, 0.5, 0.5]);
    });

    it('returns gray for -Infinity', () => {
      expect(mapScalarToColor(-Infinity, 0, 1, 'viridis')).toEqual([0.5, 0.5, 0.5]);
    });

    it('returns middle color when min === max', () => {
      const color = mapScalarToColor(5, 5, 5, 'viridis');
      expect(isValidRGB(color)).toBe(true);
      const midColor = mapScalarToColor(0.5, 0, 1, 'viridis');
      expect(color).toEqual(midColor);
    });
  });
});

describe('generateColorLUT', () => {
  it('returns 256 entries by default', () => {
    expect(generateColorLUT('viridis')).toHaveLength(256);
  });

  it('respects custom step count', () => {
    expect(generateColorLUT('plasma', 10)).toHaveLength(10);
  });

  it('all channels in [0,1]', () => {
    const lut = generateColorLUT('inferno');
    for (const [r, g, b] of lut) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
});

describe('PALETTES entries', () => {
  it('getAvailableColorMaps returns all expected palettes', () => {
    const available = getAvailableColorMaps();
    const names = available.map((cm) => cm.name);
    for (const p of ALL_PALETTES) {
      expect(names).toContain(p);
    }
    expect(available.length).toBe(ALL_PALETTES.length);
  });
});

describe('LABELS entries', () => {
  it.each(ALL_PALETTES)('getColorMapLabel returns a non-empty string for "%s"', (palette) => {
    const label = getColorMapLabel(palette);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });

  it('all available color maps have labels', () => {
    const available = getAvailableColorMaps();
    for (const cm of available) {
      expect(cm.label).toBeTruthy();
    }
  });
});
