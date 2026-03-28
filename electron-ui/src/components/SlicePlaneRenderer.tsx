/**
 * Renders a colored cross-section plane from slice data.
 *
 * Builds a BufferGeometry from the backend-provided SliceData (vertices,
 * faces, scalar values) and colors each vertex using the active colormap.
 * The geometry is transformed to match the scene's normalized coordinate
 * system via the shared MeshTransform.
 */

import { useMemo } from "react";
import * as THREE from "three";
import { mapScalarToColor } from "../lib/colormap";
import type { ColorMapName } from "../lib/colormap";
import type { MeshTransform } from "../lib/mesh-utils";
import type { SliceData } from "../api";

interface SlicePlaneRendererProps {
  sliceData: SliceData | null;
  colormap: ColorMapName;
  meshTransform: MeshTransform | null;
}

export default function SlicePlaneRenderer({
  sliceData,
  colormap,
  meshTransform,
}: SlicePlaneRendererProps) {
  const geometry = useMemo(() => {
    if (!sliceData || !meshTransform) return null;
    if (!sliceData.vertices || sliceData.vertices.length === 0) return null;
    if (!sliceData.faces || sliceData.faces.length === 0) return null;

    const numVerts = sliceData.vertices.length;
    const { center, scale } = meshTransform;

    // Build position buffer with mesh transform applied
    const posArr = new Float32Array(numVerts * 3);
    for (let i = 0; i < numVerts; i++) {
      const v = sliceData.vertices[i];
      posArr[i * 3] = (v[0] - center[0]) * scale;
      posArr[i * 3 + 1] = (v[1] - center[1]) * scale;
      posArr[i * 3 + 2] = (v[2] - center[2]) * scale;
    }

    // Build color buffer from scalar values
    const colArr = new Float32Array(numVerts * 3);
    const { values, min, max } = sliceData;
    for (let i = 0; i < numVerts; i++) {
      const val = i < values.length ? values[i] : 0;
      const c = mapScalarToColor(val, min, max, colormap);
      colArr[i * 3] = c[0];
      colArr[i * 3 + 1] = c[1];
      colArr[i * 3 + 2] = c[2];
    }

    // Build index buffer
    const numFaces = sliceData.faces.length;
    const idxArr = new Uint32Array(numFaces * 3);
    for (let i = 0; i < numFaces; i++) {
      const f = sliceData.faces[i];
      idxArr[i * 3] = f[0];
      idxArr[i * 3 + 1] = f[1];
      idxArr[i * 3 + 2] = f[2];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
    geo.computeVertexNormals();

    return geo;
  }, [sliceData, colormap, meshTransform]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={0.5}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
