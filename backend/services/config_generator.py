"""Auto-generate OpenFOAM mesh configuration from STL geometry bounds."""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from pathlib import Path


@dataclass
class BoundingBox:
    min_x: float
    min_y: float
    min_z: float
    max_x: float
    max_y: float
    max_z: float
    num_triangles: int

    @property
    def size_x(self) -> float:
        return self.max_x - self.min_x

    @property
    def size_y(self) -> float:
        return self.max_y - self.min_y

    @property
    def size_z(self) -> float:
        return self.max_z - self.min_z

    @property
    def center(self) -> tuple[float, float, float]:
        return (
            (self.min_x + self.max_x) / 2,
            (self.min_y + self.max_y) / 2,
            (self.min_z + self.max_z) / 2,
        )


# ---------------------------------------------------------------------------
# STL parsing
# ---------------------------------------------------------------------------

def stl_bounds(file_path: Path) -> BoundingBox:
    """Parse a binary or ASCII STL file to extract bounding box and triangle count."""
    file_path = Path(file_path)
    raw = file_path.read_bytes()

    # Detect ASCII vs binary: ASCII STL starts with "solid" followed by a name
    # and contains "facet normal" lines.  Binary STL has an 80-byte header that
    # may also start with "solid", so we check further.
    if _is_ascii_stl(raw):
        return _parse_ascii_stl(raw.decode("utf-8", errors="replace"))
    return _parse_binary_stl(raw)


def _is_ascii_stl(raw: bytes) -> bool:
    """Heuristic: ASCII STL starts with 'solid' and contains 'facet normal'."""
    if not raw[:5].lower().startswith(b"solid"):
        return False
    # Check for "facet" in the first 1 KB to distinguish from binary files
    # whose 80-byte header happens to start with "solid".
    head = raw[: min(1024, len(raw))]
    return b"facet" in head.lower()


def _parse_binary_stl(raw: bytes) -> BoundingBox:
    """Parse binary STL: 80-byte header, uint32 count, then triangles."""
    if len(raw) < 84:
        raise ValueError("File too small to be a valid binary STL")

    num_triangles = struct.unpack_from("<I", raw, 80)[0]

    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")

    offset = 84
    # Each triangle: 12 floats (normal + 3 vertices) + 2-byte attribute = 50 bytes
    for _ in range(num_triangles):
        if offset + 50 > len(raw):
            break
        # Skip normal (3 floats = 12 bytes), read 3 vertices (9 floats)
        verts = struct.unpack_from("<9f", raw, offset + 12)
        for i in range(3):
            x, y, z = verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            min_z = min(min_z, z)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
            max_z = max(max_z, z)
        offset += 50

    return BoundingBox(
        min_x=min_x, min_y=min_y, min_z=min_z,
        max_x=max_x, max_y=max_y, max_z=max_z,
        num_triangles=num_triangles,
    )


def _parse_ascii_stl(text: str) -> BoundingBox:
    """Parse ASCII STL with 'vertex x y z' lines."""
    import re

    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    num_triangles = 0

    vertex_re = re.compile(
        r"^\s*vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
        r"\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
        r"\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)",
        re.MULTILINE,
    )
    facet_re = re.compile(r"^\s*facet\s+normal", re.MULTILINE)

    num_triangles = len(facet_re.findall(text))

    for m in vertex_re.finditer(text):
        x, y, z = float(m.group(1)), float(m.group(2)), float(m.group(3))
        min_x = min(min_x, x)
        min_y = min(min_y, y)
        min_z = min(min_z, z)
        max_x = max(max_x, x)
        max_y = max(max_y, y)
        max_z = max(max_z, z)

    if num_triangles == 0:
        raise ValueError("No triangles found in ASCII STL")

    return BoundingBox(
        min_x=min_x, min_y=min_y, min_z=min_z,
        max_x=max_x, max_y=max_y, max_z=max_z,
        num_triangles=num_triangles,
    )


# ---------------------------------------------------------------------------
# OpenFOAM header
# ---------------------------------------------------------------------------

_FOAM_HEADER = """\
/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2512                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/"""


def _foam_file_header(object_name: str, class_name: str = "dictionary") -> str:
    return (
        f"{_FOAM_HEADER}\n"
        f"FoamFile\n"
        f"{{\n"
        f"    version     2.0;\n"
        f"    format      ascii;\n"
        f"    class       {class_name};\n"
        f"    object      {object_name};\n"
        f"}}\n"
        f"// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //\n"
    )


# ---------------------------------------------------------------------------
# blockMeshDict generator
# ---------------------------------------------------------------------------

def generate_block_mesh_dict(bbox: BoundingBox, stl_filename: str) -> str:
    """Generate blockMeshDict string sized to the geometry bounding box.

    Domain sizing rules:
      - 5x geometry length upstream, 15x downstream (X direction)
      - 4x geometry width on each side (Y direction)
      - Height from 0 to 8x geometry height (Z direction)
      - Minimum domain of (-5, -4, 0) to (15, 4, 8)
      - ~50 cells per characteristic length
    """
    char_length = max(bbox.size_x, bbox.size_y, bbox.size_z, 0.01)

    # Domain extents
    x_min = min(bbox.min_x - 5.0 * bbox.size_x, -5.0)
    x_max = max(bbox.max_x + 15.0 * bbox.size_x, 15.0)
    y_min = min(bbox.min_y - 4.0 * bbox.size_y, -4.0)
    y_max = max(bbox.max_y + 4.0 * bbox.size_y, 4.0)
    z_min = 0.0
    z_max = max(8.0 * bbox.size_z, 8.0)

    # Cell counts: ~50 cells per characteristic length
    cells_per_unit = 50.0 / char_length
    nx = max(int(math.ceil((x_max - x_min) * cells_per_unit / 10)), 20)
    ny = max(int(math.ceil((y_max - y_min) * cells_per_unit / 10)), 8)
    nz = max(int(math.ceil((z_max - z_min) * cells_per_unit / 10)), 8)

    def _fmt(v: float) -> str:
        """Format a float, avoiding -0."""
        if v == 0.0:
            return "0"
        return f"{v:g}"

    result = _foam_file_header("blockMeshDict")
    result += f"""
scale   1;

vertices
(
    ({_fmt(x_min)} {_fmt(y_min)} {_fmt(z_min)})
    ({_fmt(x_max)} {_fmt(y_min)} {_fmt(z_min)})
    ({_fmt(x_max)}  {_fmt(y_max)} {_fmt(z_min)})
    ({_fmt(x_min)}  {_fmt(y_max)} {_fmt(z_min)})
    ({_fmt(x_min)} {_fmt(y_min)} {_fmt(z_max)})
    ({_fmt(x_max)} {_fmt(y_min)} {_fmt(z_max)})
    ({_fmt(x_max)}  {_fmt(y_max)} {_fmt(z_max)})
    ({_fmt(x_min)}  {_fmt(y_max)} {_fmt(z_max)})
);

blocks
(
    hex (0 1 2 3 4 5 6 7) ({nx} {ny} {nz}) simpleGrading (1 1 1)
);

edges
(
);

boundary
(
    frontAndBack
    {{
        type patch;
        faces
        (
            (3 7 6 2)
            (1 5 4 0)
        );
    }}
    inlet
    {{
        type patch;
        faces
        (
            (0 4 7 3)
        );
    }}
    outlet
    {{
        type patch;
        faces
        (
            (2 6 5 1)
        );
    }}
    lowerWall
    {{
        type wall;
        faces
        (
            (0 3 2 1)
        );
    }}
    upperWall
    {{
        type patch;
        faces
        (
            (4 5 6 7)
        );
    }}
);


// ************************************************************************* //
"""
    return result


# ---------------------------------------------------------------------------
# snappyHexMeshDict generator
# ---------------------------------------------------------------------------

def generate_snappy_hex_mesh_dict(bbox: BoundingBox, stl_filename: str) -> str:
    """Generate snappyHexMeshDict string for the given geometry."""
    stem = Path(stl_filename).stem  # e.g. "myPart" from "myPart.stl"
    emesh_name = f"{stem}.eMesh"

    # Refinement box: slightly larger than the geometry with wake region
    rb_min_x = bbox.min_x - 1.0 * bbox.size_x
    rb_max_x = bbox.max_x + 3.0 * bbox.size_x
    rb_min_y = bbox.min_y - 0.5 * bbox.size_y
    rb_max_y = bbox.max_y + 0.5 * bbox.size_y
    rb_min_z = bbox.min_z
    rb_max_z = bbox.max_z + 1.0 * bbox.size_z

    def _fmt(v: float) -> str:
        if v == 0.0:
            return "0.0"
        return f"{v:.4g}"

    # locationInMesh: a point outside the geometry, near domain corner
    loc_x = bbox.max_x + 5.0 * bbox.size_x
    loc_y = bbox.max_y + 3.0 * bbox.size_y
    loc_z = bbox.center[2] if bbox.center[2] > 0.01 else 0.43

    result = _foam_file_header("snappyHexMeshDict")
    result += f"""
// Which of the steps to run
castellatedMesh true;
snap            true;
addLayers       true;


geometry
{{
    {stl_filename}
    {{
        type triSurfaceMesh;
        name {stem};
    }}

    refinementBox
    {{
        type box;
        min  ({_fmt(rb_min_x)} {_fmt(rb_min_y)} {_fmt(rb_min_z)});
        max  ({_fmt(rb_max_x)} {_fmt(rb_max_y)} {_fmt(rb_max_z)});
    }}
}}


castellatedMeshControls
{{
    maxLocalCells 100000;
    maxGlobalCells 2000000;
    minRefinementCells 10;
    maxLoadUnbalance 0.10;
    nCellsBetweenLevels 3;

    features
    (
        {{
            file "{emesh_name}";
            level 6;
        }}
    );

    refinementSurfaces
    {{
        {stem}
        {{
            level (5 6);

            patchInfo
            {{
                type wall;
                inGroups ({stem}Group);
            }}
        }}
    }}

    resolveFeatureAngle 30;

    refinementRegions
    {{
        refinementBox
        {{
            mode inside;
            levels ((1E15 4));
        }}
    }}

    locationInMesh ({_fmt(loc_x)} {_fmt(loc_y)} {_fmt(loc_z)});

    allowFreeStandingZoneFaces true;
}}


snapControls
{{
    nSmoothPatch 3;
    tolerance 2.0;
    nSolveIter 30;
    nRelaxIter 5;

    // Feature snapping
        nFeatureSnapIter 10;
        implicitFeatureSnap false;
        explicitFeatureSnap true;
        multiRegionFeatureSnap false;
}}


addLayersControls
{{
    relativeSizes true;

    layers
    {{
        "(lowerWall|{stem}).*"
        {{
            nSurfaceLayers 1;
        }}
    }}

    expansionRatio 1.0;
    finalLayerThickness 0.3;
    minThickness 0.1;
    nGrow 0;

    // Advanced settings
    featureAngle 60;
    slipFeatureAngle 30;
    nRelaxIter 3;
    nSmoothSurfaceNormals 1;
    nSmoothNormals 3;
    nSmoothThickness 10;
    maxFaceThicknessRatio 0.5;
    maxThicknessToMedialRatio 0.3;
    minMedialAxisAngle 90;
    nBufferCellsNoExtrude 0;
    nLayerIter 50;
}}


meshQualityControls
{{
    #include "meshQualityDict"

    // Advanced
    nSmoothScale 4;
    errorReduction 0.75;
}}


// Advanced

// Write flags
writeFlags
(
    scalarLevels
    layerSets
    layerFields
);


mergeTolerance 1e-6;


// ************************************************************************* //
"""
    return result


# ---------------------------------------------------------------------------
# surfaceFeatureExtractDict generator
# ---------------------------------------------------------------------------

def generate_surface_feature_extract_dict(stl_filename: str) -> str:
    """Generate surfaceFeatureExtractDict string."""
    result = _foam_file_header("surfaceFeatureExtractDict")
    result += f"""
{stl_filename}
{{
    extractionMethod    extractFromSurface;

    includedAngle       150;

    subsetFeatures
    {{
        nonManifoldEdges       no;
        openEdges       yes;
    }}

    writeObj            yes;
}}


// ************************************************************************* //
"""
    return result


def generate_decompose_par_dict(n_cores: int) -> str:
    """Generate decomposeParDict for parallel runs."""
    return f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      decomposeParDict;
}}

numberOfSubdomains  {n_cores};

method          scotch;


// ************************************************************************* //
"""
