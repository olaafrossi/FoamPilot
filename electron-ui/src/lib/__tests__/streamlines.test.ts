import { describe, it, expect } from 'vitest';
import {
  traceStreamlines,
  generateSeedPoints,
  computeMagnitude,
} from '../streamlines';

// ---------------------------------------------------------------------------
// Helper: build a simple planar quad mesh (two triangles) in the XY plane
// ---------------------------------------------------------------------------

/**
 * A 1x1 quad from (0,0,0) to (1,1,0) made of 2 triangles:
 *
 *   v2---v3
 *   | \ |
 *   v0---v1
 */
function makeQuadMesh() {
  const vertices = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ];
  const faces = [
    [0, 1, 2], // lower-left triangle
    [1, 3, 2], // upper-right triangle
  ];
  return { vertices, faces };
}

/**
 * A larger 2x2 quad mesh (8 triangles) for better streamline testing.
 *
 *   v6---v7---v8
 *   | \ | \ |
 *   v3---v4---v5
 *   | \ | \ |
 *   v0---v1---v2
 */
function makeLargerMesh() {
  const vertices = [
    [0, 0, 0], [1, 0, 0], [2, 0, 0],
    [0, 1, 0], [1, 1, 0], [2, 1, 0],
    [0, 2, 0], [1, 2, 0], [2, 2, 0],
  ];
  const faces = [
    [0, 1, 3], [1, 4, 3],
    [1, 2, 4], [2, 5, 4],
    [3, 4, 6], [4, 7, 6],
    [4, 5, 7], [5, 8, 7],
  ];
  return { vertices, faces };
}

describe('computeMagnitude', () => {
  it('computes 3-4-0 → 5', () => {
    const mags = computeMagnitude([[3, 4, 0]]);
    expect(mags).toHaveLength(1);
    expect(mags[0]).toBeCloseTo(5.0);
  });

  it('zero vector → 0', () => {
    const mags = computeMagnitude([[0, 0, 0]]);
    expect(mags[0]).toBeCloseTo(0);
  });

  it('handles multiple vectors', () => {
    const mags = computeMagnitude([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(mags).toHaveLength(3);
    for (const m of mags) {
      expect(m).toBeCloseTo(1.0);
    }
  });
});

describe('generateSeedPoints', () => {
  it('returns the requested count of points', () => {
    const { vertices, faces } = makeQuadMesh();
    const seeds = generateSeedPoints(vertices, faces, 10);
    expect(seeds).toHaveLength(10);
  });

  it('all points lie within the mesh bounding box', () => {
    const { vertices, faces } = makeQuadMesh();
    const seeds = generateSeedPoints(vertices, faces, 50);
    for (const p of seeds) {
      expect(p[0]).toBeGreaterThanOrEqual(0);
      expect(p[0]).toBeLessThanOrEqual(1);
      expect(p[1]).toBeGreaterThanOrEqual(0);
      expect(p[1]).toBeLessThanOrEqual(1);
      // Z should be 0 since mesh is in XY plane
      expect(p[2]).toBeCloseTo(0, 5);
    }
  });

  it('returns empty array for zero count', () => {
    const { vertices, faces } = makeQuadMesh();
    expect(generateSeedPoints(vertices, faces, 0)).toHaveLength(0);
  });

  it('returns empty array for empty mesh', () => {
    expect(generateSeedPoints([], [], 5)).toHaveLength(0);
  });

  it('is deterministic (same mesh → same points)', () => {
    const { vertices, faces } = makeQuadMesh();
    const a = generateSeedPoints(vertices, faces, 10);
    const b = generateSeedPoints(vertices, faces, 10);
    expect(a).toEqual(b);
  });
});

describe('traceStreamlines', () => {
  it('empty seeds → empty result', () => {
    const { vertices, faces } = makeQuadMesh();
    const vectors = vertices.map(() => [1, 0, 0]);
    const result = traceStreamlines(vertices, faces, vectors, []);
    expect(result).toHaveLength(0);
  });

  it('zero velocity field → single-point streamlines', () => {
    const { vertices, faces } = makeLargerMesh();
    const vectors = vertices.map(() => [0, 0, 0]);
    const seeds = [[1, 1, 0]];
    const result = traceStreamlines(vertices, faces, vectors, seeds);
    expect(result).toHaveLength(1);
    // Should terminate immediately because velocity < minVelocity
    expect(result[0].length).toBeLessThanOrEqual(2);
  });

  it('maxSteps=10 produces polylines with ≤11 points (forward only)', () => {
    const { vertices, faces } = makeLargerMesh();
    const vectors = vertices.map(() => [1, 0, 0]);
    const seeds = [[0.5, 1, 0]];
    const result = traceStreamlines(vertices, faces, vectors, seeds, {
      maxSteps: 10,
      bothDirections: false,
    });
    expect(result).toHaveLength(1);
    // seed + up to 10 steps = max 11 points
    expect(result[0].length).toBeLessThanOrEqual(11);
  });

  it('uniform flow: streamlines advance along x-axis', () => {
    const { vertices, faces } = makeLargerMesh();
    // Uniform flow in +x
    const vectors = vertices.map(() => [1, 0, 0]);
    const seeds = [[0.5, 1, 0]];
    const result = traceStreamlines(vertices, faces, vectors, seeds, {
      maxSteps: 50,
      bothDirections: false,
    });
    expect(result).toHaveLength(1);
    const line = result[0];
    expect(line.length).toBeGreaterThan(1);

    // Each successive point should have x >= previous x
    for (let i = 1; i < line.length; i++) {
      expect(line[i][0]).toBeGreaterThanOrEqual(line[i - 1][0] - 1e-9);
    }
  });

  it('single triangle mesh with uniform flow', () => {
    const vertices = [
      [0, 0, 0],
      [2, 0, 0],
      [1, 2, 0],
    ];
    const faces = [[0, 1, 2]];
    const vectors = [
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ];
    // Seed at centroid
    const seeds = [[1, 0.5, 0]];
    const result = traceStreamlines(vertices, faces, vectors, seeds, {
      maxSteps: 20,
      bothDirections: false,
    });
    expect(result).toHaveLength(1);
    expect(result[0].length).toBeGreaterThanOrEqual(1);
  });
});
