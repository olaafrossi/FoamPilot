/**
 * Streamline tracing for 3D surface velocity fields.
 *
 * Uses 4th-order Runge-Kutta integration to trace particle paths across a
 * triangulated surface mesh. Designed for near-wall flow visualization in CFD
 * post-processing.
 *
 * Pure math — zero external dependencies.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options for streamline tracing. */
export interface StreamlineOptions {
  /** Maximum integration steps per streamline (default 500). */
  maxSteps?: number;
  /** Integration step size; auto-computed from mesh bounds if omitted. */
  stepSize?: number;
  /** Terminate when velocity magnitude drops below this (default 1e-6). */
  minVelocity?: number;
  /** Trace in both forward and backward directions (default true). */
  bothDirections?: boolean;
}

// ---------------------------------------------------------------------------
// Internal types
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

// ---------------------------------------------------------------------------
// Vector math helpers (inline for performance)
// ---------------------------------------------------------------------------

function vec3Sub(a: number[], b: number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vec3Add(a: number[], b: number[]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vec3Scale(v: number[], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function vec3Dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vec3Cross(a: number[], b: number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vec3Length(v: number[]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function vec3DistSq(a: number[], b: number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

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

function isInsideBBoxExpanded(p: number[], bbox: BBox, margin: number): boolean {
  return (
    p[0] >= bbox.min[0] - margin && p[0] <= bbox.max[0] + margin &&
    p[1] >= bbox.min[1] - margin && p[1] <= bbox.max[1] + margin &&
    p[2] >= bbox.min[2] - margin && p[2] <= bbox.max[2] + margin
  );
}

// ---------------------------------------------------------------------------
// Spatial hash grid for fast triangle lookup
// ---------------------------------------------------------------------------

function cellKey(ix: number, iy: number, iz: number): string {
  return `${ix},${iy},${iz}`;
}

function buildSpatialGrid(vertices: number[][], faces: number[][], cellSize: number, bbox: BBox): SpatialGrid {
  const cells = new Map<string, number[]>();

  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi];
    const v0 = vertices[face[0]];
    const v1 = vertices[face[1]];
    const v2 = vertices[face[2]];

    // Compute face AABB
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
// Triangle / barycentric utilities
// ---------------------------------------------------------------------------

/**
 * Compute barycentric coordinates of point `p` projected onto triangle
 * `(v0, v1, v2)`. Returns `[u, v, w]` where `p ~ u*v0 + v*v1 + w*v2`.
 * Returns null if the triangle is degenerate.
 */
function barycentricCoords(
  p: number[],
  v0: number[],
  v1: number[],
  v2: number[],
): [number, number, number] | null {
  const e0 = vec3Sub(v1, v0);
  const e1 = vec3Sub(v2, v0);
  const ep = vec3Sub(p, v0);

  const d00 = vec3Dot(e0, e0);
  const d01 = vec3Dot(e0, e1);
  const d11 = vec3Dot(e1, e1);
  const d20 = vec3Dot(ep, e0);
  const d21 = vec3Dot(ep, e1);

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-30) return null;

  const invDenom = 1.0 / denom;
  const v = (d11 * d20 - d01 * d21) * invDenom;
  const w = (d00 * d21 - d01 * d20) * invDenom;
  const u = 1.0 - v - w;

  return [u, v, w];
}

function triangleArea(v0: number[], v1: number[], v2: number[]): number {
  const cross = vec3Cross(vec3Sub(v1, v0), vec3Sub(v2, v0));
  return 0.5 * vec3Length(cross);
}

// ---------------------------------------------------------------------------
// Find enclosing triangle and interpolate velocity
// ---------------------------------------------------------------------------

const BARY_TOLERANCE = -0.05; // small negative tolerance for point-on-edge

/**
 * Find the triangle enclosing `pos` (with some tolerance) using the spatial
 * grid. Returns interpolated velocity or null if not found.
 */
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

  // Search the cell and immediate neighbours
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = cellKey(ix + dx, iy + dy, iz + dz);
        const faceList = grid.cells.get(key);
        if (!faceList) continue;

        for (const fi of faceList) {
          const face = faces[fi];
          const v0 = vertices[face[0]];
          const v1 = vertices[face[1]];
          const v2 = vertices[face[2]];

          const bary = barycentricCoords(pos, v0, v1, v2);
          if (!bary) continue;
          const [u, v, w] = bary;

          if (u >= BARY_TOLERANCE && v >= BARY_TOLERANCE && w >= BARY_TOLERANCE) {
            // Clamp barycentric coords and renormalize for interpolation
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

// ---------------------------------------------------------------------------
// RK4 integration
// ---------------------------------------------------------------------------

function rk4Step(
  pos: number[],
  stepSize: number,
  vertices: number[][],
  faces: number[][],
  vectors: number[][],
  grid: SpatialGrid,
): [number, number, number] | null {
  const k1 = interpolateVelocityAt(pos, vertices, faces, vectors, grid);
  if (!k1 || vec3Length(k1) < 1e-30) return null;

  const p2 = vec3Add(pos, vec3Scale(k1, 0.5 * stepSize));
  const k2 = interpolateVelocityAt(p2, vertices, faces, vectors, grid);
  if (!k2) return null;

  const p3 = vec3Add(pos, vec3Scale(k2, 0.5 * stepSize));
  const k3 = interpolateVelocityAt(p3, vertices, faces, vectors, grid);
  if (!k3) return null;

  const p4 = vec3Add(pos, vec3Scale(k3, stepSize));
  const k4 = interpolateVelocityAt(p4, vertices, faces, vectors, grid);
  if (!k4) return null;

  return [
    pos[0] + (stepSize / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    pos[1] + (stepSize / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    pos[2] + (stepSize / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
  ];
}

// ---------------------------------------------------------------------------
// Single direction trace
// ---------------------------------------------------------------------------

function traceDirection(
  seed: number[],
  direction: 1 | -1,
  maxSteps: number,
  stepSize: number,
  minVelocity: number,
  loopDistSq: number,
  vertices: number[][],
  faces: number[][],
  vectors: number[][],
  grid: SpatialGrid,
  bbox: BBox,
  bboxMargin: number,
): number[][] {
  const points: number[][] = [[seed[0], seed[1], seed[2]]];
  let pos = [seed[0], seed[1], seed[2]];

  const dirStep = direction * stepSize;

  for (let step = 0; step < maxSteps; step++) {
    const next = rk4Step(pos, dirStep, vertices, faces, vectors, grid);
    if (!next) break;

    // Outside bounding box?
    if (!isInsideBBoxExpanded(next, bbox, bboxMargin)) break;

    // Velocity too low?
    const vel = interpolateVelocityAt(next, vertices, faces, vectors, grid);
    if (!vel || vec3Length(vel) < minVelocity) break;

    // Loop detection: check if too close to any earlier point
    let looped = false;
    // Only check every 10th point for performance, plus the last few
    const checkStart = Math.max(0, points.length - 5);
    for (let i = checkStart; i < points.length - 1; i++) {
      if (vec3DistSq(next, points[i]) < loopDistSq) {
        looped = true;
        break;
      }
    }
    if (looped) break;

    points.push(next);
    pos = next;
  }

  return points;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Trace streamlines from seed points through a velocity field defined on a
 * triangulated surface mesh.
 *
 * @param vertices - Mesh vertex positions `[[x,y,z], ...]`
 * @param faces    - Triangle index triples `[[i,j,k], ...]`
 * @param vectors  - Velocity vector per vertex `[[vx,vy,vz], ...]`
 * @param seeds    - Seed point positions `[[x,y,z], ...]`
 * @param options  - Integration parameters
 * @returns Array of polylines, each a list of `[x,y,z]` points.
 */
export function traceStreamlines(
  vertices: number[][],
  faces: number[][],
  vectors: number[][],
  seeds: number[][],
  options?: StreamlineOptions,
): number[][][] {
  if (seeds.length === 0 || faces.length === 0 || vertices.length === 0) {
    return [];
  }

  const maxSteps = options?.maxSteps ?? 500;
  const minVelocity = options?.minVelocity ?? 1e-6;
  const bothDirections = options?.bothDirections ?? true;

  const bbox = computeBBox(vertices);
  const diag = bboxDiag(bbox);
  const stepSize = options?.stepSize ?? diag * 0.002;
  const bboxMargin = diag * 0.1;
  const loopDistSq = (stepSize * 0.5) * (stepSize * 0.5);

  // Build spatial acceleration structure
  const cellSize = Math.max(diag * 0.05, stepSize * 2);
  const grid = buildSpatialGrid(vertices, faces, cellSize, bbox);

  const result: number[][][] = [];

  for (const seed of seeds) {
    if (bothDirections) {
      // Trace backward then forward, merge into one polyline
      const backward = traceDirection(
        seed, -1, maxSteps, stepSize, minVelocity, loopDistSq,
        vertices, faces, vectors, grid, bbox, bboxMargin,
      );
      const forward = traceDirection(
        seed, 1, maxSteps, stepSize, minVelocity, loopDistSq,
        vertices, faces, vectors, grid, bbox, bboxMargin,
      );
      // backward is seed→...→backEnd, reverse it and append forward (skip duplicate seed)
      backward.reverse();
      const line = backward.concat(forward.slice(1));
      result.push(line);
    } else {
      const forward = traceDirection(
        seed, 1, maxSteps, stepSize, minVelocity, loopDistSq,
        vertices, faces, vectors, grid, bbox, bboxMargin,
      );
      result.push(forward);
    }
  }

  return result;
}

/**
 * Generate evenly-spaced seed points on the mesh surface using
 * area-weighted random sampling with deterministic seeding.
 *
 * @param vertices - Mesh vertex positions `[[x,y,z], ...]`
 * @param faces    - Triangle index triples `[[i,j,k], ...]`
 * @param count    - Desired number of seed points
 * @returns Array of `[x,y,z]` points on the surface.
 */
export function generateSeedPoints(
  vertices: number[][],
  faces: number[][],
  count: number,
): number[][] {
  if (faces.length === 0 || vertices.length === 0 || count <= 0) return [];

  // Compute cumulative area distribution
  const areas = new Float64Array(faces.length);
  let totalArea = 0;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    areas[i] = triangleArea(vertices[f[0]], vertices[f[1]], vertices[f[2]]);
    totalArea += areas[i];
  }

  if (totalArea < 1e-30) return [];

  // Build CDF
  const cdf = new Float64Array(faces.length);
  cdf[0] = areas[0] / totalArea;
  for (let i = 1; i < faces.length; i++) {
    cdf[i] = cdf[i - 1] + areas[i] / totalArea;
  }

  // Deterministic pseudo-random using a simple LCG seeded from face count
  let rngState = (faces.length * 2654435761) >>> 0;
  function nextRandom(): number {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  const seeds: number[][] = [];

  for (let s = 0; s < count; s++) {
    // Pick a face weighted by area
    const r = nextRandom();
    let fi = 0;
    for (let i = 0; i < cdf.length; i++) {
      if (r <= cdf[i]) {
        fi = i;
        break;
      }
      fi = i;
    }

    // Random barycentric point on the face
    let r1 = nextRandom();
    let r2 = nextRandom();
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    const r3 = 1 - r1 - r2;

    const f = faces[fi];
    const v0 = vertices[f[0]];
    const v1 = vertices[f[1]];
    const v2 = vertices[f[2]];

    seeds.push([
      r1 * v0[0] + r2 * v1[0] + r3 * v2[0],
      r1 * v0[1] + r2 * v1[1] + r3 * v2[1],
      r1 * v0[2] + r2 * v1[2] + r3 * v2[2],
    ]);
  }

  return seeds;
}

/**
 * Compute the velocity magnitude at each vertex.
 *
 * @param vectors - Velocity vectors `[[vx,vy,vz], ...]`
 * @returns Array of magnitudes (same length as input).
 */
export function computeMagnitude(vectors: number[][]): number[] {
  const mags = new Array<number>(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    mags[i] = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  }
  return mags;
}
