import { describe, it, expect } from 'vitest';
import { vizReducer, initialVizState, type VizState } from '../viz-reducer';

describe('initialVizState', () => {
  it('has correct defaults', () => {
    expect(initialVizState.selectedField).toBe('p');
    expect(initialVizState.selectedTime).toBe('latest');
    expect(initialVizState.colormap).toBe('viridis');
    expect(initialVizState.opacity).toBe(1);
    expect(initialVizState.showWireframe).toBe(false);
    expect(initialVizState.showStreamlines).toBe(false);
    expect(initialVizState.seedCount).toBe(20);
    expect(initialVizState.seedMode).toBe('uniform');
    expect(initialVizState.seedVisibleOnly).toBe(true);
    expect(initialVizState.tubeScale).toBe(1);
    expect(initialVizState.streamlineOffsetX).toBe(0);
    expect(initialVizState.streamlineOffsetY).toBe(0);
    expect(initialVizState.showPatchPanel).toBe(false);
    expect(initialVizState.rangeMin).toBe(0);
    expect(initialVizState.rangeMax).toBe(1);
    expect(initialVizState.showParticles).toBe(false);
    expect(initialVizState.particleCount).toBe(5000);
    expect(initialVizState.showOutline).toBe(false);
    expect(initialVizState.lightingPreset).toBe('studio');
    expect(initialVizState.sliceAxis).toBeNull();
    expect(initialVizState.slicePosition).toBe(0);
    expect(initialVizState.probeMode).toBe(false);
    expect(initialVizState.probeValue).toBeNull();
    expect(initialVizState.probePosition).toBeNull();
    expect(initialVizState.splitView).toBe(false);
    expect(initialVizState.splitField).toBe('U');
    expect(initialVizState.showTooltips).toBe(false);
  });
});

describe('vizReducer', () => {
  it('SET_FIELD updates selectedField', () => {
    const s = vizReducer(initialVizState, { type: 'SET_FIELD', field: 'U' });
    expect(s.selectedField).toBe('U');
  });

  it('SET_TIME updates selectedTime', () => {
    const s = vizReducer(initialVizState, { type: 'SET_TIME', time: '0.5' });
    expect(s.selectedTime).toBe('0.5');
  });

  it('SET_COLORMAP updates colormap', () => {
    const s = vizReducer(initialVizState, { type: 'SET_COLORMAP', colormap: 'jet' });
    expect(s.colormap).toBe('jet');
  });

  it('SET_OPACITY updates opacity', () => {
    const s = vizReducer(initialVizState, { type: 'SET_OPACITY', opacity: 0.5 });
    expect(s.opacity).toBe(0.5);
  });

  it('TOGGLE_WIREFRAME toggles showWireframe', () => {
    const s1 = vizReducer(initialVizState, { type: 'TOGGLE_WIREFRAME' });
    expect(s1.showWireframe).toBe(true);
    const s2 = vizReducer(s1, { type: 'TOGGLE_WIREFRAME' });
    expect(s2.showWireframe).toBe(false);
  });

  it('TOGGLE_STREAMLINES toggles showStreamlines', () => {
    const s = vizReducer(initialVizState, { type: 'TOGGLE_STREAMLINES' });
    expect(s.showStreamlines).toBe(true);
  });

  it('SET_SEED_COUNT updates seedCount', () => {
    const s = vizReducer(initialVizState, { type: 'SET_SEED_COUNT', count: 50 });
    expect(s.seedCount).toBe(50);
  });

  it('SET_SEED_MODE updates seedMode', () => {
    const s = vizReducer(initialVizState, { type: 'SET_SEED_MODE', mode: 'velocity' });
    expect(s.seedMode).toBe('velocity');
  });

  it('TOGGLE_SEED_VISIBLE_ONLY toggles seedVisibleOnly', () => {
    const s = vizReducer(initialVizState, { type: 'TOGGLE_SEED_VISIBLE_ONLY' });
    expect(s.seedVisibleOnly).toBe(false);
  });

  it('SET_TUBE_SCALE updates tubeScale', () => {
    const s = vizReducer(initialVizState, { type: 'SET_TUBE_SCALE', scale: 2.5 });
    expect(s.tubeScale).toBe(2.5);
  });

  it('SET_STREAMLINE_OFFSET updates offsets', () => {
    const s = vizReducer(initialVizState, { type: 'SET_STREAMLINE_OFFSET', x: 1.5, y: -0.5 });
    expect(s.streamlineOffsetX).toBe(1.5);
    expect(s.streamlineOffsetY).toBe(-0.5);
  });

  it('TOGGLE_PATCH_PANEL toggles showPatchPanel', () => {
    const s = vizReducer(initialVizState, { type: 'TOGGLE_PATCH_PANEL' });
    expect(s.showPatchPanel).toBe(true);
  });

  it('SET_RANGE updates rangeMin and rangeMax', () => {
    const s = vizReducer(initialVizState, { type: 'SET_RANGE', min: -5, max: 10 });
    expect(s.rangeMin).toBe(-5);
    expect(s.rangeMax).toBe(10);
  });

  it('TOGGLE_PARTICLES toggles showParticles', () => {
    const s = vizReducer(initialVizState, { type: 'TOGGLE_PARTICLES' });
    expect(s.showParticles).toBe(true);
  });

  it('SET_PARTICLE_COUNT updates particleCount', () => {
    const s = vizReducer(initialVizState, { type: 'SET_PARTICLE_COUNT', count: 10000 });
    expect(s.particleCount).toBe(10000);
  });

  it('TOGGLE_OUTLINE toggles showOutline', () => {
    const s = vizReducer(initialVizState, { type: 'TOGGLE_OUTLINE' });
    expect(s.showOutline).toBe(true);
  });

  it('SET_LIGHTING updates lightingPreset', () => {
    const s = vizReducer(initialVizState, { type: 'SET_LIGHTING', preset: 'dramatic' });
    expect(s.lightingPreset).toBe('dramatic');
  });

  it('SET_SLICE updates sliceAxis and slicePosition', () => {
    const s = vizReducer(initialVizState, { type: 'SET_SLICE', axis: 'y', position: 0.75 });
    expect(s.sliceAxis).toBe('y');
    expect(s.slicePosition).toBe(0.75);
  });

  it('SET_SLICE_POSITION updates slicePosition only', () => {
    const base = vizReducer(initialVizState, { type: 'SET_SLICE', axis: 'x', position: 0.5 });
    const s = vizReducer(base, { type: 'SET_SLICE_POSITION', position: 0.9 });
    expect(s.sliceAxis).toBe('x');
    expect(s.slicePosition).toBe(0.9);
  });

  it('TOGGLE_PROBE enables probe mode without clearing data', () => {
    const s = vizReducer(initialVizState, { type: 'TOGGLE_PROBE' });
    expect(s.probeMode).toBe(true);
    // Should not clear (there was nothing to clear, and enabling keeps data)
    expect(s.probeValue).toBeNull();
    expect(s.probePosition).toBeNull();
  });

  it('TOGGLE_PROBE clears probe data when disabling', () => {
    // Enable probe, set some data, then disable
    let s: VizState = vizReducer(initialVizState, { type: 'TOGGLE_PROBE' });
    s = vizReducer(s, {
      type: 'SET_PROBE_VALUE',
      value: 42,
      position: [1, 2, 3],
    });
    expect(s.probeMode).toBe(true);
    expect(s.probeValue).toBe(42);
    // Now disable
    s = vizReducer(s, { type: 'TOGGLE_PROBE' });
    expect(s.probeMode).toBe(false);
    expect(s.probeValue).toBeNull();
    expect(s.probePosition).toBeNull();
  });

  it('SET_PROBE_VALUE updates probeValue and probePosition', () => {
    const s = vizReducer(initialVizState, {
      type: 'SET_PROBE_VALUE',
      value: 3.14,
      position: [10, 20, 30],
    });
    expect(s.probeValue).toBe(3.14);
    expect(s.probePosition).toEqual([10, 20, 30]);
  });

  it('TOGGLE_SPLIT_VIEW toggles splitView', () => {
    const s = vizReducer(initialVizState, { type: 'TOGGLE_SPLIT_VIEW' });
    expect(s.splitView).toBe(true);
  });

  it('SET_SPLIT_FIELD updates splitField', () => {
    const s = vizReducer(initialVizState, { type: 'SET_SPLIT_FIELD', field: 'k' });
    expect(s.splitField).toBe('k');
  });

  it('TOGGLE_TOOLTIPS toggles showTooltips', () => {
    const s = vizReducer(initialVizState, { type: 'TOGGLE_TOOLTIPS' });
    expect(s.showTooltips).toBe(true);
  });
});
