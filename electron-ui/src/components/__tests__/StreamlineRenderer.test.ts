import { describe, it, expect } from "vitest";
import { buildTubeFromPolyline, iterativeMinMax } from "../StreamlineRenderer";
import type { MeshTransform } from "../StreamlineRenderer";

// ---------------------------------------------------------------------------
// iterativeMinMax — regression test for the Math.min(...arr) stack overflow
// ---------------------------------------------------------------------------

describe("iterativeMinMax", () => {
  it("handles empty array", () => {
    const { min, max } = iterativeMinMax([]);
    expect(min).toBe(0);
    expect(max).toBe(0);
  });

  it("handles single element", () => {
    const { min, max } = iterativeMinMax([42]);
    expect(min).toBe(42);
    expect(max).toBe(42);
  });

  it("finds min and max of small array", () => {
    const { min, max } = iterativeMinMax([3, 1, 4, 1, 5, 9, 2, 6]);
    expect(min).toBe(1);
    expect(max).toBe(9);
  });

  it("survives 100K elements without stack overflow", () => {
    // This is the exact bug — Math.min(...arr) crashes at ~10K elements
    const size = 100_000;
    const arr = new Array(size);
    for (let i = 0; i < size; i++) {
      arr[i] = Math.sin(i * 0.001); // values between -1 and 1
    }
    const { min, max } = iterativeMinMax(arr);
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
  });

  it("handles all-same values", () => {
    const { min, max } = iterativeMinMax([7, 7, 7, 7]);
    expect(min).toBe(7);
    expect(max).toBe(7);
  });

  it("handles negative values", () => {
    const { min, max } = iterativeMinMax([-5, -3, -8, -1]);
    expect(min).toBe(-8);
    expect(max).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// buildTubeFromPolyline — unit tests for the tube geometry builder
// ---------------------------------------------------------------------------

const IDENTITY_TRANSFORM: MeshTransform = { center: [0, 0, 0], scale: 1 };

describe("buildTubeFromPolyline", () => {
  it("returns null for fewer than 2 points", () => {
    expect(buildTubeFromPolyline([], 0.1, 4, IDENTITY_TRANSFORM)).toBeNull();
    expect(buildTubeFromPolyline([[0, 0, 0]], 0.1, 4, IDENTITY_TRANSFORM)).toBeNull();
  });

  it("produces valid geometry for a 3-point polyline", () => {
    const points = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ];
    const result = buildTubeFromPolyline(points, 0.1, 4, IDENTITY_TRANSFORM);
    expect(result).not.toBeNull();

    const { positions, indices, distances } = result!;

    // 3 points × 4 radial segments = 12 vertices
    expect(positions.length).toBe(12 * 3); // 12 verts × 3 components
    expect(distances.length).toBe(12);

    // 2 segments × 4 radial × 2 triangles × 3 indices = 48 indices
    expect(indices.length).toBe(48);
  });

  it("distances increase monotonically along the polyline", () => {
    const points = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ];
    const radialSegments = 4;
    const result = buildTubeFromPolyline(points, 0.1, radialSegments, IDENTITY_TRANSFORM);
    expect(result).not.toBeNull();

    // Check that ring distances increase: ring 0 < ring 1 < ring 2 < ring 3
    const { distances } = result!;
    for (let i = 1; i < points.length; i++) {
      const prevRingDist = distances[(i - 1) * radialSegments];
      const currRingDist = distances[i * radialSegments];
      expect(currRingDist).toBeGreaterThan(prevRingDist);
    }
  });

  it("applies mesh transform (center + scale)", () => {
    const points = [
      [10, 10, 10],
      [11, 10, 10],
    ];
    const transform: MeshTransform = { center: [10, 10, 10], scale: 2 };
    const result = buildTubeFromPolyline(points, 0.1, 4, transform);
    expect(result).not.toBeNull();

    // First ring should be near origin (centered), second ring near x=2 (scaled)
    const { positions } = result!;
    // Average x of first ring vertices (indices 0..3)
    let avgX0 = 0;
    for (let j = 0; j < 4; j++) {
      avgX0 += positions[j * 3];
    }
    avgX0 /= 4;
    expect(avgX0).toBeCloseTo(0, 0); // centered at origin

    // Average x of second ring vertices (indices 4..7)
    let avgX1 = 0;
    for (let j = 4; j < 8; j++) {
      avgX1 += positions[j * 3];
    }
    avgX1 /= 4;
    expect(avgX1).toBeCloseTo(2, 0); // (11-10)*2 = 2
  });

  it("all indices are within vertex bounds", () => {
    const points = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
    ];
    const radialSegments = 6;
    const result = buildTubeFromPolyline(points, 0.05, radialSegments, IDENTITY_TRANSFORM);
    expect(result).not.toBeNull();

    const { positions, indices } = result!;
    const vertexCount = positions.length / 3;
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(0);
      expect(indices[i]).toBeLessThan(vertexCount);
    }
  });
});
