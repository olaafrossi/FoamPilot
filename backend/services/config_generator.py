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


@dataclass
class GeometryEntry:
    """Represents one geometry in a multi-STL case."""
    filename: str
    bbox: BoundingBox
    role: str = "body"           # "body" | "rotating" | "zone"
    refinement_min: int = 5
    refinement_max: int = 6
    zone_name: str | None = None  # cellZone name for role="zone"


@dataclass
class MRFZoneConfig:
    """Configuration for an MRF rotation zone."""
    name: str
    origin: tuple[float, float, float]
    axis: tuple[float, float, float]
    rpm: float


def _union_bounding_box(boxes: list[BoundingBox]) -> BoundingBox:
    """Compute the union bounding box of multiple bounding boxes."""
    return BoundingBox(
        min_x=min(b.min_x for b in boxes),
        min_y=min(b.min_y for b in boxes),
        min_z=min(b.min_z for b in boxes),
        max_x=max(b.max_x for b in boxes),
        max_y=max(b.max_y for b in boxes),
        max_z=max(b.max_z for b in boxes),
        num_triangles=sum(b.num_triangles for b in boxes),
    )


def _vec_cross(
    a: tuple[float, float, float], b: tuple[float, float, float]
) -> tuple[float, float, float]:
    """Cross product of two 3D vectors."""
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _vec_normalize(v: tuple[float, float, float]) -> tuple[float, float, float]:
    """Normalize a 3D vector to unit length."""
    length = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    if length < 1e-12:
        raise ValueError("Cannot normalize zero-length vector")
    return (v[0] / length, v[1] / length, v[2] / length)


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
    geometries: list[GeometryEntry],
    domain_type: str = "ground_vehicle",
) -> str:
    """Generate blockMeshDict string sized to the union of all geometry bounding boxes.

    Domain modes:
      - half-model (default): Y from 0 (symmetry plane) to +Y, symWall at Y=0
      - full-model (auto when MRF zones present): Y extends both directions, no symmetry

    Domain sizing rules (ground_vehicle):
      - 5x geometry length upstream, 15x downstream (X direction)
      - ~50 cells per characteristic length

    Domain sizing rules (freestream):
      - Z is symmetric: ±4x geometry height centered on geometry
      - No ground plane — all boundaries are patches
    """
    bbox = _union_bounding_box([g.bbox for g in geometries])
    full_model = any(g.role == "zone" for g in geometries)

    char_length = max(bbox.size_x, bbox.size_y, bbox.size_z, 0.01)

    # Domain extents
    x_min = min(bbox.min_x - 5.0 * bbox.size_x, -5.0)
    x_max = max(bbox.max_x + 15.0 * bbox.size_x, 15.0)

    if full_model:
        # Full domain: Y extends both directions (no symmetry plane)
        y_min = min(bbox.min_y - 4.0 * bbox.size_y, -4.0)
        y_max = max(bbox.max_y + 4.0 * bbox.size_y, 4.0)
    else:
        # Symmetric half-domain: Y=0 is the symmetry plane
        y_min = 0.0
        y_max = max(bbox.max_y + 4.0 * bbox.size_y, 4.0)

    if domain_type == "freestream" or full_model:
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

    # In full-model mode, symWall becomes a regular patch ("right")
    sym_name = "right" if full_model else "symWall"
    sym_type = "patch" if full_model else "symmetry"
    lower_type = "patch" if (domain_type == "freestream" or full_model) else "wall"

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
    {sym_name}
    {{
        type {sym_type};
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
        type {lower_type};
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
    geometries: list[GeometryEntry],
    domain_type: str = "ground_vehicle",
) -> str:
    """Generate snappyHexMeshDict string for one or more geometries.

    Supports body, rotating, and zone (MRF cellZone) geometry roles.
    Zone geometries get cellZone/faceZone/cellZoneInside instead of patchInfo.
    """
    bbox = _union_bounding_box([g.bbox for g in geometries])
    full_model = any(g.role == "zone" for g in geometries)

    # Refinement box: slightly larger than the union geometry with wake region
    rb_min_x = bbox.min_x - 1.0 * bbox.size_x
    rb_max_x = bbox.max_x + 3.0 * bbox.size_x
    if full_model:
        rb_min_y = bbox.min_y - 0.5 * bbox.size_y
    else:
        rb_min_y = 0.0
    rb_max_y = bbox.max_y + 0.5 * bbox.size_y
    if domain_type == "freestream" or full_model:
        rb_min_z = bbox.min_z - 0.5 * bbox.size_z
    else:
        rb_min_z = bbox.min_z
    rb_max_z = bbox.max_z + 1.0 * bbox.size_z

    def _fmt(v: float) -> str:
        if v == 0.0:
            return "0.0"
        return f"{v:.4g}"

    # locationInMesh: a point outside all geometries
    loc_x = bbox.max_x + 5.0 * bbox.size_x
    if full_model:
        loc_y = bbox.max_y + 2.0 * bbox.size_y
    else:
        loc_y = max(bbox.max_y + 1.0 * bbox.size_y, 1.0)
    if domain_type == "freestream" or full_model:
        loc_z = bbox.max_z + 3.0 * bbox.size_z
    else:
        loc_z = bbox.center[2] if bbox.center[2] > 0.01 else 0.43

    # Build geometry section
    geometry_lines = ""
    for g in geometries:
        stem = Path(g.filename).stem
        geometry_lines += f"    {g.filename}\n"
        geometry_lines += f"    {{\n"
        geometry_lines += f"        type triSurfaceMesh;\n"
        geometry_lines += f"        name {stem};\n"
        geometry_lines += f"    }}\n\n"

    # Build features section
    features_lines = ""
    for g in geometries:
        stem = Path(g.filename).stem
        features_lines += f"        {{\n"
        features_lines += f"            file \"{stem}.eMesh\";\n"
        features_lines += f"            level {g.refinement_max};\n"
        features_lines += f"        }}\n"

    # Build refinementSurfaces section
    refinement_lines = ""
    for g in geometries:
        stem = Path(g.filename).stem
        refinement_lines += f"        {stem}\n"
        refinement_lines += f"        {{\n"
        refinement_lines += f"            level ({g.refinement_min} {g.refinement_max});\n"
        if g.role == "zone" and g.zone_name:
            refinement_lines += f"\n"
            refinement_lines += f"            cellZone {g.zone_name};\n"
            refinement_lines += f"            faceZone {g.zone_name}Faces;\n"
            refinement_lines += f"            cellZoneInside inside;\n"
        else:
            refinement_lines += f"\n"
            refinement_lines += f"            patchInfo\n"
            refinement_lines += f"            {{\n"
            refinement_lines += f"                type wall;\n"
            refinement_lines += f"                inGroups ({stem}Group);\n"
            refinement_lines += f"            }}\n"
        refinement_lines += f"        }}\n"

    # Build layer patterns (all non-zone geometries)
    layer_stems = [Path(g.filename).stem for g in geometries if g.role != "zone"]
    if layer_stems:
        layer_pattern = "|".join(layer_stems)
        layer_regex = f'"(lowerWall|{layer_pattern}).*"'
    else:
        layer_regex = '"lowerWall.*"'

    result = _foam_file_header("snappyHexMeshDict")
    result += f"""
// Which of the steps to run
castellatedMesh true;
snap            true;
addLayers       true;


geometry
{{
{geometry_lines}
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
{features_lines}    );

    refinementSurfaces
    {{
{refinement_lines}    }}

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
        {layer_regex}
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

def generate_surface_feature_extract_dict(stl_filenames: list[str]) -> str:
    """Generate surfaceFeatureExtractDict string for one or more STL files."""
    result = _foam_file_header("surfaceFeatureExtractDict")
    for filename in stl_filenames:
        result += f"""
{filename}
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
"""
    result += "\n// ************************************************************************* //\n"
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
# Cylinder STL generator — auto-generate MRF zone boundaries
# ---------------------------------------------------------------------------

def generate_cylinder_stl(
    origin: tuple[float, float, float],
    axis: tuple[float, float, float],
    radius: float,
    half_length: float,
    segments: int = 32,
) -> bytes:
    """Generate a closed binary STL cylinder for MRF zone definition.

    The cylinder is centered at ``origin``, aligned along ``axis``, with
    end caps at origin +/- half_length * axis_hat.

    Returns binary STL bytes with 4*segments triangles (2N side + N per cap).
    """
    if radius <= 0:
        raise ValueError(f"Cylinder radius must be positive, got {radius}")
    if half_length <= 0:
        raise ValueError(f"Cylinder half_length must be positive, got {half_length}")

    ax, ay, az = _vec_normalize(axis)

    # Find two perpendicular vectors to the axis
    ref = (1.0, 0.0, 0.0) if abs(ax) < 0.9 else (0.0, 1.0, 0.0)
    ux, uy, uz = _vec_normalize(_vec_cross((ax, ay, az), ref))
    vx, vy, vz = _vec_cross((ax, ay, az), (ux, uy, uz))

    ox, oy, oz = origin
    top_c = (ox + half_length * ax, oy + half_length * ay, oz + half_length * az)
    bot_c = (ox - half_length * ax, oy - half_length * ay, oz - half_length * az)

    # Generate circle vertices on top and bottom caps
    top_ring: list[tuple[float, float, float]] = []
    bot_ring: list[tuple[float, float, float]] = []
    for i in range(segments):
        angle = 2.0 * math.pi * i / segments
        ca, sa = math.cos(angle), math.sin(angle)
        dx = radius * (ca * ux + sa * vx)
        dy = radius * (ca * uy + sa * vy)
        dz = radius * (ca * uz + sa * vz)
        top_ring.append((top_c[0] + dx, top_c[1] + dy, top_c[2] + dz))
        bot_ring.append((bot_c[0] + dx, bot_c[1] + dy, bot_c[2] + dz))

    # Collect triangles as (normal, v1, v2, v3)
    triangles: list[tuple[tuple[float, float, float], ...]] = []

    for i in range(segments):
        j = (i + 1) % segments
        # Side wall: two triangles per segment
        # Triangle 1: top[i], bot[i], bot[j]
        e1 = (bot_ring[i][0] - top_ring[i][0], bot_ring[i][1] - top_ring[i][1], bot_ring[i][2] - top_ring[i][2])
        e2 = (bot_ring[j][0] - top_ring[i][0], bot_ring[j][1] - top_ring[i][1], bot_ring[j][2] - top_ring[i][2])
        n = _vec_cross(e1, e2)
        nl = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2)
        n = (n[0] / nl, n[1] / nl, n[2] / nl) if nl > 1e-12 else (0.0, 0.0, 0.0)
        triangles.append((n, top_ring[i], bot_ring[i], bot_ring[j]))

        # Triangle 2: top[i], bot[j], top[j]
        e1 = (bot_ring[j][0] - top_ring[i][0], bot_ring[j][1] - top_ring[i][1], bot_ring[j][2] - top_ring[i][2])
        e2 = (top_ring[j][0] - top_ring[i][0], top_ring[j][1] - top_ring[i][1], top_ring[j][2] - top_ring[i][2])
        n = _vec_cross(e1, e2)
        nl = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2)
        n = (n[0] / nl, n[1] / nl, n[2] / nl) if nl > 1e-12 else (0.0, 0.0, 0.0)
        triangles.append((n, top_ring[i], bot_ring[j], top_ring[j]))

        # Top cap: fan from center
        triangles.append(((ax, ay, az), top_c, top_ring[i], top_ring[j]))

        # Bottom cap: fan from center (reversed winding for outward normal)
        triangles.append(((-ax, -ay, -az), bot_c, bot_ring[j], bot_ring[i]))

    # Encode as binary STL
    num_triangles = len(triangles)
    header = b"\x00" * 80
    out = bytearray(header)
    out += struct.pack("<I", num_triangles)
    for normal, v1, v2, v3 in triangles:
        out += struct.pack("<3f", *normal)
        out += struct.pack("<3f", *v1)
        out += struct.pack("<3f", *v2)
        out += struct.pack("<3f", *v3)
        out += struct.pack("<H", 0)
    return bytes(out)


# ---------------------------------------------------------------------------
# MRFProperties generator
# ---------------------------------------------------------------------------

def generate_mrf_properties(zones: list[MRFZoneConfig]) -> str:
    """Generate constant/MRFProperties for one or more MRF rotation zones."""
    result = _foam_file_header("MRFProperties")

    for i, zone in enumerate(zones):
        omega = zone.rpm * 2.0 * math.pi / 60.0
        ax, ay, az = zone.axis
        ox, oy, oz = zone.origin
        zone_id = f"MRF{i + 1}" if len(zones) > 1 else "MRF1"

        result += f"""
{zone_id}
{{
    cellZone    {zone.name};
    active      yes;

    nonRotatingPatches ();

    origin      ({ox:g} {oy:g} {oz:g});
    axis        ({ax:g} {ay:g} {az:g});
    omega       constant {omega:.4f};  // {zone.rpm:g} RPM
}}

"""
    result += "// ************************************************************************* //\n"
    return result


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
    "right": {
        "volScalarField": "        type            zeroGradient;",
        "volVectorField": "        type            zeroGradient;",
    },
    "upperWall": {
        "volScalarField": "        type            zeroGradient;",
        "volVectorField": "        type            zeroGradient;",
    },
}

# Default BCs for geometry-derived patches (STL surfaces are walls)
_GEOMETRY_PATCH_BC = {
    "volScalarField": "        type            zeroGradient;",
    "volVectorField": "        type            noSlip;",
}

# All patches that blockMeshDict creates for ground_vehicle domain
BLOCK_MESH_PATCHES = ["symWall", "left", "inlet", "outlet", "lowerWall", "upperWall"]
# Full-model mode replaces symWall with a regular "right" patch
BLOCK_MESH_PATCHES_FULL = ["right", "left", "inlet", "outlet", "lowerWall", "upperWall"]


def _detect_field_class(text: str) -> str:
    """Detect OpenFOAM field class from file header."""
    if "volVectorField" in text:
        return "volVectorField"
    return "volScalarField"


def ensure_patches_in_bc_files(
    zero_dir: Path,
    full_model: bool = False,
    geometry_patches: list[str] | None = None,
) -> None:
    """Ensure all blockMesh and geometry patches have entries in every BC file.

    Reads each file in the 0/ directory, checks for missing patch names
    in the boundaryField block, and appends default entries for any that
    are missing.

    ``geometry_patches`` — extra patch names derived from STL filenames
    (e.g. ``["DronePropMeter", "DronePropMeterZone"]``).  These get
    wall-function BCs for turbulence fields and ``zeroGradient`` otherwise.

    When ``full_model`` is True (MRF zones present), the symmetry patch
    ``symWall`` is replaced with a regular ``right`` patch.
    """
    if not zero_dir.is_dir():
        return

    patches = BLOCK_MESH_PATCHES_FULL if full_model else BLOCK_MESH_PATCHES

    for bc_file in zero_dir.iterdir():
        if not bc_file.is_file() or bc_file.name.startswith("."):
            continue
        try:
            text = bc_file.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        if "boundaryField" not in text:
            continue

        # In full-model mode, rename symWall → right so BCs match blockMesh
        if full_model and _has_patch_entry(text, "symWall"):
            import re
            text = re.sub(
                r'(\n\s*)symWall(\s*\n\s*\{)',
                r'\1right\2',
                text,
            )
            # Also replace "type symmetry;" with "type zeroGradient;"
            # inside what was the symWall block
            text = text.replace(
                "type            symmetry;",
                "type            zeroGradient;",
            )
            bc_file.write_text(text, encoding="utf-8")

        field_class = _detect_field_class(text)
        modified = False

        for patch_name in patches:
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

        # Add wall BCs for geometry-derived patches (from STL filenames)
        for geo_patch in (geometry_patches or []):
            if _has_patch_entry(text, geo_patch):
                continue
            # Geometry surfaces are walls — use wall functions for turbulence
            bc_text = _GEOMETRY_PATCH_BC.get(field_class, "        type            zeroGradient;")
            entry = f"\n    {geo_patch}\n    {{\n{bc_text}\n    }}\n"
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
