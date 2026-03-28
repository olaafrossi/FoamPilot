/**
 * Interactive field-value probe for the 3D scene.
 *
 * When active, listens for click events on the mesh, finds the nearest vertex
 * to the intersection point, reads its scalar value from the vertex buffer,
 * and reports back via callback. Also renders a small marker sphere and an
 * HTML label at the probe location.
 */

import { useCallback, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProbeResult {
  value: number;
  position: [number, number, number];
}

interface ProbeHandlerProps {
  /** Whether probe mode is active. When false the component is inert. */
  active: boolean;
  /** Scalar values array (one per vertex, matching the geometry). */
  values: number[];
  /** The mesh geometry to probe against. Must have "position" attribute. */
  geometry: THREE.BufferGeometry;
  /** Callback fired when a point is probed. */
  onProbeValue: (result: ProbeResult) => void;
  /** Field name displayed in the label (e.g. "p", "U"). */
  fieldName?: string;
  /** Units string for the label (e.g. "Pa"). */
  units?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProbeHandler({
  active,
  values,
  geometry,
  onProbeValue,
  fieldName = "",
  units = "",
}: ProbeHandlerProps) {
  const { raycaster, pointer, camera } = useThree();
  const [probePos, setProbePos] = useState<[number, number, number] | null>(null);
  const [probeVal, setProbeVal] = useState<number | null>(null);

  const handleClick = useCallback(() => {
    if (!active) return;

    raycaster.setFromCamera(pointer, camera);

    const mesh = new THREE.Mesh(geometry);
    const intersects = raycaster.intersectObject(mesh);
    if (intersects.length === 0) return;

    const hit = intersects[0];
    const hitPoint = hit.point;

    // Find nearest vertex to intersection point
    const posAttr = geometry.getAttribute("position");
    if (!posAttr) return;

    let nearestIdx = 0;
    let nearestDist = Infinity;
    const tmp = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      tmp.fromBufferAttribute(posAttr as THREE.BufferAttribute, i);
      const dist = tmp.distanceToSquared(hitPoint);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    if (nearestIdx >= values.length) return;

    const value = values[nearestIdx];
    const pos: [number, number, number] = [
      posAttr.getX(nearestIdx),
      posAttr.getY(nearestIdx),
      posAttr.getZ(nearestIdx),
    ];

    setProbePos(pos);
    setProbeVal(value);
    onProbeValue({ value, position: pos });
  }, [active, raycaster, pointer, camera, geometry, values, onProbeValue]);

  if (!active) return null;

  return (
    <group onClick={handleClick}>
      {/* Invisible click target covering the whole mesh */}
      <mesh geometry={geometry}>
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Probe marker */}
      {probePos && (
        <group position={probePos}>
          <mesh>
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshBasicMaterial color="#ff3333" />
          </mesh>
          <Html
            center
            distanceFactor={8}
            style={{
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            <div
              style={{
                background: "rgba(0, 0, 0, 0.85)",
                color: "#fff",
                padding: "4px 8px",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "monospace",
                transform: "translateY(-24px)",
              }}
            >
              {fieldName ? `${fieldName}: ` : ""}
              {probeVal !== null ? probeVal.toPrecision(5) : "---"}
              {units ? ` ${units}` : ""}
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}
