import { describe, it, expect } from 'vitest';
import {
  computeMeshTransform,
  applyMeshTransform,
  invertMeshTransform,
  type MeshTransform,
} from '../mesh-utils';

describe('computeMeshTransform', () => {
  it('returns null for an empty array', () => {
    expect(computeMeshTransform([])).toBeNull();
  });

  it('returns null for undefined-ish input', () => {
    expect(computeMeshTransform(null as unknown as number[][])).toBeNull();
  });

  it('handles a single vertex', () => {
    const result = computeMeshTransform([[3, 5, 7]]);
    expect(result).not.toBeNull();
    expect(result!.center).toEqual([3, 5, 7]);
    expect(result!.bbox.min).toEqual([3, 5, 7]);
    expect(result!.bbox.max).toEqual([3, 5, 7]);
    // maxDim is 0, so scale defaults to 1
    expect(result!.scale).toBe(1);
  });

  it('computes correct center, scale, and bbox for multiple vertices', () => {
    const vertices = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 6, 0],
      [0, 0, 4],
    ];
    const result = computeMeshTransform(vertices)!;
    expect(result.center).toEqual([5, 3, 2]);
    expect(result.bbox.min).toEqual([0, 0, 0]);
    expect(result.bbox.max).toEqual([10, 6, 4]);
    // Largest dimension is 10, so scale = 4/10 = 0.4
    expect(result.scale).toBeCloseTo(0.4);
  });

  it('maps the largest dimension to 4 units', () => {
    const vertices = [
      [-1, -2, -3],
      [1, 2, 3],
    ];
    const result = computeMeshTransform(vertices)!;
    // Largest dimension is z: 3 - (-3) = 6
    const largestDim = 6;
    expect(result.scale).toBeCloseTo(4 / largestDim);
  });
});

describe('applyMeshTransform', () => {
  const transform: MeshTransform = {
    center: [5, 3, 2],
    scale: 0.4,
    bbox: { min: [0, 0, 0], max: [10, 6, 4] },
  };

  it('correctly transforms a point', () => {
    const result = applyMeshTransform([5, 3, 2], transform);
    // Center maps to origin
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
    expect(result[2]).toBeCloseTo(0);
  });

  it('transforms the bbox max correctly', () => {
    const result = applyMeshTransform([10, 6, 4], transform);
    expect(result[0]).toBeCloseTo((10 - 5) * 0.4);
    expect(result[1]).toBeCloseTo((6 - 3) * 0.4);
    expect(result[2]).toBeCloseTo((4 - 2) * 0.4);
  });
});

describe('invertMeshTransform', () => {
  const transform: MeshTransform = {
    center: [5, 3, 2],
    scale: 0.4,
    bbox: { min: [0, 0, 0], max: [10, 6, 4] },
  };

  it('round-trips: apply then invert returns original', () => {
    const original: [number, number, number] = [7, 1, 3.5];
    const transformed = applyMeshTransform(original, transform);
    const recovered = invertMeshTransform(transformed, transform);
    expect(recovered[0]).toBeCloseTo(original[0]);
    expect(recovered[1]).toBeCloseTo(original[1]);
    expect(recovered[2]).toBeCloseTo(original[2]);
  });

  it('round-trips: invert then apply returns original', () => {
    const scene: [number, number, number] = [1.2, -0.5, 0.8];
    const original = invertMeshTransform(scene, transform);
    const back = applyMeshTransform(original, transform);
    expect(back[0]).toBeCloseTo(scene[0]);
    expect(back[1]).toBeCloseTo(scene[1]);
    expect(back[2]).toBeCloseTo(scene[2]);
  });
});
