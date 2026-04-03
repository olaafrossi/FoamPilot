import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getConfig } from "../api";
import { RotateCcw, Play, Pause } from "lucide-react";

interface MRFZoneViz {
  name: string;
  origin: [number, number, number];
  axis: [number, number, number];
  rpm: number;
  radius: number;
  half_length: number;
}

interface GeometryViz {
  filename: string;
  role: string;
  color: string;
}

interface MeshPreviewProps {
  caseName: string;
  /** Increment to force a re-fetch of the geometry file */
  refreshKey?: number;
  /** Optional: multiple geometries to render with different colors */
  geometries?: GeometryViz[];
  /** Optional: MRF zones to visualize as translucent cylinders + axis arrows */
  mrfZones?: MRFZoneViz[];
  /** Whether MRF rotation animation is playing */
  playing?: boolean;
  /** Callback when play/pause is toggled */
  onPlayToggle?: () => void;
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

/** STL model rendered at original coordinates with a specific color (for multi-geometry mode) */
function ColoredSTLModel({ url, color }: { url: string; color: string }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    const loader = new STLLoader();
    loader.load(
      url,
      (geo) => { geo.computeVertexNormals(); setGeometry(geo); },
      undefined,
      (err) => console.error("STL load error:", err),
    );
  }, [url]);

  if (!geometry) return null;
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.04} />
      </mesh>
    </group>
  );
}

/** STL model that rotates around an MRF axis when playing.
 *
 * The rotation pivot is the geometry's own bounding-box center projected onto
 * the rotation axis — so the part spins in place rather than orbiting.
 * Because this component lives inside MultiGeometryGroup (which applies
 * center+scale), we work in the geometry's original coordinate space and
 * let the parent group handle the transform to screen space.
 */
function AnimatedRotatingModel({
  url, color, origin, axis, rpm, playing,
}: {
  url: string; color: string;
  origin: [number, number, number]; axis: [number, number, number];
  rpm: number; playing: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const pivotRef = useRef<THREE.Group>(null);
  const axisVec = useMemo(() => new THREE.Vector3(...axis).normalize(), [axis]);
  const originVec = useMemo(() => new THREE.Vector3(...origin), [origin]);

  // Visual speed: cap at 120 RPM for readability
  const visualOmega = useMemo(() => {
    const cappedRpm = Math.min(Math.abs(rpm), 120);
    return (Math.sign(rpm) || 1) * cappedRpm * 2 * Math.PI / 60;
  }, [rpm]);

  useFrame((_, delta) => {
    if (!playing || !pivotRef.current) return;
    // Pure rotation around the axis — the pivot group is positioned at the
    // MRF origin so rotateOnAxis spins the geometry in place.
    pivotRef.current.rotateOnAxis(axisVec, visualOmega * delta);
  });

  // Pivot group is positioned at the MRF origin.  The child geometry is
  // offset by -origin so the origin becomes the local (0,0,0), making
  // rotateOnAxis spin around the correct point.
  return (
    <group ref={pivotRef} position={[originVec.x, originVec.y, originVec.z]}>
      <group position={[-originVec.x, -originVec.y, -originVec.z]}>
        <ColoredSTLModel url={url} color={color} />
      </group>
    </group>
  );
}

/** Translucent cylinder + rotation axis arrow for MRF zone visualization */
function MRFZoneCylinder({ zone }: { zone: MRFZoneViz }) {
  const [ox, oy, oz] = zone.origin;
  const [ax, ay, az] = zone.axis;

  // Compute rotation quaternion to align cylinder (default Y-up) with zone axis
  const quaternion = useMemo(() => {
    const defaultAxis = new THREE.Vector3(0, 1, 0);
    const targetAxis = new THREE.Vector3(ax, ay, az).normalize();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(defaultAxis, targetAxis);
    return q;
  }, [ax, ay, az]);

  const euler = useMemo(() => {
    const e = new THREE.Euler();
    e.setFromQuaternion(quaternion);
    return [e.x, e.y, e.z] as [number, number, number];
  }, [quaternion]);

  return (
    <group position={[ox, oy, oz]}>
      {/* Translucent cylinder */}
      <mesh rotation={euler}>
        <cylinderGeometry args={[zone.radius, zone.radius, zone.half_length * 2, 32, 1, false]} />
        <meshStandardMaterial color="#4ade80" transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Wireframe */}
      <mesh rotation={euler}>
        <cylinderGeometry args={[zone.radius, zone.radius, zone.half_length * 2, 32, 1, false]} />
        <meshBasicMaterial color="#4ade80" wireframe transparent opacity={0.3} />
      </mesh>
      {/* Rotation axis arrow */}
      <arrowHelper
        args={[
          new THREE.Vector3(ax, ay, az).normalize(),
          new THREE.Vector3(0, 0, 0),
          zone.radius * 1.5,
          "#4ade80",
          zone.radius * 0.3,
          zone.radius * 0.15,
        ]}
      />
      {/* RPM label */}
      <Html
        position={[ax * zone.radius * 1.8, ay * zone.radius * 1.8, az * zone.radius * 1.8]}
        center
        style={{
          fontSize: 10,
          fontFamily: "var(--font-mono, monospace)",
          color: "#4ade80",
          fontWeight: 600,
          whiteSpace: "nowrap",
          userSelect: "none",
          pointerEvents: "none",
          textShadow: "0 0 4px rgba(0,0,0,0.8)",
        }}
      >
        {zone.rpm} RPM
      </Html>
    </group>
  );
}

/** Wrapper that auto-centers and scales a group of geometries loaded at original coordinates */
function MultiGeometryGroup({ children, geometryUrls }: { children: React.ReactNode; geometryUrls: string[] }) {
  const groupRef = useRef<THREE.Group>(null);
  const [fitKey, setFitKey] = useState(0);

  // When geometry URLs change, wait for meshes to load then refit
  useEffect(() => {
    // Reset transform immediately so new meshes render at real coords
    if (groupRef.current) {
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.scale.setScalar(1);
    }
    const timer = setTimeout(() => setFitKey(k => k + 1), 600);
    return () => clearTimeout(timer);
  }, [geometryUrls.join(",")]);

  // Compute bounding box and center+scale the group
  useEffect(() => {
    if (!groupRef.current) return;
    const box = new THREE.Box3().setFromObject(groupRef.current);
    if (box.isEmpty()) return;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scale = 4 / maxDim;
      groupRef.current.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      groupRef.current.scale.setScalar(scale);
    }
  }, [fitKey]);

  return <group ref={groupRef}>{children}</group>;
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

export default function MeshPreview({ caseName, refreshKey = 0, geometries, mrfZones, playing = false, onPlayToggle }: MeshPreviewProps) {
  const isMultiGeo = geometries && geometries.length > 0;
  const hasMrf = mrfZones && mrfZones.length > 0;
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"obj" | "stl" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetCount, setResetCount] = useState(0);
  const blobUrlRef = useRef<string | null>(null);

  // Single-geometry loading (skipped in multi-geo mode — each ColoredSTLModel loads itself)
  useEffect(() => {
    if (isMultiGeo) { setLoading(false); return; }

    const config = getConfig();
    let cancelled = false;

    const loadGeometry = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `${config.backendUrl}/cases/${caseName}/geometry-file`,
        );
        if (!res.ok) {
          const detail = await res.text();
          throw new Error(detail || res.statusText);
        }

        if (cancelled) return;

        const disposition = res.headers.get("content-disposition") ?? "";
        const isStl = disposition.includes(".stl") ||
          res.headers.get("content-type")?.includes("stl");

        const blob = await res.blob();
        if (cancelled) return;

        // Revoke previous blob URL before creating a new one
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);

        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setFileUrl(url);
        setFileType(isStl ? "stl" : "obj");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load geometry");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadGeometry();

    return () => { cancelled = true; };
  }, [caseName, refreshKey, isMultiGeo]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // In multi-geo mode, skip the single-file loading gates
  if (!isMultiGeo) {
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
        {isMultiGeo ? (
          <MultiGeometryGroup geometryUrls={geometries!.map(g => `${getConfig().backendUrl}/cases/${caseName}/geometry-file?filename=${g.filename}&_=${refreshKey}`)}>
            {geometries!.map((g) => {
              const url = `${getConfig().backendUrl}/cases/${caseName}/geometry-file?filename=${g.filename}&_=${refreshKey}`;
              // Find if this geometry has an associated MRF zone
              const zone = g.role === "rotating" && mrfZones
                ? mrfZones[0] // MVP: one zone
                : null;
              if (zone && playing) {
                return (
                  <AnimatedRotatingModel
                    key={g.filename}
                    url={url}
                    color={g.color}
                    origin={zone.origin}
                    axis={zone.axis}
                    rpm={zone.rpm}
                    playing={playing}
                  />
                );
              }
              return <ColoredSTLModel key={g.filename} url={url} color={g.color} />;
            })}
            {mrfZones?.map((zone) => (
              <MRFZoneCylinder key={zone.name} zone={zone} />
            ))}
          </MultiGeometryGroup>
        ) : fileType === "obj" && fileUrl ? (
          <OBJModel url={fileUrl} />
        ) : fileUrl ? (
          <STLModel url={fileUrl} />
        ) : null}
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
      {/* Toolbar buttons */}
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
        {hasMrf && onPlayToggle && (
          <button
            onClick={onPlayToggle}
            title={playing ? "Pause rotation" : "Preview rotation"}
            style={{
              background: playing ? "rgba(74,222,128,0.3)" : "rgba(30,30,30,0.8)",
              border: `1px solid ${playing ? "#4ade80" : "var(--border)"}`,
              borderRadius: 2,
              color: playing ? "#4ade80" : "var(--fg)",
              padding: "4px 6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
        )}
        <button
          onClick={() => setResetCount((c) => c + 1)}
          title="Reset camera"
          style={{
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
