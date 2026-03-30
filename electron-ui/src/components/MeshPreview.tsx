import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getConfig } from "../api";
import { RotateCcw } from "lucide-react";

interface MeshPreviewProps {
  caseName: string;
  /** Increment to force a re-fetch of the geometry file */
  refreshKey?: number;
}

function MeshModel({ geometry }: { geometry: THREE.BufferGeometry }) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Center and scale the geometry
  const processedGeometry = useMemo(() => {
    const geo = geometry.clone();
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
    geo.computeVertexNormals();
    return geo;
  }, [geometry]);

  return (
    <group>
      {/* Solid mesh */}
      <mesh ref={meshRef} geometry={processedGeometry}>
        <meshStandardMaterial
          color="#6a9fd8"
          roughness={0.6}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Wireframe overlay */}
      <mesh geometry={processedGeometry}>
        <meshBasicMaterial
          color="#ffffff"
          wireframe
          transparent
          opacity={0.04}
        />
      </mesh>
    </group>
  );
}

function OBJModel({ url }: { url: string }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    const loader = new OBJLoader();
    loader.load(
      url,
      (obj) => {
        // Merge ALL meshes in the OBJ into one geometry
        const geometries: THREE.BufferGeometry[] = [];
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            // Apply the child's world transform to the geometry
            const geo = child.geometry.clone();
            geo.applyMatrix4(child.matrixWorld);
            geometries.push(geo);
          }
        });

        if (geometries.length === 0) return;

        if (geometries.length === 1) {
          setGeometry(geometries[0]);
        } else {
          // Merge all geometries into one
          const merged = mergeGeometries(geometries);
          if (merged) setGeometry(merged);
          else setGeometry(geometries[0]); // fallback
        }
      },
      undefined,
      (err) => console.error("OBJ load error:", err),
    );
  }, [url]);

  if (!geometry) return null;
  return <MeshModel geometry={geometry} />;
}

function STLModel({ url }: { url: string }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    const loader = new STLLoader();
    loader.load(
      url,
      (geo) => setGeometry(geo),
      undefined,
      (err) => console.error("STL load error:", err),
    );
  }, [url]);

  if (!geometry) return null;
  return <MeshModel geometry={geometry} />;
}

/** Colored axis arrows with HTML labels showing simulation directions */
function AxisHelper() {
  const arrowLength = 2.2;
  const headLength = 0.3;
  const headWidth = 0.15;
  const origin = new THREE.Vector3(-3.5, -3.5, -2);

  const axes = [
    {
      dir: new THREE.Vector3(1, 0, 0),
      color: "#ef4444",
      label: "X Flow",
      offset: [arrowLength + 0.15, 0, 0] as [number, number, number],
    },
    {
      dir: new THREE.Vector3(0, 1, 0),
      color: "#22c55e",
      label: "Y Lateral",
      offset: [0, arrowLength + 0.15, 0] as [number, number, number],
    },
    {
      dir: new THREE.Vector3(0, 0, 1),
      color: "#3b82f6",
      label: "Z Up",
      offset: [0, 0, arrowLength + 0.15] as [number, number, number],
    },
  ];

  return (
    <group position={origin}>
      {axes.map(({ dir, color, label, offset }) => (
        <group key={label}>
          <arrowHelper
            args={[dir, new THREE.Vector3(0, 0, 0), arrowLength, color, headLength, headWidth]}
          />
          <Html
            position={offset}
            center
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono, monospace)",
              color,
              fontWeight: 600,
              whiteSpace: "nowrap",
              userSelect: "none",
              pointerEvents: "none",
              textShadow: "0 0 4px rgba(0,0,0,0.8)",
            }}
          >
            {label}
          </Html>
        </group>
      ))}
    </group>
  );
}

/** Ground plane indicator at Z=0 */
function GroundPlane() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -2]}>
      <planeGeometry args={[12, 12]} />
      <meshBasicMaterial color="#1a3a1a" transparent opacity={0.15} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Flow direction arrow in the scene */
function FlowArrow() {
  const dir = new THREE.Vector3(1, 0, 0);
  const origin = new THREE.Vector3(-4.5, 0, 3);
  return (
    <group>
      <arrowHelper
        args={[dir, origin, 2.5, "#ef4444", 0.4, 0.2]}
      />
      <Html
        position={[-3.2, 0, 3.5]}
        center
        style={{
          fontSize: 10,
          fontFamily: "var(--font-mono, monospace)",
          color: "#ef4444",
          fontWeight: 600,
          whiteSpace: "nowrap",
          userSelect: "none",
          pointerEvents: "none",
          textShadow: "0 0 4px rgba(0,0,0,0.8)",
          opacity: 0.7,
        }}
      >
        Flow direction
      </Html>
    </group>
  );
}

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

export default function MeshPreview({ caseName, refreshKey = 0 }: MeshPreviewProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"obj" | "stl" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetCount, setResetCount] = useState(0);

  useEffect(() => {
    const config = getConfig();
    let blobUrl: string | null = null;

    const loadGeometry = async () => {
      setLoading(true);
      setError(null);

      try {
        // Use the dedicated backend endpoint that finds + decompresses geometry
        const res = await fetch(
          `${config.backendUrl}/cases/${caseName}/geometry-file`,
        );
        if (!res.ok) {
          const detail = await res.text();
          throw new Error(detail || res.statusText);
        }

        // Detect file type from Content-Disposition or URL
        const disposition = res.headers.get("content-disposition") ?? "";
        const isStl = disposition.includes(".stl") ||
          res.headers.get("content-type")?.includes("stl");

        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        setFileUrl(blobUrl);
        setFileType(isStl ? "stl" : "obj");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load geometry");
      } finally {
        setLoading(false);
      }
    };

    loadGeometry();

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [caseName, refreshKey]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: 300, background: "var(--bg-editor)" }}
      >
        <p style={{ color: "var(--fg-muted)", fontSize: 13 }}>Loading geometry...</p>
      </div>
    );
  }

  if (error || !fileUrl || !fileType) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: 300, background: "var(--bg-editor)", border: "1px solid var(--border)" }}
      >
        <p style={{ color: "var(--fg-muted)", fontSize: 13 }}>
          {error ?? "3D preview unavailable"}
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: 300, background: "#1a1a2e", border: "1px solid #474747" }}>
      <Canvas
        camera={{ position: [6, -4, 3], fov: 50, up: [0, 0, 1] }}
        onCreated={({ camera }) => { camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0); }}
      >
        <CameraReset resetTrigger={resetCount} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <directionalLight position={[-5, -5, -5]} intensity={0.3} />
        {fileType === "obj" ? (
          <OBJModel url={fileUrl} />
        ) : (
          <STLModel url={fileUrl} />
        )}
        <gridHelper args={[10, 10, "#333333", "#222222"]} rotation={[-Math.PI / 2, 0, 0]} />
        <AxisHelper />
        <GroundPlane />
        <FlowArrow />
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
          top: 8,
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
      {/* Legend */}
      <div
        style={{
          position: "absolute",
          bottom: 6,
          left: 8,
          display: "flex",
          gap: 10,
          fontSize: 10,
          fontFamily: "var(--font-mono, monospace)",
          opacity: 0.6,
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        <span style={{ color: "#ef4444" }}>X = Flow</span>
        <span style={{ color: "#22c55e" }}>Y = Lateral</span>
        <span style={{ color: "#3b82f6" }}>Z = Up</span>
      </div>
    </div>
  );
}
