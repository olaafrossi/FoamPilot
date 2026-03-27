"""Parse OpenFOAM polyMesh and field files for 3D visualization."""

from __future__ import annotations

import re
import struct
from pathlib import Path
from typing import Any

import numpy as np


# ---------------------------------------------------------------------------
# FoamFile header helpers
# ---------------------------------------------------------------------------

_HEADER_RE = re.compile(
    r"FoamFile\s*\{(.*?)\}",
    re.DOTALL,
)

_KV_RE = re.compile(r"(\w+)\s+(.*?);")


def _parse_foam_header(text: str) -> dict[str, str]:
    """Extract key-value pairs from a FoamFile header block."""
    m = _HEADER_RE.search(text)
    if not m:
        return {}
    block = m.group(1)
    return {k: v.strip() for k, v in _KV_RE.findall(block)}


def _is_binary(header: dict[str, str]) -> bool:
    """Return True if the file format is binary."""
    return header.get("format", "ascii").lower() == "binary"


def _strip_comments(text: str) -> str:
    """Remove C++ style // line comments and /* block comments */."""
    text = re.sub(r"//[^\n]*", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return text


# ---------------------------------------------------------------------------
# polyMesh: points
# ---------------------------------------------------------------------------


def parse_points(case_dir: str | Path) -> np.ndarray:
    """Parse constant/polyMesh/points and return an (N, 3) float64 array.

    Supports both ASCII and binary formats.  Binary layout (after the count
    and opening ``(``): N * 3 little-endian float64 values.
    """
    path = Path(case_dir) / "constant" / "polyMesh" / "points"
    if not path.is_file():
        raise FileNotFoundError(f"Points file not found: {path}")

    raw_bytes = path.read_bytes()
    text = raw_bytes.decode("utf-8", errors="replace")
    header = _parse_foam_header(text)
    clean = _strip_comments(text)

    # Find the header to skip it
    header_end = 0
    hm = _HEADER_RE.search(clean)
    if hm:
        header_end = hm.end()

    body = clean[header_end:]

    # Find count then the parenthesised block
    count_match = re.search(r"(\d+)\s*\(", body)
    if not count_match:
        raise ValueError("Cannot find point count in points file")

    n_points = int(count_match.group(1))

    if _is_binary(header):
        # Binary: find the '(' in raw bytes, then read N*3 doubles
        # Use the text position of '(' to locate it in raw bytes
        text_paren_pos = body.index("(", count_match.start())
        # Map back to position in full text
        full_text_pos = header_end + text_paren_pos
        # Find the matching byte position (scan forward from approximate spot)
        byte_start = raw_bytes.index(b"(", max(0, full_text_pos - 50)) + 1
        # Skip whitespace/newline
        while byte_start < len(raw_bytes) and raw_bytes[byte_start] in (
            ord("\n"), ord("\r"), ord(" "),
        ):
            byte_start += 1

        n_doubles = n_points * 3
        expected_bytes = n_doubles * 8
        data = struct.unpack(
            f"<{n_doubles}d",
            raw_bytes[byte_start : byte_start + expected_bytes],
        )
        return np.array(data, dtype=np.float64).reshape(n_points, 3)

    # ASCII: parse each (x y z) tuple
    block_start = body.index("(", count_match.start()) + 1
    block_end = body.rindex(")")
    block = body[block_start:block_end]

    coords = re.findall(r"\(\s*([^\)]+)\)", block)
    if len(coords) < n_points:
        raise ValueError(
            f"Expected {n_points} points but found {len(coords)} coordinate tuples"
        )

    points = np.empty((n_points, 3), dtype=np.float64)
    for i, c in enumerate(coords[:n_points]):
        parts = c.split()
        points[i] = [float(parts[0]), float(parts[1]), float(parts[2])]

    return points


# ---------------------------------------------------------------------------
# polyMesh: faces
# ---------------------------------------------------------------------------


def parse_faces(case_dir: str | Path) -> list[list[int]]:
    """Parse constant/polyMesh/faces and return a list of face vertex-index lists.

    Each face is represented as [v0, v1, v2, ...].

    Supports both ASCII format and binary ``faceCompactList`` format.
    Binary compact list layout (``label=32``):
      - (N+1) int32 offsets
      - followed by a flat int32 array of all vertex indices
    """
    path = Path(case_dir) / "constant" / "polyMesh" / "faces"
    if not path.is_file():
        raise FileNotFoundError(f"Faces file not found: {path}")

    raw_bytes = path.read_bytes()
    text = raw_bytes.decode("utf-8", errors="replace")
    header = _parse_foam_header(text)
    clean = _strip_comments(text)

    header_end = 0
    hm = _HEADER_RE.search(clean)
    if hm:
        header_end = hm.end()

    body = clean[header_end:]

    # Determine label size from arch header (default 32-bit)
    arch = header.get("arch", "")
    label_size = 64 if "label=64" in arch else 32
    label_fmt = "<q" if label_size == 64 else "<i"
    label_bytes = 8 if label_size == 64 else 4

    if _is_binary(header) and "compact" in header.get("class", "").lower():
        # Binary faceCompactList format:
        #   First block: (N+1) offsets as int32/int64
        #   Second block: flat vertex indices as int32/int64
        #
        # The file has two count+( sections:
        #   <nFaces+1>\n(\n<binary offsets>\n)\n\n<nLabels>\n(\n<binary labels>\n)

        # Find the first count (nFaces is in the text before first '(')
        count_match = re.search(r"(\d+)\s*\(", body)
        if not count_match:
            raise ValueError("Cannot find face count in faces file")

        n_entries = int(count_match.group(1))  # This is N+1 for offsets

        # Find the '(' for offsets block in raw bytes
        text_paren_pos = body.index("(", count_match.start())
        full_text_pos = header_end + text_paren_pos
        byte_start = raw_bytes.index(b"(", max(0, full_text_pos - 50)) + 1
        while byte_start < len(raw_bytes) and raw_bytes[byte_start] in (
            ord("\n"), ord("\r"), ord(" "),
        ):
            byte_start += 1

        # Read offsets
        offsets_bytes = n_entries * label_bytes
        offsets = struct.unpack(
            f"<{n_entries}{label_fmt[-1]}",
            raw_bytes[byte_start : byte_start + offsets_bytes],
        )
        n_faces = n_entries - 1  # offsets has N+1 entries

        # Skip past the offsets block and closing ')'
        after_offsets = byte_start + offsets_bytes
        # Find the ')' closing the offsets block
        close_paren = raw_bytes.index(b")", after_offsets)
        # Find the next count + '(' for the labels block
        rest_text = raw_bytes[close_paren:].decode("utf-8", errors="replace")
        labels_count_match = re.search(r"(\d+)\s*\(", rest_text)
        if not labels_count_match:
            raise ValueError("Cannot find labels block in binary faceCompactList")

        n_labels = int(labels_count_match.group(1))
        labels_paren_pos = close_paren + rest_text.index("(", labels_count_match.start()) + 1
        # Skip whitespace
        while labels_paren_pos < len(raw_bytes) and raw_bytes[labels_paren_pos] in (
            ord("\n"), ord("\r"), ord(" "),
        ):
            labels_paren_pos += 1

        # Read all vertex labels
        labels_data_bytes = n_labels * label_bytes
        labels = struct.unpack(
            f"<{n_labels}{label_fmt[-1]}",
            raw_bytes[labels_paren_pos : labels_paren_pos + labels_data_bytes],
        )

        # Build face lists from offsets + labels
        faces: list[list[int]] = []
        for i in range(n_faces):
            start = offsets[i]
            end = offsets[i + 1]
            faces.append(list(labels[start:end]))

        return faces

    elif _is_binary(header):
        # Binary non-compact faceList: each face stored as
        # int32 nVerts followed by nVerts int32 vertex indices
        count_match = re.search(r"(\d+)\s*\(", body)
        if not count_match:
            raise ValueError("Cannot find face count in faces file")

        n_faces = int(count_match.group(1))
        text_paren_pos = body.index("(", count_match.start())
        full_text_pos = header_end + text_paren_pos
        byte_start = raw_bytes.index(b"(", max(0, full_text_pos - 50)) + 1
        while byte_start < len(raw_bytes) and raw_bytes[byte_start] in (
            ord("\n"), ord("\r"), ord(" "),
        ):
            byte_start += 1

        faces = []
        pos = byte_start
        for _ in range(n_faces):
            n_verts = struct.unpack(label_fmt, raw_bytes[pos : pos + label_bytes])[0]
            pos += label_bytes
            verts = struct.unpack(
                f"<{n_verts}{label_fmt[-1]}",
                raw_bytes[pos : pos + n_verts * label_bytes],
            )
            pos += n_verts * label_bytes
            faces.append(list(verts))

        return faces

    # ASCII format
    count_match = re.search(r"(\d+)\s*\(", body)
    if not count_match:
        raise ValueError("Cannot find face count in faces file")

    n_faces = int(count_match.group(1))
    block_start = body.index("(", count_match.start()) + 1
    block_end = body.rindex(")")
    block = body[block_start:block_end]

    face_pattern = re.compile(r"(\d+)\s*\(([^)]+)\)")
    matches = face_pattern.findall(block)

    faces = []
    for _n_verts, verts_str in matches[:n_faces]:
        verts = [int(v) for v in verts_str.split()]
        faces.append(verts)

    if len(faces) < n_faces:
        raise ValueError(
            f"Expected {n_faces} faces but parsed {len(faces)}"
        )

    return faces


# ---------------------------------------------------------------------------
# polyMesh: boundary
# ---------------------------------------------------------------------------


def parse_boundary(case_dir: str | Path) -> list[dict[str, Any]]:
    """Parse constant/polyMesh/boundary and return a list of patch dicts.

    Each dict has keys: name, type, nFaces, startFace.
    """
    path = Path(case_dir) / "constant" / "polyMesh" / "boundary"
    if not path.is_file():
        raise FileNotFoundError(f"Boundary file not found: {path}")

    raw = path.read_text(encoding="utf-8", errors="replace")
    clean = _strip_comments(raw)

    header_end = 0
    hm = _HEADER_RE.search(clean)
    if hm:
        header_end = hm.end()

    body = clean[header_end:]

    # Find the patch count then the outer parens
    count_match = re.search(r"(\d+)\s*\(", body)
    if not count_match:
        raise ValueError("Cannot find patch count in boundary file")

    block_start = body.index("(", count_match.start()) + 1
    block_end = body.rindex(")")
    block = body[block_start:block_end]

    # Parse each patch block:  patchName { type ...; nFaces N; startFace N; }
    patch_pattern = re.compile(
        r"(\w+)\s*\{([^}]+)\}",
        re.DOTALL,
    )
    patches: list[dict[str, Any]] = []
    for name, contents in patch_pattern.findall(block):
        kvs = {k: v.strip() for k, v in _KV_RE.findall(contents)}
        patches.append(
            {
                "name": name,
                "type": kvs.get("type", "patch"),
                "nFaces": int(kvs.get("nFaces", 0)),
                "startFace": int(kvs.get("startFace", 0)),
            }
        )

    return patches


# ---------------------------------------------------------------------------
# Time directory discovery
# ---------------------------------------------------------------------------

_NUMERIC_DIR_RE = re.compile(r"^-?\d+\.?\d*(?:[eE][+-]?\d+)?$")


def discover_time_directories(case_dir: str | Path) -> list[str]:
    """Return sorted list of numeric time-directory names in the case.

    Excludes '0' (initial conditions) unless it is the only directory.
    Sorts numerically.
    """
    case_path = Path(case_dir)
    if not case_path.is_dir():
        return []

    times: list[str] = []
    for entry in case_path.iterdir():
        if entry.is_dir() and _NUMERIC_DIR_RE.match(entry.name):
            times.append(entry.name)

    # Sort numerically
    times.sort(key=lambda t: float(t))
    return times


def discover_available_fields(case_dir: str | Path, time_dir: str) -> list[str]:
    """List field file names (e.g., p, U, k) in a given time directory."""
    td = Path(case_dir) / time_dir
    if not td.is_dir():
        return []

    fields: list[str] = []
    for entry in td.iterdir():
        if entry.is_file() and not entry.name.startswith("."):
            # Quick check: does it look like an OpenFOAM field file?
            # Skip known non-field files
            if entry.name in ("cellLevel", "pointLevel", "meshPhi"):
                continue
            fields.append(entry.name)

    return sorted(fields)


def resolve_time(case_dir: str | Path, time: str) -> str:
    """Resolve 'latest' to the highest numeric time dir, or validate a specific time.

    Raises FileNotFoundError if no matching time directory exists.
    """
    times = discover_time_directories(case_dir)
    if not times:
        raise FileNotFoundError(
            f"No time directories found in case: {case_dir}"
        )

    if time == "latest":
        return times[-1]

    if time in times:
        return time

    raise FileNotFoundError(
        f"Time directory '{time}' not found. Available: {times}"
    )


# ---------------------------------------------------------------------------
# Field file parsing (scalar / vector, ASCII / binary)
# ---------------------------------------------------------------------------


def _read_field_file(file_path: Path) -> tuple[dict[str, str], str, bytes]:
    """Read a field file and return (header_dict, text_after_header, raw_bytes).

    The raw_bytes is the full file content (needed for binary parsing).
    """
    raw_bytes = file_path.read_bytes()
    text = raw_bytes.decode("utf-8", errors="replace")
    header = _parse_foam_header(text)
    return header, text, raw_bytes


def _parse_internal_field_ascii(text: str) -> tuple[str, np.ndarray]:
    """Parse the internalField from ASCII text.

    Returns (field_type, values) where field_type is 'uniform_scalar',
    'uniform_vector', 'nonuniform_scalar', or 'nonuniform_vector'.
    """
    clean = _strip_comments(text)

    # Try uniform scalar: internalField uniform <value>;
    m = re.search(
        r"internalField\s+uniform\s+([-+]?[\d.eE+-]+)\s*;",
        clean,
    )
    if m:
        val = float(m.group(1))
        return "uniform_scalar", np.array([val], dtype=np.float64)

    # Try uniform vector: internalField uniform (vx vy vz);
    m = re.search(
        r"internalField\s+uniform\s+\(\s*([-+\d.eE\s]+)\s*\)\s*;",
        clean,
    )
    if m:
        parts = m.group(1).split()
        vec = [float(x) for x in parts]
        return "uniform_vector", np.array([vec], dtype=np.float64)

    # Try nonuniform List<scalar>
    m = re.search(
        r"internalField\s+nonuniform\s+List<scalar>\s*(\d+)\s*\(",
        clean,
    )
    if m:
        n = int(m.group(1))
        start = m.end()
        # Find the closing paren
        end = clean.index(")", start)
        block = clean[start:end]
        vals = [float(x) for x in block.split()]
        return "nonuniform_scalar", np.array(vals[:n], dtype=np.float64)

    # Try nonuniform List<vector>
    m = re.search(
        r"internalField\s+nonuniform\s+List<vector>\s*(\d+)\s*\(",
        clean,
    )
    if m:
        n = int(m.group(1))
        start = m.end()
        end = clean.rindex(")")
        block = clean[start:end]
        tuples = re.findall(r"\(\s*([^)]+)\)", block)
        vecs = []
        for t in tuples[:n]:
            parts = t.split()
            vecs.append([float(parts[0]), float(parts[1]), float(parts[2])])
        return "nonuniform_vector", np.array(vecs, dtype=np.float64)

    raise ValueError("Cannot parse internalField from field file")


def _parse_internal_field_binary(
    text: str, raw_bytes: bytes, header: dict[str, str]
) -> tuple[str, np.ndarray]:
    """Parse the internalField from a binary-format field file.

    Binary format: after the count and opening '(', raw doubles are stored.
    Scalars: N doubles (8 bytes each).
    Vectors: N * 3 doubles (24 bytes per vector).
    """
    clean = _strip_comments(text)

    # Detect if it's a vector or scalar field from the class keyword
    field_class = header.get("class", "")
    is_vector = "vector" in field_class.lower()

    # Check for uniform first (these are always text even in binary files)
    if "uniform" in clean and "nonuniform" not in clean:
        return _parse_internal_field_ascii(text)

    # For nonuniform binary: find the count after "nonuniform List<...>"
    if is_vector:
        m = re.search(r"internalField\s+nonuniform\s+List<vector>\s*(\d+)", clean)
    else:
        m = re.search(r"internalField\s+nonuniform\s+List<scalar>\s*(\d+)", clean)

    if not m:
        raise ValueError("Cannot find nonuniform field count in binary file")

    n = int(m.group(1))

    # Find the opening '(' in the raw bytes after the count
    # The byte position of the text match end
    text_pos = m.end()
    # Find '(' after this position in the raw text
    paren_pos = text.index("(", text_pos)
    # The binary data starts right after the '(' and newline
    byte_start = paren_pos + 1
    # Skip any whitespace/newline byte
    while byte_start < len(raw_bytes) and raw_bytes[byte_start] in (
        ord("\n"),
        ord("\r"),
        ord(" "),
    ):
        byte_start += 1

    if is_vector:
        n_doubles = n * 3
        data = struct.unpack(f"<{n_doubles}d", raw_bytes[byte_start : byte_start + n_doubles * 8])
        return "nonuniform_vector", np.array(data, dtype=np.float64).reshape(n, 3)
    else:
        data = struct.unpack(f"<{n}d", raw_bytes[byte_start : byte_start + n * 8])
        return "nonuniform_scalar", np.array(data, dtype=np.float64)


def parse_field(case_dir: str | Path, time_dir: str, field_name: str) -> tuple[str, np.ndarray]:
    """Parse a field file and return (field_type, values).

    field_type is one of: 'uniform_scalar', 'uniform_vector',
    'nonuniform_scalar', 'nonuniform_vector'.
    """
    path = Path(case_dir) / time_dir / field_name
    if not path.is_file():
        raise FileNotFoundError(f"Field file not found: {path}")

    header, text, raw_bytes = _read_field_file(path)

    if _is_binary(header):
        return _parse_internal_field_binary(text, raw_bytes, header)
    else:
        return _parse_internal_field_ascii(text)


# ---------------------------------------------------------------------------
# Triangulation
# ---------------------------------------------------------------------------


def triangulate_faces(faces: list[list[int]]) -> list[list[int]]:
    """Fan-triangulate N-gon faces into triangles for Three.js.

    Each face [v0, v1, v2, ..., vN-1] becomes N-2 triangles:
    [v0, v1, v2], [v0, v2, v3], ..., [v0, vN-2, vN-1].
    """
    triangles: list[list[int]] = []
    for face in faces:
        if len(face) < 3:
            continue
        v0 = face[0]
        for i in range(1, len(face) - 1):
            triangles.append([v0, face[i], face[i + 1]])
    return triangles


# ---------------------------------------------------------------------------
# Inverse-distance interpolation: cell centers -> vertices
# ---------------------------------------------------------------------------


def _compute_face_centers(
    points: np.ndarray, faces: list[list[int]]
) -> np.ndarray:
    """Compute the centroid of each face as the average of its vertices."""
    centers = np.empty((len(faces), 3), dtype=np.float64)
    for i, face in enumerate(faces):
        face_pts = points[face]
        centers[i] = face_pts.mean(axis=0)
    return centers


def interpolate_to_vertices(
    points: np.ndarray,
    boundary_faces: list[list[int]],
    cell_values: np.ndarray,
) -> np.ndarray:
    """Inverse-distance interpolation from face-center values to vertex values.

    For boundary-only rendering, we treat each boundary face's center as the
    field value location and interpolate to the face vertices.

    Parameters
    ----------
    points : (V, 3) array of vertex coordinates
    boundary_faces : list of face vertex-index lists (boundary faces only)
    cell_values : (F,) array of one value per boundary face

    Returns
    -------
    vertex_values : (V,) array of interpolated values at each vertex
    """
    n_verts = len(points)
    face_centers = _compute_face_centers(points, boundary_faces)

    # Accumulate weighted contributions
    weights = np.zeros(n_verts, dtype=np.float64)
    weighted_vals = np.zeros(n_verts, dtype=np.float64)

    for fi, face in enumerate(boundary_faces):
        center = face_centers[fi]
        val = cell_values[fi]
        for vi in face:
            dist = np.linalg.norm(points[vi] - center)
            w = 1.0 / max(dist, 1e-12)
            weights[vi] += w
            weighted_vals[vi] += w * val

    # Avoid division by zero for vertices not referenced by any face
    mask = weights > 0
    result = np.zeros(n_verts, dtype=np.float64)
    result[mask] = weighted_vals[mask] / weights[mask]
    return result


# ---------------------------------------------------------------------------
# High-level: extract boundary mesh + field for visualization
# ---------------------------------------------------------------------------


def extract_boundary_field_data(
    case_dir: str | Path,
    time_dir: str,
    field_name: str,
) -> dict[str, Any]:
    """Extract boundary surface mesh and field values for 3D rendering.

    Returns a dict with vertices, triangulated faces, interpolated values,
    patch info, and metadata.
    """
    case_path = Path(case_dir)

    # Parse mesh topology
    points = parse_points(case_path)
    all_faces = parse_faces(case_path)
    patches = parse_boundary(case_path)

    # Extract boundary faces only
    boundary_faces: list[list[int]] = []
    patch_info: list[dict[str, Any]] = []
    tri_offset = 0

    for patch in patches:
        start = patch["startFace"]
        n = patch["nFaces"]
        patch_faces = all_faces[start : start + n]
        boundary_faces.extend(patch_faces)

        # Count triangles this patch will produce
        n_tris = sum(max(0, len(f) - 2) for f in patch_faces)
        patch_info.append(
            {
                "name": patch["name"],
                "startFace": tri_offset,
                "nFaces": n_tris,
            }
        )
        tri_offset += n_tris

    # Parse field data
    field_type, field_values = parse_field(case_path, time_dir, field_name)

    # Determine per-face values for boundary faces
    n_boundary = len(boundary_faces)

    if field_type == "uniform_scalar":
        face_values = np.full(n_boundary, field_values[0], dtype=np.float64)
        is_vector = False
        vectors = None
    elif field_type == "uniform_vector":
        vec = field_values[0]
        mag = float(np.linalg.norm(vec))
        face_values = np.full(n_boundary, mag, dtype=np.float64)
        is_vector = True
        face_vectors = np.tile(vec, (n_boundary, 1))
        vectors = face_vectors
    elif field_type == "nonuniform_scalar":
        # For cell-centered data, boundary faces get the last N values
        # or if the field has exactly as many values as boundary faces, use directly
        total_cells = len(field_values)
        if total_cells >= n_boundary:
            # Use the last n_boundary values (boundary faces come after internal)
            face_values = field_values[total_cells - n_boundary :]
        else:
            # Field is smaller — repeat last value
            face_values = np.full(n_boundary, field_values[-1] if len(field_values) > 0 else 0.0)
        is_vector = False
        vectors = None
    elif field_type == "nonuniform_vector":
        total_cells = len(field_values)
        if total_cells >= n_boundary:
            vecs = field_values[total_cells - n_boundary :]
        else:
            last_vec = field_values[-1] if len(field_values) > 0 else np.zeros(3)
            vecs = np.tile(last_vec, (n_boundary, 1))
        face_values = np.linalg.norm(vecs, axis=1)
        is_vector = True
        vectors = vecs
    else:
        raise ValueError(f"Unknown field type: {field_type}")

    # Interpolate to vertices
    vertex_values = interpolate_to_vertices(points, boundary_faces, face_values)

    # Triangulate for Three.js
    triangles = triangulate_faces(boundary_faces)

    # Build result
    result: dict[str, Any] = {
        "vertices": points.tolist(),
        "faces": triangles,
        "values": vertex_values.tolist(),
        "min": float(np.min(vertex_values)) if len(vertex_values) > 0 else 0.0,
        "max": float(np.max(vertex_values)) if len(vertex_values) > 0 else 0.0,
        "field": field_name,
        "time": time_dir,
        "patches": patch_info,
    }

    if is_vector and vectors is not None:
        # Also interpolate vectors to vertices (per-component)
        vx = interpolate_to_vertices(points, boundary_faces, vectors[:, 0])
        vy = interpolate_to_vertices(points, boundary_faces, vectors[:, 1])
        vz = interpolate_to_vertices(points, boundary_faces, vectors[:, 2])
        result["vectors"] = np.column_stack([vx, vy, vz]).tolist()

    return result
