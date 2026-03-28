import { describe, it, expect } from 'vitest';
import {
  mapScalarToColor,
  getColorMapLabel,
  getAvailableColorMaps,
  type ColorMapName,
} from '../colormap';

const ALL_PALETTES: ColorMapName[] = ['jet', 'viridis', 'coolwarm', 'plasma', 'inferno', 'turbo'];

describe('mapScalarToColor', () => {
  it.each(ALL_PALETTES)('returns valid RGB for palette "%s"', (palette) => {
    const [r, g, b] = mapScalarToColor(0.5, 0, 1, palette);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it('returns valid color at t=0', () => {
    const [r, g, b] = mapScalarToColor(0, 0, 1, 'viridis');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  it('returns valid color at t=1', () => {
    const [r, g, b] = mapScalarToColor(1, 0, 1, 'viridis');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  it('clamps values below min', () => {
    const atMin = mapScalarToColor(0, 0, 1, 'viridis');
    const belowMin = mapScalarToColor(-10, 0, 1, 'viridis');
    expect(belowMin).toEqual(atMin);
  });

  it('clamps values above max', () => {
    const atMax = mapScalarToColor(1, 0, 1, 'viridis');
    const aboveMax = mapScalarToColor(100, 0, 1, 'viridis');
    expect(aboveMax).toEqual(atMax);
  });

  it('returns gray for NaN', () => {
    const color = mapScalarToColor(NaN, 0, 1, 'viridis');
    expect(color).toEqual([0.5, 0.5, 0.5]);
  });

  it('returns gray for Infinity', () => {
    const color = mapScalarToColor(Infinity, 0, 1, 'jet');
    expect(color).toEqual([0.5, 0.5, 0.5]);
  });

  it('returns middle color when min === max', () => {
    const color = mapScalarToColor(5, 5, 5, 'viridis');
    const midColor = mapScalarToColor(0.5, 0, 1, 'viridis');
    expect(color).toEqual(midColor);
  });
});

describe('PALETTES', () => {
  it('getAvailableColorMaps returns all expected palettes', () => {
    const maps = getAvailableColorMaps();
    const names = maps.map((m) => m.name);
    for (const p of ALL_PALETTES) {
      expect(names).toContain(p);
    }
  });
});

describe('LABELS', () => {
  it.each(ALL_PALETTES)('getColorMapLabel returns a non-empty string for "%s"', (palette) => {
    const label = getColorMapLabel(palette);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });

  it('all available color maps have labels', () => {
    const maps = getAvailableColorMaps();
    for (const m of maps) {
      expect(m.label).toBeTruthy();
    }
  });
});
