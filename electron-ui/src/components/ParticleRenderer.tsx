/**
 * GPU-instanced particle renderer for CFD flow visualization.
 *
 * Uses Three.js InstancedMesh with CPU-side Euler advection to animate
 * particles through a velocity field. Particles are colored by velocity
 * magnitude and respawn at inlet boundaries when they expire.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { computeMagnitude } from "../lib/streamlines";
import { mapScalarToColor } from "../lib/colormap";
import type { ColorMapName } from "../lib/colormap";
import type { MeshTransform } from "../lib/mesh-utils";
import type { FieldData } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ParticleRendererProps {
  fieldData: FieldData;
  meshTransform: MeshTransform;
  colormap: ColorMapName;
  particleCount?: number;
}

// ---------------------------------------------------------------------------
// Spatial hash grid (same approach as streamlines.ts)
// ---------------------------------------------------------------------------

interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

interface SpatialGrid {
  cellSize: number;
  cells: Map<string, number[]>;
  bbox: BBox;
}

function cellKey(ix: number, iy: number, iz: number): string {
  return `${ix},${iy},${iz}`;
}

function computeBBox(vertices: number[][]): BBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (v[0] < min[0]) min[0] = v[0];
    if (v[1] < min[1]) min[1] = v[1];
    if (v[2] < min[2]) min[2] = v[2];
    if (v[0] > max[0]) max[0] = v[0];
    if (v[1] > max[1]) max[1] = v[1];
    if (v[2] > max[2]) max[2] = v[2];
  }
  return { min, max };
}

function bboxDiag(bbox: BBox): number {
  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function buildSpatialGrid(
  vertices: number[][],
  faces: number[][],
  cellSize: number,
  bbox: BBox,
): SpatialGrid {
  const cells = new Map<string, number[]>();

  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi];
    const v0 = vertices[face[0]];
    const v1 = vertices[face[1]];
    const v2 = vertices[face[2]];

    const fmin = [
      Math.min(v0[0], v1[0], v2[0]),
      Math.min(v0[1], v1[1], v2[1]),
      Math.min(v0[2], v1[2], v2[2]),
    ];
    const fmax = [
      Math.max(v0[0], v1[0], v2[0]),
      Math.max(v0[1], v1[1], v2[1]),
      Math.max(v0[2], v1[2], v2[2]),
    ];

    const ixMin = Math.floor((fmin[0] - bbox.min[0]) / cellSize);
    const iyMin = Math.floor((fmin[1] - bbox.min[1]) / cellSize);
    const izMin = Math.floor((fmin[2] - bbox.min[2]) / cellSize);
    const ixMax = Math.floor((fmax[0] - bbox.min[0]) / cellSize);
    const iyMax = Math.floor((fmax[1] - bbox.min[1]) / cellSize);
    const izMax = Math.floor((fmax[2] - bbox.min[2]) / cellSize);

    for (let ix = ixMin; ix <= ixMax; ix++) {
      for (let iy = iyMin; iy <= iyMax; iy++) {
        for (let iz = izMin; iz <= izMax; iz++) {
          const key = cellKey(ix, iy, iz);
          let list = cells.get(key);
          if (!list) {
            list = [];
            cells.set(key, list);
          }
          list.push(fi);
        }
      }
    }
  }

  return { cellSize, cells, bbox };
}

// ---------------------------------------------------------------------------
// Barycentric interpolation
// ---------------------------------------------------------------------------

const BARY_TOLERANCE = -0.05;

function interpolateVelocityAt(
  pos: number[],
  vertices: number[][],
  faces: number[][],
  vectors: number[][],
  grid: SpatialGrid,
): [number, number, number] | null {
  const ix = Math.floor((pos[0] - grid.bbox.min[0]) / grid.cellSize);
  const iy = Math.floor((pos[1] - grid.bbox.min[1]) / grid.cellSize);
  const iz = Math.floor((pos[2] - grid.bbox.min[2]) / grid.cellSize);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = cellKey(ix + dx, iy + dy, iz + dz);
        const faceList = grid.cells.get(key);
        if (!faceList) continue;

        for (const fi of faceList) {
          const face = faces[fi];
          const a = vertices[face[0]];
          const b = vertices[face[1]];
          const c = vertices[face[2]];

          const bary = barycentricCoords(pos, a, b, c);
          if (!bary) continue;
          const [u, v, w] = bary;

          if (u >= BARY_TOLERANCE && v >= BARY_TOLERANCE && w >= BARY_TOLERANCE) {
            const cu = Math.max(0, u);
            const cv = Math.max(0, v);
            const cw = Math.max(0, w);
            const sum = cu + cv + cw;
            if (sum < 1e-30) continue;
            const nu = cu / sum;
            const nv = cv / sum;
            const nw = cw / sum;

            const vel0 = vectors[face[0]];
            const vel1 = vectors[face[1]];
            const vel2 = vectors[face[2]];

            return [
              nu * vel0[0] + nv * vel1[0] + nw * vel2[0],
              nu * vel0[1] + nv * vel1[1] + nw * vel2[1],
              nu * vel0[2] + nv * vel1[2] + nw * vel2[2],
            ];
          }
        }
      }
    }
  }

  return null;
}

function barycentricCoords(
  p: number[],
  v0: number[],
  v1: number[],
  v2: number[],
): [number, number, number] | null {
  const e0x = v1[0] - v0[0], e0y = v1[1] - v0[1], e0z = v1[2] - v0[2];
  const e1x = v2[0] - v0[0], e1y = v2[1] - v0[1], e1z = v2[2] - v0[2];
  const epx = p[0] - v0[0],  epy = p[1] - v0[1],  epz = p[2] - v0[2];

  const d00 = e0x * e0x + e0y * e0y + e0z * e0z;
  const d01 = e0x * e1x + e0y * e1y + e0z * e1z;
  const d11 = e1x * e1x + e1y * e1y + e1z * e1z;
  const d20 = epx * e0x + epy * e0y + epz * e0z;
  const d21 = epx * e1x + epy * e1y + epz * e1z;

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-30) return null;

  const invDenom = 1.0 / denom;
  const v = (d11 * d20 - d01 * d21) * invDenom;
  const w = (d00 * d21 - d01 * d20) * invDenom;
  const u = 1.0 - v - w;

  return [u, v, w];
}

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

/** Simple LCG pseudo-random number generator (deterministic, no allocations). */
function createLCG(seed: number) {
  let state = (seed * 2654435761) >>> 0;
  return function nextRandom(): number {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Identify inlet face indices. Looks for patches whose names contain "inlet".
 * Falls back to the first few patches if none found.
 */
function findInletFaces(
  patches: FieldData["patches"],
  totalFaces: number,
): number[] {
  const inletPatches = patches.filter((p) =>
    p.name.toLowerCase().includes("inlet"),
  );

  const sources = inletPatches.length > 0
    ? inletPatches
    : patches.slice(0, Math.min(3, patches.length));

  const indices: number[] = [];
  for (const patch of sources) {
    for (let i = 0; i < patch.nFaces; i++) {
      const fi = patch.startFace + i;
      if (fi < totalFaces) indices.push(fi);
    }
  }

  return indices;
}

/**
 * Pick a random point on the inlet boundary faces (area-weighted).
 * Writes the result into `out` array at the given offset.
 */
function sampleInletPoint(
  vertices: number[][],
  faces: number[][],
  inletFaces: number[],
  cdf: Float64Array,
  rand: () => number,
  out: Float32Array,
  offset: number,
): void {
  const r = rand();
  let idx = 0;
  for (let i = 0; i < cdf.length; i++) {
    if (r <= cdf[i]) { idx = i; break; }
    idx = i;
  }

  let r1 = rand();
  let r2 = rand();
  if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
  const r3 = 1 - r1 - r2;

  const face = faces[inletFaces[idx]];
  const v0 = vertices[face[0]];
  const v1 = vertices[face[1]];
  const v2 = vertices[face[2]];

  out[offset]     = r1 * v0[0] + r2 * v1[0] + r3 * v2[0];
  out[offset + 1] = r1 * v0[1] + r2 * v1[1] + r3 * v2[1];
  out[offset + 2] = r1 * v0[2] + r2 * v1[2] + r3 * v2[2];
}

/**
 * Build an area-weighted CDF for the given face indices.
 */
function buildInletCDF(
  vertices: number[][],
  faces: number[][],
  inletFaces: number[],
): Float64Array {
  const weights = new Float64Array(inletFaces.length);
  let total = 0;

  for (let i = 0; i < inletFaces.length; i++) {
    const face = faces[inletFaces[i]];
    const v0 = vertices[face[0]];
    const v1 = vertices[face[1]];
    const v2 = vertices[face[2]];
    // Triangle area via cross product magnitude / 2
    const ex = v1[0] - v0[0], ey = v1[1] - v0[1], ez = v1[2] - v0[2];
    const fx = v2[0] - v0[0], fy = v2[1] - v0[1], fz = v2[2] - v0[2];
    const cx = ey * fz - ez * fy;
    const cy = ez * fx - ex * fz;
    const cz = ex * fy - ey * fx;
    weights[i] = Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
    total += weights[i];
  }

  const cdf = new Float64Array(inletFaces.length);
  if (total < 1e-30) {
    // Degenerate — uniform distribution
    for (let i = 0; i < cdf.length; i++) cdf[i] = (i + 1) / cdf.length;
    return cdf;
  }
  cdf[0] = weights[0] / total;
  for (let i = 1; i < cdf.length; i++) {
    cdf[i] = cdf[i - 1] + weights[i] / total;
  }
  return cdf;
}

// ---------------------------------------------------------------------------
// Precomputed data that is memoized on fieldData
// ---------------------------------------------------------------------------

interface ParticleFieldCache {
  grid: SpatialGrid;
  bbox: BBox;
  diag: number;
  inletFaces: number[];
  inletCDF: Float64Array;
  magMin: number;
  magMax: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_AGE = 200;
const SPHERE_GEO = new THREE.SphereGeometry(0.015, 4, 4);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ParticleRenderer({
  fieldData,
  meshTransform,
  colormap,
  particleCount = 5000,
}: ParticleRendererProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Allocate a single dummy Object3D for matrix updates — never recreated
  const dummyRef = useRef<THREE.Object3D>(new THREE.Object3D());
  const rngRef = useRef<() => number>(createLCG(42));

  // Stable key for memoization
  const dataKey = `${fieldData.field}:${fieldData.time}:${fieldData.faces.length}`;

  // -----------------------------------------------------------------------
  // Build spatial hash grid & inlet data (memoized on fieldData)
  // -----------------------------------------------------------------------
  const cache = useMemo((): ParticleFieldCache | null => {
    const { vertices, faces, vectors, patches } = fieldData;
    if (!vectors || vertices.length === 0 || faces.length === 0) return null;

    const bbox = computeBBox(vertices);
    const diag = bboxDiag(bbox);
    const cellSize = Math.max(diag * 0.05, diag * 0.004);
    const grid = buildSpatialGrid(vertices, faces, cellSize, bbox);

    const inletFaces = findInletFaces(patches, faces.length);
    const inletCDF = buildInletCDF(vertices, faces, inletFaces);

    const mags = computeMagnitude(vectors);
    let magMin = Infinity;
    let magMax = -Infinity;
    for (let i = 0; i < mags.length; i++) {
      if (mags[i] < magMin) magMin = mags[i];
      if (mags[i] > magMax) magMax = mags[i];
    }

    return { grid, bbox, diag, inletFaces, inletCDF, magMin, magMax };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // -----------------------------------------------------------------------
  // Particle state arrays (memoized on particleCount + fieldData)
  // -----------------------------------------------------------------------
  const state = useMemo(() => {
    if (!cache) return null;

    // positions in world (original) coordinates — 3 floats per particle
    const positions = new Float32Array(particleCount * 3);
    const ages = new Float32Array(particleCount);

    const rand = rngRef.current;

    // Seed all particles on inlet faces
    for (let i = 0; i < particleCount; i++) {
      sampleInletPoint(
        fieldData.vertices,
        fieldData.faces,
        cache.inletFaces,
        cache.inletCDF,
        rand,
        positions,
        i * 3,
      );
      // Stagger ages so particles don't all die at once
      ages[i] = Math.floor(rand() * MAX_AGE);
    }

    return { positions, ages };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, particleCount, cache]);

  // -----------------------------------------------------------------------
  // Material (shared, created once)
  // -----------------------------------------------------------------------
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: false, // we use instanceColor instead
        toneMapped: false,
      }),
    [],
  );

  // -----------------------------------------------------------------------
  // Transformed bounding box for out-of-bounds check (scene coordinates)
  // -----------------------------------------------------------------------
  const sceneBBox = useMemo(() => {
    if (!cache) return null;
    const { center, scale } = meshTransform;
    const { bbox } = cache;
    const margin = cache.diag * 0.1; // same margin as streamlines
    return {
      min: [
        (bbox.min[0] - margin - center[0]) * scale,
        (bbox.min[1] - margin - center[1]) * scale,
        (bbox.min[2] - margin - center[2]) * scale,
      ] as [number, number, number],
      max: [
        (bbox.max[0] + margin - center[0]) * scale,
        (bbox.max[1] + margin - center[1]) * scale,
        (bbox.max[2] + margin - center[2]) * scale,
      ] as [number, number, number],
    };
  }, [cache, meshTransform]);

  // -----------------------------------------------------------------------
  // Per-frame advection loop
  // -----------------------------------------------------------------------
  useFrame((_, delta) => {
    const inst = meshRef.current;
    if (!inst || !cache || !state || !sceneBBox) return;

    const { vertices, faces, vectors } = fieldData;
    if (!vectors) return;

    const { grid, magMin, magMax, inletFaces, inletCDF } = cache;
    const { center, scale } = meshTransform;
    const { positions, ages } = state;
    const dummy = dummyRef.current;
    const rand = rngRef.current;

    // Clamp dt to avoid large jumps when tab is backgrounded
    const dt = Math.min(delta, 0.05);

    // Ensure instanceColor buffer exists
    if (!inst.instanceColor) {
      const colorArray = new Float32Array(particleCount * 3);
      inst.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
      inst.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    const colorAttr = inst.instanceColor as THREE.InstancedBufferAttribute;

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;

      // Current position in world (original) coordinates
      const wx = positions[i3];
      const wy = positions[i3 + 1];
      const wz = positions[i3 + 2];

      // Look up velocity in world coordinates
      const vel = interpolateVelocityAt(
        [wx, wy, wz],
        vertices,
        faces,
        vectors,
        grid,
      );

      let needsRespawn = false;

      if (vel) {
        // Advance position in world coordinates (Euler integration)
        positions[i3]     = wx + vel[0] * dt;
        positions[i3 + 1] = wy + vel[1] * dt;
        positions[i3 + 2] = wz + vel[2] * dt;
        ages[i] += 1;

        // Transform to scene coordinates for bounds check
        const sx = (positions[i3]     - center[0]) * scale;
        const sy = (positions[i3 + 1] - center[1]) * scale;
        const sz = (positions[i3 + 2] - center[2]) * scale;

        if (
          ages[i] > MAX_AGE ||
          sx < sceneBBox.min[0] || sx > sceneBBox.max[0] ||
          sy < sceneBBox.min[1] || sy > sceneBBox.max[1] ||
          sz < sceneBBox.min[2] || sz > sceneBBox.max[2]
        ) {
          needsRespawn = true;
        } else {
          // Update instance matrix
          dummy.position.set(sx, sy, sz);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);

          // Color by velocity magnitude
          const mag = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
          const rgb = mapScalarToColor(mag, magMin, magMax, colormap);
          colorAttr.setXYZ(i, rgb[0], rgb[1], rgb[2]);
        }
      } else {
        needsRespawn = true;
      }

      if (needsRespawn) {
        // Respawn at inlet
        sampleInletPoint(
          vertices,
          faces,
          inletFaces,
          inletCDF,
          rand,
          positions,
          i3,
        );
        ages[i] = 0;

        // Place at new position (transformed to scene coords)
        const sx = (positions[i3]     - center[0]) * scale;
        const sy = (positions[i3 + 1] - center[1]) * scale;
        const sz = (positions[i3 + 2] - center[2]) * scale;

        dummy.position.set(sx, sy, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);

        // Neutral color for newly spawned particle
        colorAttr.setXYZ(i, 0.5, 0.5, 0.5);
      }
    }

    inst.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
  });

  // -----------------------------------------------------------------------
  // Initial instance matrix setup
  // -----------------------------------------------------------------------
  const geometry = useMemo(() => SPHERE_GEO, []);

  // Set DynamicDrawUsage on mount
  const onMeshReady = useMemo(() => {
    return (mesh: THREE.InstancedMesh | null) => {
      if (!mesh) return;
      (meshRef as React.MutableRefObject<THREE.InstancedMesh | null>).current = mesh;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      // Initialize all instances at origin (will be updated in first frame)
      const dummy = dummyRef.current;
      dummy.position.set(0, 0, 0);
      dummy.updateMatrix();
      for (let i = 0; i < particleCount; i++) {
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
  }, [particleCount]);

  if (!cache || !state) return null;

  return (
    <instancedMesh
      ref={onMeshReady}
      args={[geometry, material, particleCount]}
      frustumCulled={false}
    />
  );
}
