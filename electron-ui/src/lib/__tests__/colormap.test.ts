import { describe, it, expect } from 'vitest';
import {
  mapScalarToColor,
  generateColorLUT,
  getColorMapLabel,
  getAvailableColorMaps,
} from '../colormap';

/** Assert each RGB channel is within tolerance of expected. */
function expectColor(
  actual: [number, number, number],
  expected: [number, number, number],
  tolerance = 0.05,
) {
  expect(actual[0]).toBeCloseTo(expected[0], 1);
  expect(actual[1]).toBeCloseTo(expected[1], 1);
  expect(actual[2]).toBeCloseTo(expected[2], 1);
  // Also verify channels are in [0,1]
  for (const c of actual) {
    expect(c).toBeGreaterThanOrEqual(-tolerance);
    expect(c).toBeLessThanOrEqual(1 + tolerance);
  }
}

describe('mapScalarToColor', () => {
  describe('jet palette', () => {
    it('value 0.0 → dark blue', () => {
      const c = mapScalarToColor(0, 0, 1, 'jet');
      expectColor(c, [0, 0, 0.5]);
    });

    it('value 0.5 → green', () => {
      const c = mapScalarToColor(0.5, 0, 1, 'jet');
      expectColor(c, [0, 1, 0], 0.1);
    });

    it('value 1.0 → dark red', () => {
      const c = mapScalarToColor(1, 0, 1, 'jet');
      expectColor(c, [0.5, 0, 0]);
    });
  });

  describe('viridis palette', () => {
    it('value 0.0 → deep purple', () => {
      const c = mapScalarToColor(0, 0, 1, 'viridis');
      expectColor(c, [0.267, 0.004, 0.329]);
    });

    it('value 1.0 → yellow', () => {
      const c = mapScalarToColor(1, 0, 1, 'viridis');
      expectColor(c, [0.993, 0.906, 0.144]);
    });
  });

  describe('coolwarm palette', () => {
    it('value 0.5 → near white/neutral', () => {
      const c = mapScalarToColor(0.5, 0, 1, 'coolwarm');
      expectColor(c, [0.865, 0.865, 0.865]);
    });
  });

  describe('edge cases', () => {
    it('min === max → middle color of palette', () => {
      const c = mapScalarToColor(5, 5, 5, 'jet');
      // Middle of jet is green
      expectColor(c, [0, 1, 0], 0.1);
    });

    it('NaN → gray', () => {
      const c = mapScalarToColor(NaN, 0, 1, 'jet');
      expectColor(c, [0.5, 0.5, 0.5]);
    });

    it('Infinity → gray', () => {
      const c = mapScalarToColor(Infinity, 0, 1, 'jet');
      expectColor(c, [0.5, 0.5, 0.5]);
    });

    it('-Infinity → gray', () => {
      const c = mapScalarToColor(-Infinity, 0, 1, 'viridis');
      expectColor(c, [0.5, 0.5, 0.5]);
    });

    it('value below min → clamped to min color', () => {
      const c = mapScalarToColor(-10, 0, 1, 'jet');
      expectColor(c, [0, 0, 0.5]);
    });

    it('value above max → clamped to max color', () => {
      const c = mapScalarToColor(100, 0, 1, 'jet');
      expectColor(c, [0.5, 0, 0]);
    });
  });
});

describe('generateColorLUT', () => {
  it('returns 256 entries by default', () => {
    const lut = generateColorLUT('viridis');
    expect(lut).toHaveLength(256);
  });

  it('respects custom step count', () => {
    const lut = generateColorLUT('plasma', 10);
    expect(lut).toHaveLength(10);
  });

  it('first entry matches palette start', () => {
    const lut = generateColorLUT('jet');
    expectColor(lut[0], [0, 0, 0.5]);
  });

  it('last entry matches palette end', () => {
    const lut = generateColorLUT('jet');
    expectColor(lut[255], [0.5, 0, 0]);
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

describe('getColorMapLabel', () => {
  it('returns human-readable label', () => {
    expect(getColorMapLabel('jet')).toContain('Jet');
    expect(getColorMapLabel('viridis')).toContain('Viridis');
  });
});

describe('getAvailableColorMaps', () => {
  it('returns all 5 palettes', () => {
    const maps = getAvailableColorMaps();
    expect(maps).toHaveLength(5);
    const names = maps.map((m) => m.name);
    expect(names).toContain('jet');
    expect(names).toContain('viridis');
    expect(names).toContain('coolwarm');
    expect(names).toContain('plasma');
    expect(names).toContain('inferno');
  });

  it('each entry has name and label', () => {
    for (const m of getAvailableColorMaps()) {
      expect(m.name).toBeTruthy();
      expect(m.label).toBeTruthy();
    }
  });
});
