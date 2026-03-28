/**
 * Configurable lighting for the 3D scene.
 *
 * Provides three named presets that trade off between visual appeal and
 * analytical accuracy. Swap presets at runtime without rebuilding the scene.
 */

import type { LightingPreset as LightingPresetName } from "../lib/viz-reducer";

interface LightingPresetProps {
  preset: LightingPresetName;
}

/**
 * R3F component that renders ambient + directional lights matching the
 * selected preset. Mount inside a Canvas; it produces no visible geometry.
 */
export default function LightingPreset({ preset }: LightingPresetProps) {
  switch (preset) {
    case "technical":
      return (
        <>
          <ambientLight intensity={0.6} />
          <directionalLight position={[0, 10, 0]} intensity={0.6} />
        </>
      );

    case "dramatic":
      return (
        <>
          <ambientLight intensity={0.15} />
          <directionalLight position={[5, 8, 3]} intensity={1.2} />
          <directionalLight position={[-3, -5, -2]} intensity={0.15} />
        </>
      );

    case "studio":
    default:
      return (
        <>
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 10, 5]} intensity={0.8} />
          <directionalLight position={[-5, -5, -5]} intensity={0.3} />
        </>
      );
  }
}
