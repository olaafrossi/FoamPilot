/**
 * Shared mesh transformation utilities for CFD visualization.
 *
 * Computes bounding box, center, and uniform scale so that geometry
 * fits within a 4-unit cube — the same normalization used by
 * FieldMeshRenderer and StreamlineRenderer.
 *
 * Pure math — zero external dependencies.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Describes how to transform raw mesh coordinates into the normalized scene. */
export interface MeshTransform {
  /** Center of the bounding box in original coordinates. */
  center: [number, number, number];
  /** Uniform scale factor (maps largest bbox dimension to 4 units). */
  scale: number;
  /** Axis-aligned bounding box in original coordinates. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the bounding-box, center, and scale for a set of vertices.
 *
 * The returned `scale` maps the largest bounding-box dimension to 4 scene
 * units, matching the convention in FieldMeshRenderer (lines 126-143).
 *
 * @param vertices - Array of `[x, y, z]` coordinate triples.
 * @returns The computed transform, or `null` if the input is empty.
 */
export function computeMeshTransform(vertices: number[][]): MeshTransform | null {
  if (!vertices || vertices.length === 0) return null;

  let minX = Infinity,  minY = Infinity,  minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const x = v[0], y = v[1], z = v[2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = maxDim > 0 ? 4 / maxDim : 1;

  return {
    center: [cx, cy, cz],
    scale,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  };
}

/**
 * Apply a MeshTransform to a single point, returning the transformed coordinate.
 *
 * @param point - `[x, y, z]` in original coordinates.
 * @param transform - The MeshTransform to apply.
 * @returns Transformed `[x, y, z]`.
 */
export function applyMeshTransform(
  point: [number, number, number],
  transform: MeshTransform,
): [number, number, number] {
  const { center, scale } = transform;
  return [
    (point[0] - center[0]) * scale,
    (point[1] - center[1]) * scale,
    (point[2] - center[2]) * scale,
  ];
}

/**
 * Invert a MeshTransform on a single point, converting from scene
 * coordinates back to original coordinates.
 *
 * @param point - `[x, y, z]` in scene (transformed) coordinates.
 * @param transform - The MeshTransform to invert.
 * @returns Original `[x, y, z]`.
 */
export function invertMeshTransform(
  point: [number, number, number],
  transform: MeshTransform,
): [number, number, number] {
  const { center, scale } = transform;
  return [
    point[0] / scale + center[0],
    point[1] / scale + center[1],
    point[2] / scale + center[2],
  ];
}
