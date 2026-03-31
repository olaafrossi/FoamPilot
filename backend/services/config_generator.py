"""Auto-generate OpenFOAM mesh configuration from STL geometry bounds."""

from __future__ import annotations

import math
import re as _re_module
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

@dataclass
class YAxisStats:
    """Y-axis analysis for symmetry plane detection."""
    min_y: float
    max_y: float
    bbox_center: float   # (min + max) / 2
    centroid: float       # mean of all vertex Y values
    median: float         # median of all vertex Y values


def stl_y_stats(file_path: Path) -> YAxisStats:
    """Analyze the Y-axis distribution of an STL to find the symmetry plane.

    The median is the most robust estimator — it finds the Y value with
    equal amounts of surface geometry on each side, even when the bounding
    box is skewed by asymmetric features.
    """
    file_path = Path(file_path)
    raw = file_path.read_bytes()
    if _is_ascii_stl(raw):
        return _y_stats_ascii(raw.decode("utf-8", errors="replace"))
    return _y_stats_binary(raw)


def _y_stats_binary(raw: bytes) -> YAxisStats:
    if len(raw) < 84:
        raise ValueError("File too small to be a valid binary STL")
    num_triangles = struct.unpack_from("<I", raw, 80)[0]
    y_vals: list[float] = []
    offset = 84
    for _ in range(num_triangles):
        if offset + 50 > len(raw):
            break
        verts = struct.unpack_from("<9f", raw, offset + 12)
        for i in range(3):
            y_vals.append(verts[i * 3 + 1])
        offset += 50
    return _compute_y_stats(y_vals)


def _y_stats_ascii(text: str) -> YAxisStats:
    import re
    vertex_re = re.compile(
        r"^\s*vertex\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?"
        r"\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)",
        re.MULTILINE,
    )
    y_vals = [float(m.group(1)) for m in vertex_re.finditer(text)]
    return _compute_y_stats(y_vals)


def _compute_y_stats(y_vals: list[float]) -> YAxisStats:
    if not y_vals:
        return YAxisStats(0, 0, 0, 0, 0)
    y_vals_sorted = sorted(y_vals)
    n = len(y_vals_sorted)
    if n % 2 == 1:
        median = y_vals_sorted[n // 2]
    else:
        median = (y_vals_sorted[n // 2 - 1] + y_vals_sorted[n // 2]) / 2
    min_y = y_vals_sorted[0]
    max_y = y_vals_sorted[-1]
    return YAxisStats(
        min_y=min_y,
        max_y=max_y,
        bbox_center=(min_y + max_y) / 2,
        centroid=sum(y_vals) / n,
        median=median,
    )


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
# STL scaling — convert geometry to meters before meshing
# ---------------------------------------------------------------------------

# Common CAD export units → meters conversion factors
UNIT_SCALES: dict[str, float] = {
    "m": 1.0,
    "mm": 0.001,
    "cm": 0.01,
    "in": 0.0254,
    "ft": 0.3048,
}


def scale_stl(raw: bytes, factor: float) -> bytes:
    """Scale all vertex coordinates in an STL file by a uniform factor.

    Handles both binary and ASCII formats.  Normals are left unchanged
    (they are direction vectors, not positions).
    """
    if abs(factor - 1.0) < 1e-12:
        return raw
    if _is_ascii_stl(raw):
        return _scale_ascii_stl(raw, factor)
    return _scale_binary_stl(raw, factor)


def _scale_binary_stl(raw: bytes, factor: float) -> bytes:
    """Scale vertex positions in a binary STL (leave normals untouched)."""
    if len(raw) < 84:
        raise ValueError("File too small to be a valid binary STL")

    num_triangles = struct.unpack_from("<I", raw, 80)[0]
    out = bytearray(raw)
    offset = 84

    for _ in range(num_triangles):
        if offset + 50 > len(out):
            break
        # Skip normal (3 floats = 12 bytes), scale 3 vertices (9 floats)
        for i in range(9):
            pos = offset + 12 + i * 4
            val = struct.unpack_from("<f", out, pos)[0]
            struct.pack_into("<f", out, pos, val * factor)
        offset += 50

    return bytes(out)


def _scale_ascii_stl(raw: bytes, factor: float) -> bytes:
    """Scale vertex positions in an ASCII STL."""
    import re as _re

    text = raw.decode("utf-8", errors="replace")

    _vertex_re = _re.compile(
        r"(vertex\s+)"
        r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
        r"(\s+)"
        r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
        r"(\s+)"
        r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
    )

    def _repl(m: _re.Match) -> str:
        x = float(m.group(2)) * factor
        y = float(m.group(4)) * factor
        z = float(m.group(6)) * factor
        return f"{m.group(1)}{x:e}{m.group(3)}{y:e}{m.group(5)}{z:e}"

    scaled = _vertex_re.sub(_repl, text)
    return scaled.encode("utf-8")


# ---------------------------------------------------------------------------
# STL rotation / translation — align geometry to simulation axes
# ---------------------------------------------------------------------------

def _rotation_matrix(
    rx: float, ry: float, rz: float
) -> list[list[float]]:
    """Build a 3×3 rotation matrix from Euler angles (degrees) in XYZ order."""
    ax, ay, az = math.radians(rx), math.radians(ry), math.radians(rz)
    cx, sx = math.cos(ax), math.sin(ax)
    cy, sy = math.cos(ay), math.sin(ay)
    cz, sz = math.cos(az), math.sin(az)
    return [
        [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
        [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
        [-sy, sx * cy, cx * cy],
    ]


def _apply_matrix(
    m: list[list[float]], x: float, y: float, z: float
) -> tuple[float, float, float]:
    """Multiply a 3×3 matrix by a column vector."""
    return (
        m[0][0] * x + m[0][1] * y + m[0][2] * z,
        m[1][0] * x + m[1][1] * y + m[1][2] * z,
        m[2][0] * x + m[2][1] * y + m[2][2] * z,
    )


def transform_stl(
    raw: bytes,
    rotate_x: float = 0.0,
    rotate_y: float = 0.0,
    rotate_z: float = 0.0,
    translate_x: float = 0.0,
    translate_y: float = 0.0,
    translate_z: float = 0.0,
) -> bytes:
    """Rotate and translate all vertex positions and normals in an STL file.

    Rotation is applied first (in XYZ Euler order, degrees), then translation.
    Both vertices and normals are rotated; only vertices are translated.
    Handles binary and ASCII formats.
    """
    has_rotation = abs(rotate_x) > 1e-9 or abs(rotate_y) > 1e-9 or abs(rotate_z) > 1e-9
    has_translation = abs(translate_x) > 1e-9 or abs(translate_y) > 1e-9 or abs(translate_z) > 1e-9
    if not has_rotation and not has_translation:
        return raw
    rot = _rotation_matrix(rotate_x, rotate_y, rotate_z) if has_rotation else None
    tx, ty, tz = translate_x, translate_y, translate_z
    if _is_ascii_stl(raw):
        return _transform_ascii_stl(raw, rot, tx, ty, tz)
    return _transform_binary_stl(raw, rot, tx, ty, tz)


def _transform_binary_stl(
    raw: bytes,
    rot: list[list[float]] | None,
    tx: float, ty: float, tz: float,
) -> bytes:
    """Transform vertex positions and normals in a binary STL."""
    if len(raw) < 84:
        raise ValueError("File too small to be a valid binary STL")

    num_triangles = struct.unpack_from("<I", raw, 80)[0]
    out = bytearray(raw)
    offset = 84

    for _ in range(num_triangles):
        if offset + 50 > len(out):
            break
        # Rotate normal (3 floats at offset)
        if rot is not None:
            nx = struct.unpack_from("<f", out, offset)[0]
            ny = struct.unpack_from("<f", out, offset + 4)[0]
            nz = struct.unpack_from("<f", out, offset + 8)[0]
            rnx, rny, rnz = _apply_matrix(rot, nx, ny, nz)
            struct.pack_into("<f", out, offset, rnx)
            struct.pack_into("<f", out, offset + 4, rny)
            struct.pack_into("<f", out, offset + 8, rnz)

        # Transform 3 vertices (9 floats starting at offset+12)
        for v in range(3):
            base = offset + 12 + v * 12
            vx = struct.unpack_from("<f", out, base)[0]
            vy = struct.unpack_from("<f", out, base + 4)[0]
            vz = struct.unpack_from("<f", out, base + 8)[0]
            if rot is not None:
                vx, vy, vz = _apply_matrix(rot, vx, vy, vz)
            struct.pack_into("<f", out, base, vx + tx)
            struct.pack_into("<f", out, base + 4, vy + ty)
            struct.pack_into("<f", out, base + 8, vz + tz)
        offset += 50

    return bytes(out)


def _transform_ascii_stl(
    raw: bytes,
    rot: list[list[float]] | None,
    tx: float, ty: float, tz: float,
) -> bytes:
    """Transform vertex positions and normals in an ASCII STL."""
    text = raw.decode("utf-8", errors="replace")

    _normal_re = _re_module.compile(
        r"(facet\s+normal\s+)"
        r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
        r"(\s+)"
        r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
        r"(\s+)"
        r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
    )

    _vertex_re = _re_module.compile(
        r"(vertex\s+)"
        r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
        r"(\s+)"
        r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
        r"(\s+)"
        r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)"
    )

    def _repl_normal(m: _re_module.Match) -> str:
        nx, ny, nz = float(m.group(2)), float(m.group(4)), float(m.group(6))
        if rot is not None:
            nx, ny, nz = _apply_matrix(rot, nx, ny, nz)
        return f"{m.group(1)}{nx:e}{m.group(3)}{ny:e}{m.group(5)}{nz:e}"

    def _repl_vertex(m: _re_module.Match) -> str:
        vx, vy, vz = float(m.group(2)), float(m.group(4)), float(m.group(6))
        if rot is not None:
            vx, vy, vz = _apply_matrix(rot, vx, vy, vz)
        vx += tx
        vy += ty
        vz += tz
        return f"{m.group(1)}{vx:e}{m.group(3)}{vy:e}{m.group(5)}{vz:e}"

    text = _normal_re.sub(_repl_normal, text)
    text = _vertex_re.sub(_repl_vertex, text)
    return text.encode("utf-8")



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

def generate_block_mesh_dict(
    bbox: BoundingBox,
    stl_filename: str,
    domain_type: str = "ground_vehicle",
) -> str:
    """Generate blockMeshDict string sized to the geometry bounding box.

    All simulations use symmetric STL geometries (half-model), so the
    domain is built for the positive-Y half only with a symmetry
    boundary (symWall) at Y = 0.

    Domain sizing rules (ground_vehicle):
      - 5x geometry length upstream, 15x downstream (X direction)
      - Y from 0 (symmetry plane) to 4x geometry width (Y direction)
      - Height from 0 to 8x geometry height (Z direction)
      - Minimum domain of (-5, 0, 0) to (15, 4, 8)
      - ~50 cells per characteristic length

    Domain sizing rules (freestream):
      - Same X/Y extents as ground_vehicle
      - Z is symmetric: ±4x geometry height centered on geometry
      - No ground plane — all boundaries are patches
    """
    char_length = max(bbox.size_x, bbox.size_y, bbox.size_z, 0.01)

    # Domain extents
    x_min = min(bbox.min_x - 5.0 * bbox.size_x, -5.0)
    x_max = max(bbox.max_x + 15.0 * bbox.size_x, 15.0)

    # Symmetric half-domain: Y=0 is the symmetry plane
    y_min = 0.0
    y_max = max(bbox.max_y + 4.0 * bbox.size_y, 4.0)

    if domain_type == "freestream":
        # Symmetric domain: geometry floats in center
        z_min = min(bbox.min_z - 4.0 * bbox.size_z, -4.0)
        z_max = max(bbox.max_z + 4.0 * bbox.size_z, 4.0)
    else:
        # Ground vehicle: floor at z=0
        z_min = 0.0
        z_max = max(8.0 * bbox.size_z, 8.0)

    # Cell counts: ~50 cells per characteristic length
    cells_per_unit = 50.0 / char_length
    nx = max(int(math.ceil((x_max - x_min) * cells_per_unit / 10)), 20)
    ny = max(int(math.ceil((y_max - y_min) * cells_per_unit / 10)), 4)
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
    symWall
    {{
        type symmetry;
        faces
        (
            (1 5 4 0)
        );
    }}
    left
    {{
        type patch;
        faces
        (
            (3 7 6 2)
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
        type {"patch" if domain_type == "freestream" else "wall"};
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

def generate_snappy_hex_mesh_dict(
    bbox: BoundingBox,
    stl_filename: str,
    domain_type: str = "ground_vehicle",
) -> str:
    """Generate snappyHexMeshDict string for the given geometry."""
    stem = Path(stl_filename).stem  # e.g. "myPart" from "myPart.stl"
    emesh_name = f"{stem}.eMesh"

    # Refinement box: slightly larger than the geometry with wake region
    # Y starts at 0 (symmetry plane) for symmetric half-domain
    rb_min_x = bbox.min_x - 1.0 * bbox.size_x
    rb_max_x = bbox.max_x + 3.0 * bbox.size_x
    rb_min_y = 0.0
    rb_max_y = bbox.max_y + 0.5 * bbox.size_y
    if domain_type == "freestream":
        rb_min_z = bbox.min_z - 0.5 * bbox.size_z
    else:
        rb_min_z = bbox.min_z
    rb_max_z = bbox.max_z + 1.0 * bbox.size_z

    def _fmt(v: float) -> str:
        if v == 0.0:
            return "0.0"
        return f"{v:.4g}"

    # locationInMesh: a point outside the geometry, in the positive-Y half
    loc_x = bbox.max_x + 5.0 * bbox.size_x
    loc_y = max(bbox.max_y + 1.0 * bbox.size_y, 1.0)
    if domain_type == "freestream":
        loc_z = bbox.max_z + 3.0 * bbox.size_z
    else:
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


# ---------------------------------------------------------------------------
# Patch injection — ensure boundary condition files cover all blockMesh patches
# ---------------------------------------------------------------------------

# Default boundary conditions for patches that may be missing from templates.
# Keys are patch names produced by generate_block_mesh_dict; values map
# OpenFOAM field class to the BC entry text.
_PATCH_DEFAULTS: dict[str, dict[str, str]] = {
    "left": {
        "volScalarField": "        type            zeroGradient;",
        "volVectorField": "        type            zeroGradient;",
    },
    "symWall": {
        "volScalarField": "        type            symmetry;",
        "volVectorField": "        type            symmetry;",
    },
    "upperWall": {
        "volScalarField": "        type            zeroGradient;",
        "volVectorField": "        type            zeroGradient;",
    },
}

# All patches that blockMeshDict creates for ground_vehicle domain
BLOCK_MESH_PATCHES = ["symWall", "left", "inlet", "outlet", "lowerWall", "upperWall"]


def _detect_field_class(text: str) -> str:
    """Detect OpenFOAM field class from file header."""
    if "volVectorField" in text:
        return "volVectorField"
    return "volScalarField"


def ensure_patches_in_bc_files(zero_dir: Path) -> None:
    """Ensure all blockMesh patches have entries in every BC file under 0/.

    Reads each file in the 0/ directory, checks for missing patch names
    in the boundaryField block, and appends default entries for any that
    are missing.
    """
    if not zero_dir.is_dir():
        return

    for bc_file in zero_dir.iterdir():
        if not bc_file.is_file() or bc_file.name.startswith("."):
            continue
        try:
            text = bc_file.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        if "boundaryField" not in text:
            continue

        field_class = _detect_field_class(text)
        modified = False

        for patch_name in BLOCK_MESH_PATCHES:
            # Check if patch already has an entry (look for "patchName" or "patchName\n")
            # Use a simple heuristic: the patch name followed by whitespace/newline and {
            if _has_patch_entry(text, patch_name):
                continue

            # Get default BC for this patch
            defaults = _PATCH_DEFAULTS.get(patch_name)
            if not defaults:
                continue

            bc_text = defaults.get(field_class, defaults.get("volScalarField", ""))
            if not bc_text:
                continue

            # Insert before the closing } of boundaryField
            entry = f"\n    {patch_name}\n    {{\n{bc_text}\n    }}\n"
            text = _insert_before_boundary_close(text, entry)
            modified = True

        if modified:
            bc_file.write_text(text, encoding="utf-8")


def _has_patch_entry(text: str, patch_name: str) -> bool:
    """Check if a patch name appears as a dictionary entry in boundaryField."""
    import re
    # Match patch_name followed by optional whitespace and {
    pattern = rf'^\s*{re.escape(patch_name)}\s*$|^\s*{re.escape(patch_name)}\s*\{{'
    return bool(re.search(pattern, text, re.MULTILINE))


def _insert_before_boundary_close(text: str, entry: str) -> str:
    """Insert text before the closing brace of the boundaryField block."""
    # Find "boundaryField" then track brace depth to find its closing }
    idx = text.find("boundaryField")
    if idx == -1:
        return text

    # Find the opening { after boundaryField
    brace_start = text.find("{", idx)
    if brace_start == -1:
        return text

    depth = 1
    i = brace_start + 1
    while i < len(text) and depth > 0:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1

    # i is now just past the closing } of boundaryField
    # Insert before the closing }
    insert_pos = i - 1
    return text[:insert_pos] + entry + text[insert_pos:]
