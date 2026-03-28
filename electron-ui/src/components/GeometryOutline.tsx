/**
 * Renders dark edge outlines on top of the CFD mesh.
 *
 * Uses THREE.EdgesGeometry to extract sharp edges (above the angle threshold)
 * and draws them as semi-transparent black line segments. Gives the model a
 * subtle CAD-style outline that improves shape readability.
 */

import { useMemo } from "react";
import * as THREE from "three";

interface GeometryOutlineProps {
  /** Merged BufferGeometry covering all visible patches. */
  geometry: THREE.BufferGeometry;
  /** Edge detection angle threshold in degrees (default 15). */
  angleThreshold?: number;
  /** Line color (default #000000). */
  color?: string;
  /** Line opacity (default 0.3). */
  opacity?: number;
}

export default function GeometryOutline({
  geometry,
  angleThreshold = 15,
  color = "#000000",
  opacity = 0.3,
}: GeometryOutlineProps) {
  const edges = useMemo(() => {
    return new THREE.EdgesGeometry(geometry, angleThreshold);
  }, [geometry, angleThreshold]);

  return (
    <lineSegments geometry={edges}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest
      />
    </lineSegments>
  );
}
