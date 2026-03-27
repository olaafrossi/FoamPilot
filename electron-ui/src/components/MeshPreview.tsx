import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { getConfig } from "../api";
import { RotateCcw } from "lucide-react";

interface MeshPreviewProps {
  caseName: string;
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
        // Find the first mesh in the OBJ
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            setGeometry(child.geometry);
          }
        });
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

function CameraReset({ resetTrigger }: { resetTrigger: number }) {
  const { camera } = useThree();
  useEffect(() => {
    if (resetTrigger > 0) {
      camera.position.set(5, 3, 5);
      camera.lookAt(0, 0, 0);
    }
  }, [resetTrigger, camera]);
  return null;
}

export default function MeshPreview({ caseName }: MeshPreviewProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"obj" | "stl" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetCount, setResetCount] = useState(0);

  useEffect(() => {
    const config = getConfig();
    const triDir = `${config.localCasesPath}/${caseName}/constant/triSurface`;

    // Try to find geometry file via the backend (serves files over HTTP)
    // Fall back to checking common filenames
    const tryFiles = async () => {
      setLoading(true);
      setError(null);

      // Check for common geometry files by trying to fetch them
      const candidates = [
        { name: "motorBike.obj", type: "obj" as const },
        { name: "motorBike.stl", type: "stl" as const },
        { name: "geometry.stl", type: "stl" as const },
        { name: "geometry.obj", type: "obj" as const },
      ];

      // In browser mode (not Electron), we can't read local files directly.
      // Use the backend to serve the file content.
      for (const candidate of candidates) {
        try {
          const res = await fetch(
            `${config.backendUrl}/cases/${caseName}/file?path=constant/triSurface/${candidate.name}`,
          );
          if (res.ok) {
            // Got the file — create a blob URL
            const data = await res.json();
            if (data.content) {
              // Text content (OBJ files are text)
              const blob = new Blob([data.content], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              setFileUrl(url);
              setFileType(candidate.type);
              setLoading(false);
              return;
            }
          }
        } catch {
          // Try next candidate
        }
      }

      // If we have Electron file access, try reading directly
      if (window.foamPilot?.readFile) {
        for (const candidate of candidates) {
          try {
            const filePath = `${triDir}/${candidate.name}`.replace(/\//g, "\\");
            const buffer = await window.foamPilot.readFile(filePath);
            const blob = new Blob([buffer]);
            const url = URL.createObjectURL(blob);
            setFileUrl(url);
            setFileType(candidate.type);
            setLoading(false);
            return;
          } catch {
            // Try next
          }
        }
      }

      setError("No geometry file found in constant/triSurface/");
      setLoading(false);
    };

    tryFiles();

    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [caseName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: 300, background: "#1e1e1e" }}
      >
        <p style={{ color: "#858585", fontSize: 13 }}>Loading geometry...</p>
      </div>
    );
  }

  if (error || !fileUrl || !fileType) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: 300, background: "#1e1e1e", border: "1px solid #474747" }}
      >
        <p style={{ color: "#858585", fontSize: 13 }}>
          {error ?? "3D preview unavailable"}
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: 300, background: "#1a1a2e", border: "1px solid #474747" }}>
      <Canvas camera={{ position: [5, 3, 5], fov: 50 }}>
        <CameraReset resetTrigger={resetCount} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <directionalLight position={[-5, -5, -5]} intensity={0.3} />
        {fileType === "obj" ? (
          <OBJModel url={fileUrl} />
        ) : (
          <STLModel url={fileUrl} />
        )}
        <gridHelper args={[10, 10, "#333333", "#222222"]} />
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
