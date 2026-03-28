/**
 * State management for the visualization panel.
 *
 * Uses the useReducer pattern so all field-viewer state lives in one place
 * with explicit, typed actions. Mirrors the controls currently scattered
 * across VisualizationPanel and adds new features (particles, slice plane,
 * probe, split view, lighting presets).
 */

import type { ColorMapName } from './colormap';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LightingPreset = 'studio' | 'technical' | 'dramatic';
export type SliceAxis = 'x' | 'y' | 'z';

export interface VizState {
  // --- Existing state (from VisualizationPanel) ---
  selectedField: string;
  selectedTime: string;
  colormap: ColorMapName;
  opacity: number;
  showWireframe: boolean;
  showStreamlines: boolean;
  seedCount: number;
  seedMode: 'uniform' | 'velocity';
  seedVisibleOnly: boolean;
  tubeScale: number;
  streamlineOffsetX: number;
  streamlineOffsetY: number;
  showPatchPanel: boolean;
  rangeMin: number;
  rangeMax: number;

  // --- New state ---
  showParticles: boolean;
  particleCount: number;
  showOutline: boolean;
  lightingPreset: LightingPreset;
  sliceAxis: SliceAxis | null;
  slicePosition: number;
  probeMode: boolean;
  probeValue: number | null;
  probePosition: [number, number, number] | null;
  splitView: boolean;
  splitField: string;
  showTooltips: boolean;
}

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type VizAction =
  | { type: 'SET_FIELD'; field: string }
  | { type: 'SET_TIME'; time: string }
  | { type: 'SET_COLORMAP'; colormap: ColorMapName }
  | { type: 'SET_OPACITY'; opacity: number }
  | { type: 'TOGGLE_WIREFRAME' }
  | { type: 'TOGGLE_STREAMLINES' }
  | { type: 'SET_SEED_COUNT'; count: number }
  | { type: 'SET_SEED_MODE'; mode: 'uniform' | 'velocity' }
  | { type: 'TOGGLE_SEED_VISIBLE_ONLY' }
  | { type: 'SET_TUBE_SCALE'; scale: number }
  | { type: 'SET_STREAMLINE_OFFSET'; x: number; y: number }
  | { type: 'TOGGLE_PATCH_PANEL' }
  | { type: 'SET_RANGE'; min: number; max: number }
  | { type: 'TOGGLE_PARTICLES' }
  | { type: 'SET_PARTICLE_COUNT'; count: number }
  | { type: 'TOGGLE_OUTLINE' }
  | { type: 'SET_LIGHTING'; preset: LightingPreset }
  | { type: 'SET_SLICE'; axis: SliceAxis | null; position: number }
  | { type: 'SET_SLICE_POSITION'; position: number }
  | { type: 'TOGGLE_PROBE' }
  | { type: 'SET_PROBE_VALUE'; value: number | null; position: [number, number, number] | null }
  | { type: 'TOGGLE_SPLIT_VIEW' }
  | { type: 'SET_SPLIT_FIELD'; field: string }
  | { type: 'TOGGLE_TOOLTIPS' };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialVizState: VizState = {
  selectedField: 'p',
  selectedTime: 'latest',
  colormap: 'viridis',
  opacity: 1,
  showWireframe: false,
  showStreamlines: false,
  seedCount: 20,
  seedMode: 'uniform',
  seedVisibleOnly: true,
  tubeScale: 1,
  streamlineOffsetX: 0,
  streamlineOffsetY: 0,
  showPatchPanel: false,
  rangeMin: 0,
  rangeMax: 1,

  showParticles: false,
  particleCount: 5000,
  showOutline: false,
  lightingPreset: 'studio',
  sliceAxis: null,
  slicePosition: 0,
  probeMode: false,
  probeValue: null,
  probePosition: null,
  splitView: false,
  splitField: 'U',
  showTooltips: false,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function vizReducer(state: VizState, action: VizAction): VizState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, selectedField: action.field };

    case 'SET_TIME':
      return { ...state, selectedTime: action.time };

    case 'SET_COLORMAP':
      return { ...state, colormap: action.colormap };

    case 'SET_OPACITY':
      return { ...state, opacity: action.opacity };

    case 'TOGGLE_WIREFRAME':
      return { ...state, showWireframe: !state.showWireframe };

    case 'TOGGLE_STREAMLINES':
      return { ...state, showStreamlines: !state.showStreamlines };

    case 'SET_SEED_COUNT':
      return { ...state, seedCount: action.count };

    case 'SET_SEED_MODE':
      return { ...state, seedMode: action.mode };

    case 'TOGGLE_SEED_VISIBLE_ONLY':
      return { ...state, seedVisibleOnly: !state.seedVisibleOnly };

    case 'SET_TUBE_SCALE':
      return { ...state, tubeScale: action.scale };

    case 'SET_STREAMLINE_OFFSET':
      return { ...state, streamlineOffsetX: action.x, streamlineOffsetY: action.y };

    case 'TOGGLE_PATCH_PANEL':
      return { ...state, showPatchPanel: !state.showPatchPanel };

    case 'SET_RANGE':
      return { ...state, rangeMin: action.min, rangeMax: action.max };

    case 'TOGGLE_PARTICLES':
      return { ...state, showParticles: !state.showParticles };

    case 'SET_PARTICLE_COUNT':
      return { ...state, particleCount: action.count };

    case 'TOGGLE_OUTLINE':
      return { ...state, showOutline: !state.showOutline };

    case 'SET_LIGHTING':
      return { ...state, lightingPreset: action.preset };

    case 'SET_SLICE':
      return { ...state, sliceAxis: action.axis, slicePosition: action.position };

    case 'SET_SLICE_POSITION':
      return { ...state, slicePosition: action.position };

    case 'TOGGLE_PROBE':
      return {
        ...state,
        probeMode: !state.probeMode,
        // Clear probe data when disabling
        ...(!state.probeMode ? {} : { probeValue: null, probePosition: null }),
      };

    case 'SET_PROBE_VALUE':
      return { ...state, probeValue: action.value, probePosition: action.position };

    case 'TOGGLE_SPLIT_VIEW':
      return { ...state, splitView: !state.splitView };

    case 'SET_SPLIT_FIELD':
      return { ...state, splitField: action.field };

    case 'TOGGLE_TOOLTIPS':
      return { ...state, showTooltips: !state.showTooltips };

    default: {
      // Exhaustiveness check — TypeScript will error if a case is missing
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
