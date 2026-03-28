/**
 * Side-by-side comparison view for two field datasets.
 *
 * Renders two R3F Canvases. The left canvas (leader) owns the OrbitControls;
 * the right canvas (follower) mirrors the leader's camera via a shared ref
 * that is read in useFrame. Both canvases render the mesh geometry with their
 * respective field data and colormaps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { mapScalarToColor } from "../lib/colormap";
import { computeMeshTransform } from "../lib/mesh-utils";
import type { ColorMapName } from "../lib/colormap";
import type { MeshTransform } from "../lib/mesh-utils";
import type { LightingPreset as LightingPresetName } from "../lib/viz-reducer";
import type { FieldData } from "../types";
import LightingPreset from "./LightingPreset";

// ---------------------------------------------------------------------------
// Shared camera state (plain mutable object, NOT React state)
// ---------------------------------------------------------------------------

interface CameraSnapshot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  zoom: number;
}

// ---------------------------------------------------------------------------
// FieldMesh (simplified version of SceneCompositor's inner FieldMesh)
// ---------------------------------------------------------------------------

interface SimpleMeshProps {
  fieldData: FieldData;
  colormap: ColorMapName;
  meshTransform: MeshTransform;
}

function SimpleMesh({ fieldData, colormap, meshTransform }: SimpleMeshProps) {
  const geometry = useMemo(() => {
    const { center, scale } = meshTransform;
    const numVerts = fieldData.vertices.length;

    // Position buffer
    const posArr = new Float32Array(numVerts * 3);
    for (let i = 0; i < numVerts; i++) {
      const v = fieldData.vertices[i];
      posArr[i * 3] = (v[0] - center[0]) * scale;
      posArr[i * 3 + 1] = (v[1] - center[1]) * scale;
      posArr[i * 3 + 2] = (v[2] - center[2]) * scale;
    }

    // Color buffer
    const colArr = new Float32Array(numVerts * 3);
    const { values, min, max } = fieldData;
    for (let i = 0; i < numVerts; i++) {
      const c = mapScalarToColor(values[i], min, max, colormap);
      colArr[i * 3] = c[0];
      colArr[i * 3 + 1] = c[1];
      colArr[i * 3 + 2] = c[2];
    }

    // Index buffer (all patches combined)
    const totalFaces = fieldData.faces.length;
    const idxArr = new Uint32Array(totalFaces * 3);
    for (let i = 0; i < totalFaces; i++) {
      const f = fieldData.faces[i];
      idxArr[i * 3] = f[0];
      idxArr[i * 3 + 1] = f[1];
      idxArr[i * 3 + 2] = f[2];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
    geo.computeVertexNormals();

    return geo;
  }, [fieldData, colormap, meshTransform]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={0.6}
        metalness={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Camera synchronization components
// ---------------------------------------------------------------------------

/** Writes the leader camera state to the shared ref every frame. */
function CameraLeader({
  snapshotRef,
}: {
  snapshotRef: React.MutableRefObject<CameraSnapshot>;
}) {
  const { camera } = useThree();

  useFrame(() => {
    snapshotRef.current.position.copy(camera.position);
    snapshotRef.current.quaternion.copy(camera.quaternion);
    if ((camera as THREE.OrthographicCamera).zoom !== undefined) {
      snapshotRef.current.zoom = (camera as THREE.OrthographicCamera).zoom;
    }
  });

  return null;
}

/** Reads the shared camera ref and applies it to the follower camera. */
function CameraFollower({
  snapshotRef,
}: {
  snapshotRef: React.MutableRefObject<CameraSnapshot>;
}) {
  const { camera } = useThree();

  useFrame(() => {
    camera.position.copy(snapshotRef.current.position);
    camera.quaternion.copy(snapshotRef.current.quaternion);
    if ((camera as THREE.OrthographicCamera).zoom !== undefined) {
      (camera as THREE.OrthographicCamera).zoom = snapshotRef.current.zoom;
      (camera as THREE.OrthographicCamera).updateProjectionMatrix();
    }
  });

  return null;
}

// ---------------------------------------------------------------------------
// CameraReset (same as in FieldMeshRenderer)
// ---------------------------------------------------------------------------

function CameraReset({ resetTrigger }: { resetTrigger: number }) {
  const { camera } = useThree();
  useEffect(() => {
    if (resetTrigger > 0) {
      camera.up.set(0, 0, 1);
      camera.position.set(6, -4, 3);
      camera.lookAt(0, 0, 0);
    }
  }, [resetTrigger, camera]);
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SplitViewProps {
  fieldDataA: FieldData;
  fieldDataB: FieldData;
  colormapA?: ColorMapName;
  colormapB?: ColorMapName;
  lightingPreset?: LightingPresetName;
  height?: number;
}

export default function SplitView({
  fieldDataA,
  fieldDataB,
  colormapA = "viridis",
  colormapB = "coolwarm",
  lightingPreset = "studio",
  height = 400,
}: SplitViewProps) {
  const [resetCount, setResetCount] = useState(0);

  // Shared camera ref — mutable object, not React state
  const cameraSnapshot = useRef<CameraSnapshot>({
    position: new THREE.Vector3(6, -4, 3),
    quaternion: new THREE.Quaternion(),
    zoom: 1,
  });

  const transformA = useMemo(
    () => computeMeshTransform(fieldDataA.vertices),
    [fieldDataA.vertices],
  );
  const transformB = useMemo(
    () => computeMeshTransform(fieldDataB.vertices),
    [fieldDataB.vertices],
  );

  const handleReset = useCallback(() => setResetCount((c) => c + 1), []);

  if (!transformA || !transformB) return null;

  const cameraProps = {
    position: [6, -4, 3] as [number, number, number],
    fov: 50,
    up: [0, 0, 1] as [number, number, number],
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        gap: 2,
        height,
        background: "#1a1a2e",
        border: "1px solid var(--border)",
      }}
    >
      {/* Leader (left) */}
      <div style={{ flex: 1, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 8,
            zIndex: 10,
            color: "#aaa",
            fontSize: 11,
            fontFamily: "monospace",
            pointerEvents: "none",
          }}
        >
          {fieldDataA.field}
        </div>
        <Canvas
          camera={cameraProps}
          onCreated={({ camera }) => {
            camera.up.set(0, 0, 1);
            camera.lookAt(0, 0, 0);
          }}
        >
          <CameraReset resetTrigger={resetCount} />
          <CameraLeader snapshotRef={cameraSnapshot} />
          <LightingPreset preset={lightingPreset} />
          <SimpleMesh
            fieldData={fieldDataA}
            colormap={colormapA}
            meshTransform={transformA}
          />
          <gridHelper
            args={[10, 10, "#333333", "#222222"]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
          <OrbitControls
            enableDamping
            dampingFactor={0.1}
            rotateSpeed={0.8}
            zoomSpeed={1.2}
          />
        </Canvas>
      </div>

      {/* Divider */}
      <div style={{ width: 2, background: "var(--border)", flexShrink: 0 }} />

      {/* Follower (right) */}
      <div style={{ flex: 1, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 8,
            zIndex: 10,
            color: "#aaa",
            fontSize: 11,
            fontFamily: "monospace",
            pointerEvents: "none",
          }}
        >
          {fieldDataB.field}
        </div>
        <Canvas
          camera={cameraProps}
          onCreated={({ camera }) => {
            camera.up.set(0, 0, 1);
            camera.lookAt(0, 0, 0);
          }}
        >
          <CameraReset resetTrigger={resetCount} />
          <CameraFollower snapshotRef={cameraSnapshot} />
          <LightingPreset preset={lightingPreset} />
          <SimpleMesh
            fieldData={fieldDataB}
            colormap={colormapB}
            meshTransform={transformB}
          />
          <gridHelper
            args={[10, 10, "#333333", "#222222"]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
          {/* No OrbitControls — camera follows the leader */}
        </Canvas>
      </div>

      {/* Reset camera */}
      <button
        onClick={handleReset}
        title="Reset camera"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 10,
          background: "rgba(30, 30, 30, 0.8)",
          border: "1px solid var(--border)",
          borderRadius: 2,
          color: "var(--fg)",
          padding: "4px 6px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          fontSize: 12,
        }}
      >
        Reset
      </button>
    </div>
  );
}
