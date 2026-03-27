/**
 * Animated streamline renderer for CFD flow visualization.
 *
 * Takes field data + seed points, traces streamlines via RK4 integration,
 * and renders them as animated tubes colored by velocity magnitude.
 *
 * The animation uses a custom dash shader that creates a "flowing particles"
 * effect along each streamline path.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { traceStreamlines, computeMagnitude } from "../lib/streamlines";
import { mapScalarToColor } from "../lib/colormap";
import type { ColorMapName } from "../lib/colormap";
import type { FieldData } from "../types";
import type { MeshTransform } from "./FieldMeshRenderer";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StreamlineRendererProps {
  fieldData: FieldData;
  seeds: number[][];
  colormap: ColorMapName;
  meshTransform: MeshTransform;
  tubeRadius?: number;
}

// ---------------------------------------------------------------------------
// Animated dash material (custom ShaderMaterial)
// ---------------------------------------------------------------------------

const DASH_VERTEX = /* glsl */ `
  attribute float lineDistance;
  attribute vec3 instanceColor;
  varying float vLineDistance;
  varying vec3 vColor;

  void main() {
    vLineDistance = lineDistance;
    vColor = instanceColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DASH_FRAGMENT = /* glsl */ `
  uniform float dashSize;
  uniform float gapSize;
  uniform float time;
  uniform float speed;
  uniform float opacity;
  varying float vLineDistance;
  varying vec3 vColor;

  void main() {
    float totalSize = dashSize + gapSize;
    float offset = mod(vLineDistance - time * speed, totalSize);
    if (offset > dashSize) discard;
    // Fade at dash edges for smoother look
    float edge = smoothstep(0.0, dashSize * 0.15, offset) *
                 smoothstep(dashSize, dashSize * 0.85, offset);
    gl_FragColor = vec4(vColor, opacity * edge);
  }
`;

// ---------------------------------------------------------------------------
// Build tube geometry from a single polyline
// ---------------------------------------------------------------------------

function buildTubeFromPolyline(
  points: number[][],
  radius: number,
  segments: number,
  transform: MeshTransform,
): { positions: Float32Array; indices: Uint32Array; distances: Float32Array } | null {
  if (points.length < 2) return null;

  const { center, scale } = transform;
  const radialSegments = segments;
  const numPoints = points.length;
  const numVerts = numPoints * radialSegments;

  const positions = new Float32Array(numVerts * 3);
  const distances = new Float32Array(numVerts);
  const indices: number[] = [];

  // Compute cumulative arc-length distance
  const arcLengths = new Float32Array(numPoints);
  arcLengths[0] = 0;
  for (let i = 1; i < numPoints; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const dx = (p1[0] - p0[0]) * scale;
    const dy = (p1[1] - p0[1]) * scale;
    const dz = (p1[2] - p0[2]) * scale;
    arcLengths[i] = arcLengths[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Build tube vertices
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 1);
  const pos = new THREE.Vector3();

  for (let i = 0; i < numPoints; i++) {
    const p = points[i];
    // Transform to match mesh coordinate system
    pos.set(
      (p[0] - center[0]) * scale,
      (p[1] - center[1]) * scale,
      (p[2] - center[2]) * scale,
    );

    // Compute tangent
    if (i < numPoints - 1) {
      const pn = points[i + 1];
      tangent.set(
        (pn[0] - p[0]) * scale,
        (pn[1] - p[1]) * scale,
        (pn[2] - p[2]) * scale,
      ).normalize();
    }
    // else keep previous tangent

    // Compute normal/binormal via cross product with up
    binormal.crossVectors(tangent, up);
    if (binormal.lengthSq() < 1e-6) {
      // Tangent is parallel to up, pick arbitrary perpendicular
      binormal.crossVectors(tangent, new THREE.Vector3(1, 0, 0));
    }
    binormal.normalize();
    normal.crossVectors(binormal, tangent).normalize();

    // Generate ring of vertices
    for (let j = 0; j < radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const vi = i * radialSegments + j;
      positions[vi * 3] = pos.x + radius * (cos * normal.x + sin * binormal.x);
      positions[vi * 3 + 1] = pos.y + radius * (cos * normal.y + sin * binormal.y);
      positions[vi * 3 + 2] = pos.z + radius * (cos * normal.z + sin * binormal.z);
      distances[vi] = arcLengths[i];
    }

    // Generate indices (connect this ring to the next)
    if (i < numPoints - 1) {
      for (let j = 0; j < radialSegments; j++) {
        const a = i * radialSegments + j;
        const b = i * radialSegments + ((j + 1) % radialSegments);
        const c = (i + 1) * radialSegments + ((j + 1) % radialSegments);
        const d = (i + 1) * radialSegments + j;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }
  }

  return {
    positions,
    indices: new Uint32Array(indices),
    distances,
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StreamlineRenderer({
  fieldData,
  seeds,
  colormap,
  meshTransform,
  tubeRadius = 0.012,
}: StreamlineRendererProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Trace streamlines and build merged tube geometry (memoized)
  const geometry = useMemo(() => {
    if (!fieldData.vectors || seeds.length === 0) return null;

    // Trace streamlines through the velocity field
    const polylines = traceStreamlines(
      fieldData.vertices,
      fieldData.faces,
      fieldData.vectors,
      seeds,
      { maxSteps: 500, bothDirections: true },
    );

    if (polylines.length === 0) return null;

    // Compute velocity magnitudes for coloring
    const mags = computeMagnitude(fieldData.vectors);
    const magMin = Math.min(...mags);
    const magMax = Math.max(...mags);

    // Build tube geometry for each streamline, then merge
    const allPositions: Float32Array[] = [];
    const allIndices: Uint32Array[] = [];
    const allDistances: Float32Array[] = [];
    const allColors: Float32Array[] = [];
    let vertexOffset = 0;

    const radialSegments = 6;

    for (const polyline of polylines) {
      if (polyline.length < 2) continue;

      const tube = buildTubeFromPolyline(polyline, tubeRadius, radialSegments, meshTransform);
      if (!tube) continue;

      // Color based on average velocity magnitude along the streamline
      // Use the midpoint for a representative color
      const midIdx = Math.floor(polyline.length / 2);
      const midPt = polyline[midIdx];
      // Find nearest vertex for color lookup
      let nearestDist = Infinity;
      let nearestIdx = 0;
      for (let i = 0; i < fieldData.vertices.length; i++) {
        const v = fieldData.vertices[i];
        const dx = v[0] - midPt[0];
        const dy = v[1] - midPt[1];
        const dz = v[2] - midPt[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      const mag = mags[nearestIdx];
      const rgb = mapScalarToColor(mag, magMin, magMax, colormap);

      // Create color array for all vertices of this tube
      const numVerts = tube.positions.length / 3;
      const colors = new Float32Array(numVerts * 3);
      for (let i = 0; i < numVerts; i++) {
        colors[i * 3] = rgb[0];
        colors[i * 3 + 1] = rgb[1];
        colors[i * 3 + 2] = rgb[2];
      }

      // Offset indices
      const offsetIndices = new Uint32Array(tube.indices.length);
      for (let i = 0; i < tube.indices.length; i++) {
        offsetIndices[i] = tube.indices[i] + vertexOffset;
      }

      allPositions.push(tube.positions);
      allIndices.push(offsetIndices);
      allDistances.push(tube.distances);
      allColors.push(colors);
      vertexOffset += numVerts;
    }

    if (allPositions.length === 0) return null;

    // Merge all tube data into a single geometry
    const totalVerts = allPositions.reduce((sum, a) => sum + a.length, 0);
    const totalIdx = allIndices.reduce((sum, a) => sum + a.length, 0);

    const mergedPositions = new Float32Array(totalVerts);
    const mergedDistances = new Float32Array(totalVerts / 3);
    const mergedColors = new Float32Array(totalVerts);
    const mergedIndices = new Uint32Array(totalIdx);

    let posOffset = 0;
    let distOffset = 0;
    let idxOffset = 0;

    for (let i = 0; i < allPositions.length; i++) {
      mergedPositions.set(allPositions[i], posOffset);
      mergedDistances.set(allDistances[i], distOffset);
      mergedColors.set(allColors[i], posOffset);
      mergedIndices.set(allIndices[i], idxOffset);
      posOffset += allPositions[i].length;
      distOffset += allDistances[i].length;
      idxOffset += allIndices[i].length;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mergedPositions, 3));
    geo.setAttribute("lineDistance", new THREE.BufferAttribute(mergedDistances, 1));
    geo.setAttribute("instanceColor", new THREE.BufferAttribute(mergedColors, 3));
    geo.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
    geo.computeVertexNormals();

    return geo;
  }, [fieldData, seeds, colormap, meshTransform, tubeRadius]);

  // Animate the dash offset
  useFrame((_, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value += delta;
    }
  });

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={DASH_VERTEX}
        fragmentShader={DASH_FRAGMENT}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        uniforms={{
          dashSize: { value: 0.15 },
          gapSize: { value: 0.1 },
          time: { value: 0 },
          speed: { value: 0.8 },
          opacity: { value: 0.85 },
        }}
      />
    </mesh>
  );
}
