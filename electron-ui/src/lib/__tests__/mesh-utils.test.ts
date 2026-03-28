import { describe, it, expect } from 'vitest';
import {
  computeMeshTransform,
  applyMeshTransform,
  invertMeshTransform,
  type MeshTransform,
} from '../mesh-utils';

describe('computeMeshTransform', () => {
  it('returns null for empty array', () => {
    expect(computeMeshTransform([])).toBeNull();
  });

  it('returns null for undefined-ish input', () => {
    expect(computeMeshTransform(null as unknown as number[][])).toBeNull();
  });

  it('handles a single vertex', () => {
    const result = computeMeshTransform([[3, 5, 7]]);
    expect(result).not.toBeNull();
    expect(result!.center).toEqual([3, 5, 7]);
    // maxDim is 0, so scale should be 1
    expect(result!.scale).toBe(1);
    expect(result!.bbox.min).toEqual([3, 5, 7]);
    expect(result!.bbox.max).toEqual([3, 5, 7]);
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
    // largest dimension is 10, scale = 4/10 = 0.4
    expect(result.scale).toBeCloseTo(0.4);
  });

  it('maps the largest dimension to 4 units', () => {
    const vertices = [
      [-1, -2, -3],
      [1, 2, 3],
    ];
    const result = computeMeshTransform(vertices)!;
    // largest dimension is z: 6, so scale = 4/6
    const largestDim = 6;
    expect(result.scale).toBeCloseTo(4 / largestDim);
    // Transformed extent along z should be 6 * (4/6) = 4
    const transformedExtent = largestDim * result.scale;
    expect(transformedExtent).toBeCloseTo(4);
  });
});

describe('applyMeshTransform', () => {
  it('correctly transforms a point', () => {
    const transform: MeshTransform = {
      center: [5, 3, 2],
      scale: 0.4,
      bbox: { min: [0, 0, 0], max: [10, 6, 4] },
    };
    const result = applyMeshTransform([10, 3, 2], transform);
    // (10-5)*0.4 = 2, (3-3)*0.4 = 0, (2-2)*0.4 = 0
    expect(result[0]).toBeCloseTo(2);
    expect(result[1]).toBeCloseTo(0);
    expect(result[2]).toBeCloseTo(0);
  });
});

describe('invertMeshTransform', () => {
  it('round-trips: apply then invert returns original point', () => {
    const vertices = [
      [0, 0, 0],
      [10, 6, 4],
    ];
    const transform = computeMeshTransform(vertices)!;
    const original: [number, number, number] = [7, 2, 3];
    const transformed = applyMeshTransform(original, transform);
    const recovered = invertMeshTransform(transformed, transform);
    expect(recovered[0]).toBeCloseTo(original[0]);
    expect(recovered[1]).toBeCloseTo(original[1]);
    expect(recovered[2]).toBeCloseTo(original[2]);
  });

  it('round-trips with negative coordinates', () => {
    const vertices = [
      [-100, -50, -25],
      [100, 50, 25],
    ];
    const transform = computeMeshTransform(vertices)!;
    const original: [number, number, number] = [-37, 12, 8];
    const transformed = applyMeshTransform(original, transform);
    const recovered = invertMeshTransform(transformed, transform);
    expect(recovered[0]).toBeCloseTo(original[0]);
    expect(recovered[1]).toBeCloseTo(original[1]);
    expect(recovered[2]).toBeCloseTo(original[2]);
  });
});
