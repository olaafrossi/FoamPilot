import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RotateCcw } from "lucide-react";
import { mapScalarToColor } from "../lib/colormap";
import type { ColorMapName } from "../lib/colormap";
import type { FieldData } from "../types";

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
  onLoaded?: () => void;
  onError?: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Inner scene components
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

interface FieldMeshProps {
  fieldData: FieldData;
  colormap: ColorMapName;
  opacity: number;
  showWireframe: boolean;
  onLoaded?: () => void;
  onError?: (error: string) => void;
}

function FieldMesh({
  fieldData,
  colormap,
  opacity,
  showWireframe,
  onLoaded,
  onError,
}: FieldMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const { geometry, colorAttribute } = useMemo(() => {
    try {
      const geo = new THREE.BufferGeometry();

      // --- positions ---
      const posArr = new Float32Array(fieldData.vertices.length * 3);
      for (let i = 0; i < fieldData.vertices.length; i++) {
        const v = fieldData.vertices[i];
        posArr[i * 3] = v[0];
        posArr[i * 3 + 1] = v[1];
        posArr[i * 3 + 2] = v[2];
      }
      geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));

      // --- indices ---
      const idxArr = new Uint32Array(fieldData.faces.length * 3);
      for (let i = 0; i < fieldData.faces.length; i++) {
        const f = fieldData.faces[i];
        idxArr[i * 3] = f[0];
        idxArr[i * 3 + 1] = f[1];
        idxArr[i * 3 + 2] = f[2];
      }
      geo.setIndex(new THREE.BufferAttribute(idxArr, 1));

      // --- center & scale to 4-unit bounding box ---
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const center = new THREE.Vector3();
      box.getCenter(center);
      geo.translate(-center.x, -center.y, -center.z);

      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const scale = 4 / maxDim;
        geo.scale(scale, scale, scale);
      }

      // --- vertex normals ---
      geo.computeVertexNormals();

      // --- vertex colors (using production colormap library) ---
      const colArr = new Float32Array(fieldData.vertices.length * 3);
      const { min, max, values } = fieldData;

      for (let i = 0; i < values.length; i++) {
        const c = mapScalarToColor(values[i], min, max, colormap);
        colArr[i * 3] = c[0];
        colArr[i * 3 + 1] = c[1];
        colArr[i * 3 + 2] = c[2];
      }

      const colorAttr = new THREE.BufferAttribute(colArr, 3);
      geo.setAttribute("color", colorAttr);

      return { geometry: geo, colorAttribute: colorAttr };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to build mesh geometry";
      onError?.(msg);
      return { geometry: null, colorAttribute: null };
    }
  }, [fieldData, colormap, onError]);

  // Notify parent when geometry is ready
  useEffect(() => {
    if (geometry) {
      onLoaded?.();
    }
  }, [geometry, onLoaded]);

  if (!geometry) return null;

  const isTransparent = opacity < 1;

  return (
    <group>
      {/* Solid colored mesh */}
      <mesh ref={meshRef} geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          roughness={0.6}
          metalness={0.1}
          side={THREE.DoubleSide}
          transparent={isTransparent}
          opacity={opacity}
        />
      </mesh>
      {/* Wireframe overlay */}
      {showWireframe && (
        <mesh geometry={geometry}>
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
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export default function FieldMeshRenderer({
  fieldData,
  colormap = "jet",
  opacity = 1,
  showWireframe = false,
  showStreamlines: _showStreamlines = false,
  streamlineSeeds: _streamlineSeeds,
  onLoaded,
  onError,
}: FieldMeshRendererProps) {
  const [resetCount, setResetCount] = useState(0);

  // Null / missing data state
  if (!fieldData) {
    return (
      <div
        className="flex items-center justify-center"
        style={{
          height: 400,
          background: "#1e1e1e",
          border: "1px solid #474747",
        }}
      >
        <p style={{ color: "#858585", fontSize: 13 }}>
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
        border: "1px solid #474747",
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
            color: "#1e1e1e",
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
          onLoaded={onLoaded}
          onError={onError}
        />
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
          border: "1px solid #474747",
          borderRadius: 2,
          color: "#cccccc",
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
