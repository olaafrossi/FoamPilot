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
    const state = vizReducer(initialVizState, { type: 'SET_FIELD', field: 'U' });
    expect(state.selectedField).toBe('U');
  });

  it('SET_TIME updates selectedTime', () => {
    const state = vizReducer(initialVizState, { type: 'SET_TIME', time: '0.5' });
    expect(state.selectedTime).toBe('0.5');
  });

  it('SET_COLORMAP updates colormap', () => {
    const state = vizReducer(initialVizState, { type: 'SET_COLORMAP', colormap: 'jet' });
    expect(state.colormap).toBe('jet');
  });

  it('SET_OPACITY updates opacity', () => {
    const state = vizReducer(initialVizState, { type: 'SET_OPACITY', opacity: 0.5 });
    expect(state.opacity).toBe(0.5);
  });

  it('TOGGLE_WIREFRAME flips showWireframe', () => {
    const state = vizReducer(initialVizState, { type: 'TOGGLE_WIREFRAME' });
    expect(state.showWireframe).toBe(true);
    const state2 = vizReducer(state, { type: 'TOGGLE_WIREFRAME' });
    expect(state2.showWireframe).toBe(false);
  });

  it('TOGGLE_STREAMLINES flips showStreamlines', () => {
    const state = vizReducer(initialVizState, { type: 'TOGGLE_STREAMLINES' });
    expect(state.showStreamlines).toBe(true);
  });

  it('SET_SEED_COUNT updates seedCount', () => {
    const state = vizReducer(initialVizState, { type: 'SET_SEED_COUNT', count: 50 });
    expect(state.seedCount).toBe(50);
  });

  it('SET_SEED_MODE updates seedMode', () => {
    const state = vizReducer(initialVizState, { type: 'SET_SEED_MODE', mode: 'velocity' });
    expect(state.seedMode).toBe('velocity');
  });

  it('TOGGLE_SEED_VISIBLE_ONLY flips seedVisibleOnly', () => {
    const state = vizReducer(initialVizState, { type: 'TOGGLE_SEED_VISIBLE_ONLY' });
    expect(state.seedVisibleOnly).toBe(false);
  });

  it('SET_TUBE_SCALE updates tubeScale', () => {
    const state = vizReducer(initialVizState, { type: 'SET_TUBE_SCALE', scale: 2.5 });
    expect(state.tubeScale).toBe(2.5);
  });

  it('SET_STREAMLINE_OFFSET updates both offsets', () => {
    const state = vizReducer(initialVizState, { type: 'SET_STREAMLINE_OFFSET', x: 1, y: -1 });
    expect(state.streamlineOffsetX).toBe(1);
    expect(state.streamlineOffsetY).toBe(-1);
  });

  it('TOGGLE_PATCH_PANEL flips showPatchPanel', () => {
    const state = vizReducer(initialVizState, { type: 'TOGGLE_PATCH_PANEL' });
    expect(state.showPatchPanel).toBe(true);
  });

  it('SET_RANGE updates rangeMin and rangeMax', () => {
    const state = vizReducer(initialVizState, { type: 'SET_RANGE', min: -5, max: 5 });
    expect(state.rangeMin).toBe(-5);
    expect(state.rangeMax).toBe(5);
  });

  it('TOGGLE_PARTICLES flips showParticles', () => {
    const state = vizReducer(initialVizState, { type: 'TOGGLE_PARTICLES' });
    expect(state.showParticles).toBe(true);
  });

  it('SET_PARTICLE_COUNT updates particleCount', () => {
    const state = vizReducer(initialVizState, { type: 'SET_PARTICLE_COUNT', count: 10000 });
    expect(state.particleCount).toBe(10000);
  });

  it('TOGGLE_OUTLINE flips showOutline', () => {
    const state = vizReducer(initialVizState, { type: 'TOGGLE_OUTLINE' });
    expect(state.showOutline).toBe(true);
  });

  it('SET_LIGHTING updates lightingPreset', () => {
    const state = vizReducer(initialVizState, { type: 'SET_LIGHTING', preset: 'dramatic' });
    expect(state.lightingPreset).toBe('dramatic');
  });

  it('SET_SLICE updates sliceAxis and slicePosition', () => {
    const state = vizReducer(initialVizState, { type: 'SET_SLICE', axis: 'y', position: 0.5 });
    expect(state.sliceAxis).toBe('y');
    expect(state.slicePosition).toBe(0.5);
  });

  it('SET_SLICE with null axis', () => {
    const state = vizReducer(initialVizState, { type: 'SET_SLICE', axis: null, position: 0 });
    expect(state.sliceAxis).toBeNull();
  });

  it('SET_SLICE_POSITION updates slicePosition', () => {
    const state = vizReducer(initialVizState, { type: 'SET_SLICE_POSITION', position: 0.75 });
    expect(state.slicePosition).toBe(0.75);
  });

  it('TOGGLE_PROBE enables probeMode', () => {
    const state = vizReducer(initialVizState, { type: 'TOGGLE_PROBE' });
    expect(state.probeMode).toBe(true);
    expect(state.probeValue).toBeNull();
    expect(state.probePosition).toBeNull();
  });

  it('TOGGLE_PROBE clears probe data when disabling', () => {
    const active: VizState = {
      ...initialVizState,
      probeMode: true,
      probeValue: 42,
      probePosition: [1, 2, 3],
    };
    const state = vizReducer(active, { type: 'TOGGLE_PROBE' });
    expect(state.probeMode).toBe(false);
    expect(state.probeValue).toBeNull();
    expect(state.probePosition).toBeNull();
  });

  it('SET_PROBE_VALUE updates probeValue and probePosition', () => {
    const state = vizReducer(initialVizState, {
      type: 'SET_PROBE_VALUE',
      value: 3.14,
      position: [1, 2, 3],
    });
    expect(state.probeValue).toBe(3.14);
    expect(state.probePosition).toEqual([1, 2, 3]);
  });

  it('TOGGLE_SPLIT_VIEW flips splitView', () => {
    const state = vizReducer(initialVizState, { type: 'TOGGLE_SPLIT_VIEW' });
    expect(state.splitView).toBe(true);
  });

  it('SET_SPLIT_FIELD updates splitField', () => {
    const state = vizReducer(initialVizState, { type: 'SET_SPLIT_FIELD', field: 'k' });
    expect(state.splitField).toBe('k');
  });

  it('TOGGLE_TOOLTIPS flips showTooltips', () => {
    const state = vizReducer(initialVizState, { type: 'TOGGLE_TOOLTIPS' });
    expect(state.showTooltips).toBe(true);
  });
});
