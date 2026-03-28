/**
 * SceneCompositor — top-level 3D scene container for CFD visualization.
 *
 * Owns the R3F Canvas, camera, grid, and conditionally mounts all child
 * visualization components (mesh, streamlines, particles, outline, slice
 * plane, probe, lighting). Refactored from FieldMeshRenderer to use
 * shared mesh-utils and support the full VizState feature set.
 *
 * The original FieldMesh inner component and CameraReset are preserved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RotateCcw } from "lucide-react";
import { mapScalarToColor } from "../lib/colormap";
import { computeMeshTransform } from "../lib/mesh-utils";
import type { ColorMapName } from "../lib/colormap";
import type { MeshTransform } from "../lib/mesh-utils";
import type { LightingPreset as LightingPresetName, SliceAxis } from "../lib/viz-reducer";
import type { FieldData } from "../types";
import type { SliceData } from "../api";
import StreamlineRenderer from "./StreamlineRenderer";
import LightingPreset from "./LightingPreset";
import GeometryOutline from "./GeometryOutline";
import ParticleRenderer from "./ParticleRenderer";
import SlicePlaneRenderer from "./SlicePlaneRenderer";
import ProbeHandler from "./ProbeHandler";
import type { ProbeResult } from "./ProbeHandler";
import ScreenshotButton from "./ScreenshotButton";
import TooltipOverlay from "./TooltipOverlay";

// ---------------------------------------------------------------------------
// Patch visibility helpers (exported for backwards compat)
// ---------------------------------------------------------------------------

/** Default patches to show: anything ending with "Group", plus floor + symmetry plane.
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
      lower === "symmetryplane";
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

interface SceneCompositorProps {
  fieldData: FieldData | null;
  colormap?: ColorMapName;
  opacity?: number;
  showWireframe?: boolean;
  showStreamlines?: boolean;
  streamlineSeeds?: number[][];
  patchVisibility?: Record<string, boolean>;
  rangeMin?: number;
  rangeMax?: number;
  tubeScale?: number;
  streamlineOffsetX?: number;
  streamlineOffsetY?: number;
  onLoaded?: () => void;
  onError?: (error: string) => void;

  // --- New features ---
  showParticles?: boolean;
  particleCount?: number;
  showOutline?: boolean;
  lightingPreset?: LightingPresetName;
  sliceAxis?: SliceAxis | null;
  slicePosition?: number;
  sliceData?: SliceData | null;
  probeMode?: boolean;
  onProbeValue?: (result: ProbeResult) => void;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

// ---------------------------------------------------------------------------
// CameraReset — resets camera to default viewpoint
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
// FieldMesh — per-patch geometry groups (preserved from FieldMeshRenderer)
// ---------------------------------------------------------------------------

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
  meshTransform: MeshTransform;
  onLoaded?: () => void;
  onError?: (error: string) => void;
}

/** Builds per-patch Buffer geometries with shared position/color attributes. */
function FieldMesh({
  fieldData,
  colormap,
  opacity,
  showWireframe,
  patchVisibility,
  rangeMin,
  rangeMax,
  meshTransform,
  onLoaded,
  onError,
}: FieldMeshProps) {
  const patchGeometries = useMemo(() => {
    try {
      const { center, scale } = meshTransform;

      // --- shared vertex positions (transformed) ---
      const posArr = new Float32Array(fieldData.vertices.length * 3);
      for (let i = 0; i < fieldData.vertices.length; i++) {
        const v = fieldData.vertices[i];
        posArr[i * 3] = (v[0] - center[0]) * scale;
        posArr[i * 3 + 1] = (v[1] - center[1]) * scale;
        posArr[i * 3 + 2] = (v[2] - center[2]) * scale;
      }

      // --- shared vertex colors ---
      const colArr = new Float32Array(fieldData.vertices.length * 3);
      const { values } = fieldData;
      for (let i = 0; i < values.length; i++) {
        const c = mapScalarToColor(values[i], rangeMin, rangeMax, colormap);
        colArr[i * 3] = c[0];
        colArr[i * 3 + 1] = c[1];
        colArr[i * 3 + 2] = c[2];
      }

      // Shared buffer attributes
      const posAttr = new THREE.BufferAttribute(posArr, 3);
      const colAttr = new THREE.BufferAttribute(colArr, 3);

      // --- build per-patch geometries ---
      const patches: PatchGeometry[] = [];

      for (const patch of fieldData.patches) {
        const startTri = patch.startFace;
        const numTris = patch.nFaces;
        if (numTris <= 0) continue;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", posAttr);
        geo.setAttribute("color", colAttr);

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
  }, [fieldData, colormap, rangeMin, rangeMax, meshTransform, onError]);

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
// CanvasRefCapture — captures the gl.domElement for screenshot support
// ---------------------------------------------------------------------------

function CanvasRefCapture({
  canvasRef,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const { gl } = useThree();
  useEffect(() => {
    if (canvasRef && gl.domElement) {
      (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current =
        gl.domElement;
    }
  }, [canvasRef, gl.domElement]);
  return null;
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export default function SceneCompositor({
  fieldData,
  colormap = "jet",
  opacity = 1,
  showWireframe = false,
  showStreamlines = false,
  streamlineSeeds,
  patchVisibility: externalVisibility,
  rangeMin: externalRangeMin,
  rangeMax: externalRangeMax,
  tubeScale = 1,
  streamlineOffsetX = 0,
  streamlineOffsetY = 0,
  onLoaded,
  onError,
  showParticles = false,
  particleCount = 5000,
  showOutline = false,
  lightingPreset = "studio",
  sliceAxis: _sliceAxis = null,
  slicePosition: _slicePosition = 0,
  sliceData = null,
  probeMode = false,
  onProbeValue,
  canvasRef: externalCanvasRef,
}: SceneCompositorProps) {
  const [resetCount, setResetCount] = useState(0);
  const internalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = externalCanvasRef ?? internalCanvasRef;

  // Probe tooltip state (screen-space position + value)
  const [probeTooltip, setProbeTooltip] = useState<{
    value: number;
    fieldName: string;
    screenPos: { x: number; y: number };
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute patch visibility: prefer external, fallback to defaults
  const patchVisibility = useMemo(() => {
    if (externalVisibility) return externalVisibility;
    if (fieldData?.patches) return getDefaultVisiblePatches(fieldData.patches);
    return {};
  }, [externalVisibility, fieldData?.patches]);

  // Compute mesh transform using shared utility
  const meshTransform = useMemo((): MeshTransform | null => {
    if (!fieldData || fieldData.vertices.length === 0) return null;
    return computeMeshTransform(fieldData.vertices);
  }, [fieldData]);

  // Resolved range values
  const rangeMin = externalRangeMin ?? fieldData?.min ?? 0;
  const rangeMax = externalRangeMax ?? fieldData?.max ?? 1;

  // Build merged geometry for outline + probe (all visible patches combined)
  const mergedGeometry = useMemo(() => {
    if (!fieldData || !meshTransform) return null;
    if (!showOutline && !probeMode) return null;

    const { center, scale } = meshTransform;
    const numVerts = fieldData.vertices.length;

    const posArr = new Float32Array(numVerts * 3);
    for (let i = 0; i < numVerts; i++) {
      const v = fieldData.vertices[i];
      posArr[i * 3] = (v[0] - center[0]) * scale;
      posArr[i * 3 + 1] = (v[1] - center[1]) * scale;
      posArr[i * 3 + 2] = (v[2] - center[2]) * scale;
    }

    // Collect face indices from visible patches only
    const visibleIndices: number[] = [];
    for (const patch of fieldData.patches) {
      if (!(patchVisibility[patch.name] ?? false)) continue;
      for (let i = 0; i < patch.nFaces; i++) {
        const fi = patch.startFace + i;
        const f = fieldData.faces[fi];
        visibleIndices.push(f[0], f[1], f[2]);
      }
    }

    if (visibleIndices.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(visibleIndices), 1));
    geo.computeVertexNormals();

    return geo;
  }, [fieldData, meshTransform, patchVisibility, showOutline, probeMode]);

  // Handle probe values: update tooltip and forward to parent
  const handleProbeValue = useCallback(
    (result: ProbeResult) => {
      onProbeValue?.(result);

      // Compute approximate screen position for tooltip
      // We place the tooltip at a fixed offset from the probe point
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Place tooltip at center-top of the canvas as a fallback;
        // the ProbeHandler's Html overlay handles the in-scene label
        setProbeTooltip({
          value: result.value,
          fieldName: fieldData?.field ?? "",
          screenPos: { x: rect.width / 2, y: 40 },
        });
      }
    },
    [onProbeValue, fieldData?.field],
  );

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
      ref={containerRef}
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
        gl={{ preserveDrawingBuffer: true }}
        onCreated={({ camera }) => {
          camera.up.set(0, 0, 1);
          camera.lookAt(0, 0, 0);
        }}
      >
        {/* Capture the gl.domElement for screenshot support */}
        <CanvasRefCapture canvasRef={canvasRef} />

        <CameraReset resetTrigger={resetCount} />

        {/* Lighting — uses preset instead of hardcoded lights */}
        <LightingPreset preset={lightingPreset} />

        {/* Main mesh */}
        {meshTransform && (
          <FieldMesh
            fieldData={fieldData}
            colormap={colormap}
            opacity={opacity}
            showWireframe={showWireframe}
            patchVisibility={patchVisibility}
            rangeMin={rangeMin}
            rangeMax={rangeMax}
            meshTransform={meshTransform}
            onLoaded={onLoaded}
            onError={onError}
          />
        )}

        {/* Streamlines */}
        {showStreamlines &&
          fieldData.vectors &&
          streamlineSeeds &&
          meshTransform && (
            <StreamlineRenderer
              fieldData={fieldData}
              seeds={streamlineSeeds}
              colormap={colormap}
              meshTransform={meshTransform}
              tubeRadius={0.012 * tubeScale}
              offset={[streamlineOffsetX, streamlineOffsetY, 0]}
            />
          )}

        {/* Particles */}
        {showParticles && fieldData.vectors && meshTransform && (
          <ParticleRenderer
            fieldData={fieldData}
            meshTransform={meshTransform}
            colormap={colormap}
            particleCount={particleCount}
          />
        )}

        {/* Geometry outline */}
        {showOutline && mergedGeometry && (
          <GeometryOutline geometry={mergedGeometry} />
        )}

        {/* Slice plane */}
        {sliceData && meshTransform && (
          <SlicePlaneRenderer
            sliceData={sliceData}
            colormap={colormap}
            meshTransform={meshTransform}
          />
        )}

        {/* Probe handler */}
        {probeMode && mergedGeometry && (
          <ProbeHandler
            active={probeMode}
            values={fieldData.values}
            geometry={mergedGeometry}
            onProbeValue={handleProbeValue}
            fieldName={fieldData.field}
          />
        )}

        {/* Grid */}
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

      {/* Probe tooltip overlay (HTML, outside Canvas) */}
      {probeMode && probeTooltip && (
        <TooltipOverlay
          fieldName={probeTooltip.fieldName}
          value={probeTooltip.value}
          position={probeTooltip.screenPos}
        />
      )}

      {/* Toolbar: reset camera + screenshot */}
      <div
        style={{
          position: "absolute",
          top: fieldData.warning ? 32 : 8,
          right: 8,
          display: "flex",
          gap: 4,
          zIndex: 10,
        }}
      >
        <ScreenshotButton canvasRef={canvasRef} />
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

      {/* Probe mode indicator */}
      {probeMode && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            background: "rgba(30, 30, 30, 0.85)",
            color: "#ff9933",
            fontSize: 11,
            fontFamily: "monospace",
            padding: "3px 8px",
            borderRadius: 3,
            border: "1px solid rgba(255, 153, 51, 0.3)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          Probe mode: click mesh to read values
        </div>
      )}
    </div>
  );
}
