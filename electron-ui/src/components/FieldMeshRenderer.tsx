import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RotateCcw } from "lucide-react";
import { mapScalarToColor } from "../lib/colormap";
import type { ColorMapName } from "../lib/colormap";
import type { FieldData } from "../types";
import StreamlineRenderer from "./StreamlineRenderer";
import type { MeshTransform } from "./StreamlineRenderer";

// ---------------------------------------------------------------------------
// Patch visibility helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Default patches to show: anything ending with "Group", plus floor + side wall.
 *  Matching is case-insensitive. If no patches match, show ALL (fallback). */
export function getDefaultVisiblePatches(
  patches: { name: string }[],
): Record<string, boolean> {
  const vis: Record<string, boolean> = {};
  for (const p of patches) {
    const lower = p.name.toLowerCase();
    vis[p.name] =
      lower.endsWith("group") ||
      lower === "lowerwall" ||
      lower === "frontandback";
  }
  // Fallback: if nothing would be visible, show everything
  const anyVisible = Object.values(vis).some(Boolean);
  if (!anyVisible) {
    for (const key of Object.keys(vis)) {
      vis[key] = true;
    }
  }
  return vis;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FieldMeshRendererProps {
  fieldData: FieldData | null;
  colormap?: ColorMapName;
  opacity?: number;
  showWireframe?: boolean;
  showStreamlines?: boolean;
  streamlineSeeds?: number[][];
  patchVisibility?: Record<string, boolean>;
  rangeMin?: number;
  rangeMax?: number;
  onLoaded?: () => void;
  onError?: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Inner scene: per-patch geometry groups
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

interface PatchGeometry {
  name: string;
  geometry: THREE.BufferGeometry;
}

interface FieldMeshProps {
  fieldData: FieldData;
  colormap: ColorMapName;
  opacity: number;
  showWireframe: boolean;
  patchVisibility: Record<string, boolean>;
  rangeMin: number;
  rangeMax: number;
  onLoaded?: () => void;
  onError?: (error: string) => void;
}

function FieldMesh({
  fieldData,
  colormap,
  opacity,
  showWireframe,
  patchVisibility,
  rangeMin,
  rangeMax,
  onLoaded,
  onError,
}: FieldMeshProps) {
  const patchGeometries = useMemo(() => {
    try {
      // --- shared vertex positions ---
      const posArr = new Float32Array(fieldData.vertices.length * 3);
      for (let i = 0; i < fieldData.vertices.length; i++) {
        const v = fieldData.vertices[i];
        posArr[i * 3] = v[0];
        posArr[i * 3 + 1] = v[1];
        posArr[i * 3 + 2] = v[2];
      }

      // --- shared vertex colors (use user-adjustable range) ---
      const colArr = new Float32Array(fieldData.vertices.length * 3);
      const { values } = fieldData;
      for (let i = 0; i < values.length; i++) {
        const c = mapScalarToColor(values[i], rangeMin, rangeMax, colormap);
        colArr[i * 3] = c[0];
        colArr[i * 3 + 1] = c[1];
        colArr[i * 3 + 2] = c[2];
      }

      // --- compute bounding box and transform positions once ---
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < fieldData.vertices.length; i++) {
        const x = posArr[i * 3], y = posArr[i * 3 + 1], z = posArr[i * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
      const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
      const scale = maxDim > 0 ? 4 / maxDim : 1;

      // Transform positions in-place ONCE (center + scale to 4-unit bbox)
      for (let i = 0; i < posArr.length / 3; i++) {
        posArr[i * 3]     = (posArr[i * 3]     - cx) * scale;
        posArr[i * 3 + 1] = (posArr[i * 3 + 1] - cy) * scale;
        posArr[i * 3 + 2] = (posArr[i * 3 + 2] - cz) * scale;
      }

      // Shared buffer attributes (already transformed)
      const posAttr = new THREE.BufferAttribute(posArr, 3);
      const colAttr = new THREE.BufferAttribute(colArr, 3);

      // --- build per-patch geometries ---
      const patches: PatchGeometry[] = [];

      for (const patch of fieldData.patches) {
        const startTri = patch.startFace;
        const numTris = patch.nFaces;
        if (numTris <= 0) continue;

        const geo = new THREE.BufferGeometry();

        // All patches share the same pre-transformed position + color buffers
        geo.setAttribute("position", posAttr);
        geo.setAttribute("color", colAttr);

        // Per-patch index buffer: slice the relevant triangles
        const patchIdx = new Uint32Array(numTris * 3);
        for (let i = 0; i < numTris; i++) {
          const fi = startTri + i;
          const f = fieldData.faces[fi];
          patchIdx[i * 3] = f[0];
          patchIdx[i * 3 + 1] = f[1];
          patchIdx[i * 3 + 2] = f[2];
        }
        geo.setIndex(new THREE.BufferAttribute(patchIdx, 1));
        geo.computeVertexNormals();

        patches.push({ name: patch.name, geometry: geo });
      }

      return patches;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to build mesh geometry";
      onError?.(msg);
      return [];
    }
  }, [fieldData, colormap, rangeMin, rangeMax, onError]);

  useEffect(() => {
    if (patchGeometries.length > 0) onLoaded?.();
  }, [patchGeometries, onLoaded]);

  if (patchGeometries.length === 0) return null;

  const isTransparent = opacity < 1;

  return (
    <group>
      {patchGeometries.map((pg) => {
        const visible = patchVisibility[pg.name] ?? false;
        return (
          <group key={pg.name} visible={visible}>
            <mesh geometry={pg.geometry}>
              <meshStandardMaterial
                vertexColors
                roughness={0.6}
                metalness={0.1}
                side={THREE.DoubleSide}
                transparent={isTransparent}
                opacity={opacity}
              />
            </mesh>
            {showWireframe && (
              <mesh geometry={pg.geometry}>
                <meshBasicMaterial
                  color="#ffffff"
                  wireframe
                  transparent
                  opacity={0.04}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export default function FieldMeshRenderer({
  fieldData,
  colormap = "jet",
  opacity = 1,
  showWireframe = false,
  showStreamlines = false,
  streamlineSeeds,
  patchVisibility: externalVisibility,
  rangeMin: externalRangeMin,
  rangeMax: externalRangeMax,
  onLoaded,
  onError,
}: FieldMeshRendererProps) {
  const [resetCount, setResetCount] = useState(0);

  // Compute patch visibility: prefer external (parent-managed), fallback to defaults
  const patchVisibility = useMemo(() => {
    if (externalVisibility) return externalVisibility;
    if (fieldData?.patches) return getDefaultVisiblePatches(fieldData.patches);
    return {};
  }, [externalVisibility, fieldData?.patches]);

  // Compute mesh transform for streamlines to match the same coordinate system
  const meshTransform = useMemo((): MeshTransform | null => {
    if (!fieldData || fieldData.vertices.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of fieldData.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const scale = maxDim > 0 ? 4 / maxDim : 1;
    return { center: [cx, cy, cz], scale };
  }, [fieldData]);

  if (!fieldData) {
    return (
      <div
        className="flex items-center justify-center"
        style={{
          height: 400,
          background: "var(--bg-editor)",
          border: "1px solid var(--border)",
        }}
      >
        <p style={{ color: "var(--fg-muted)", fontSize: 13 }}>
          No field data available
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        height: 400,
        background: "#1a1a2e",
        border: "1px solid var(--border)",
      }}
    >
      {/* Warning banner */}
      {fieldData.warning && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            background: "rgba(180, 160, 60, 0.9)",
            color: "var(--bg-editor)",
            fontSize: 12,
            padding: "4px 8px",
            textAlign: "center",
          }}
        >
          {fieldData.warning}
        </div>
      )}

      <Canvas
        camera={{ position: [6, -4, 3], fov: 50, up: [0, 0, 1] }}
        onCreated={({ camera }) => { camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0); }}
      >
        <CameraReset resetTrigger={resetCount} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <directionalLight position={[-5, -5, -5]} intensity={0.3} />
        <FieldMesh
          fieldData={fieldData}
          colormap={colormap}
          opacity={opacity}
          showWireframe={showWireframe}
          patchVisibility={patchVisibility}
          rangeMin={externalRangeMin ?? fieldData.min}
          rangeMax={externalRangeMax ?? fieldData.max}
          onLoaded={onLoaded}
          onError={onError}
        />
        {showStreamlines && fieldData.vectors && streamlineSeeds && meshTransform && (
          <StreamlineRenderer
            fieldData={fieldData}
            seeds={streamlineSeeds}
            colormap={colormap}
            meshTransform={meshTransform}
          />
        )}
        <gridHelper args={[10, 10, "#333333", "#222222"]} rotation={[-Math.PI / 2, 0, 0]} />
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          rotateSpeed={0.8}
          zoomSpeed={1.2}
        />
      </Canvas>

      {/* Reset camera button */}
      <button
        onClick={() => setResetCount((c) => c + 1)}
        title="Reset camera"
        style={{
          position: "absolute",
          top: fieldData.warning ? 32 : 8,
          right: 8,
          background: "rgba(30,30,30,0.8)",
          border: "1px solid var(--border)",
          borderRadius: 2,
          color: "var(--fg)",
          padding: "4px 6px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
}
