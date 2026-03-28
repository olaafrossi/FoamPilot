"""Tests for slice-related functions in services.field_parser."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

# Add backend to path so imports work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.field_parser import (
    _clip_face_to_plane,
    _get_cached_mesh,
    _mesh_cache,
    compute_cell_centers,
    parse_neighbour,
    parse_owner,
    slice_field,
)


# ---------------------------------------------------------------------------
# Helpers for building minimal OpenFOAM files
# ---------------------------------------------------------------------------

_FOAM_HEADER = """\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       {cls};
    object      {obj};
}}
"""


def _write_points(poly_dir: Path, pts: list[tuple[float, float, float]]):
    header = _FOAM_HEADER.format(cls="vectorField", obj="points")
    lines = [header, f"{len(pts)}", "("]
    for p in pts:
        lines.append(f"({p[0]} {p[1]} {p[2]})")
    lines.append(")")
    (poly_dir / "points").write_text("\n".join(lines), encoding="utf-8")


def _write_faces(poly_dir: Path, faces: list[list[int]]):
    header = _FOAM_HEADER.format(cls="faceList", obj="faces")
    lines = [header, f"{len(faces)}", "("]
    for f in faces:
        verts = " ".join(str(v) for v in f)
        lines.append(f"{len(f)}({verts})")
    lines.append(")")
    (poly_dir / "faces").write_text("\n".join(lines), encoding="utf-8")


def _write_label_list(poly_dir: Path, name: str, values: list[int]):
    header = _FOAM_HEADER.format(cls="labelList", obj=name)
    lines = [header, f"{len(values)}", "("]
    for v in values:
        lines.append(str(v))
    lines.append(")")
    (poly_dir / name).write_text("\n".join(lines), encoding="utf-8")


def _write_boundary(poly_dir: Path, patches: list[dict]):
    header = _FOAM_HEADER.format(cls="polyBoundaryMesh", obj="boundary")
    lines = [header, f"{len(patches)}", "("]
    for p in patches:
        lines.append(f"    {p['name']}")
        lines.append("    {")
        lines.append(f"        type {p['type']};")
        lines.append(f"        nFaces {p['nFaces']};")
        lines.append(f"        startFace {p['startFace']};")
        lines.append("    }")
    lines.append(")")
    (poly_dir / "boundary").write_text("\n".join(lines), encoding="utf-8")


def _write_scalar_field(path: Path, field_name: str, n_cells: int, values: list[float]):
    """Write a nonuniform scalar field file."""
    header = _FOAM_HEADER.format(cls="volScalarField", obj=field_name)
    vals_str = "\n".join(str(v) for v in values)
    content = f"""{header}
dimensions      [0 0 0 0 0 0 0];
internalField   nonuniform List<scalar> {n_cells}
(
{vals_str}
)
;

boundaryField
{{
}}
"""
    path.write_text(content, encoding="utf-8")


# ---------------------------------------------------------------------------
# Fixture: single hex cell case
# ---------------------------------------------------------------------------

@pytest.fixture
def hex_case(tmp_path):
    """Create a minimal case with one hexahedral cell.

    The hex cell spans (0,0,0) to (2,2,2).
    8 points, 6 faces (quads), 1 cell.
    Internal faces: 0 (all faces are boundary for a single cell).
    To test slicing we need at least 2 cells, so we also provide a
    two-cell variant via ``two_cell_case``.
    """
    case = tmp_path / "hex"
    poly = case / "constant" / "polyMesh"
    poly.mkdir(parents=True)
    (case / "0").mkdir()

    # Unit cube: 8 vertices
    pts = [
        (0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0),  # bottom z=0
        (0, 0, 2), (2, 0, 2), (2, 2, 2), (0, 2, 2),  # top z=2
    ]
    _write_points(poly, pts)

    # 6 quad faces for a single hex cell
    faces = [
        [0, 3, 2, 1],  # bottom  (z=0)
        [4, 5, 6, 7],  # top     (z=2)
        [0, 1, 5, 4],  # front   (y=0)
        [2, 3, 7, 6],  # back    (y=2)
        [0, 4, 7, 3],  # left    (x=0)
        [1, 2, 6, 5],  # right   (x=2)
    ]
    _write_faces(poly, faces)

    # Owner: all 6 faces belong to cell 0
    _write_label_list(poly, "owner", [0] * 6)
    # Neighbour: empty (no internal faces)
    _write_label_list(poly, "neighbour", [])
    # Boundary
    _write_boundary(poly, [{"name": "walls", "type": "wall", "nFaces": 6, "startFace": 0}])

    return case


@pytest.fixture
def two_cell_case(tmp_path):
    """Create a case with two hex cells sharing an internal face.

    Cell 0: (0,0,0)-(1,0,0)-(1,1,0)-(0,1,0)-(0,0,1)-(1,0,1)-(1,1,1)-(0,1,1)
    Cell 1: (1,0,0)-(2,0,0)-(2,1,0)-(1,1,0)-(1,0,1)-(2,0,1)-(2,1,1)-(1,1,1)
    Shared internal face at x=1: vertices 1,3,6,4 (second indexing: 1,3,7,5 remap)
    """
    case = tmp_path / "two_cell"
    poly = case / "constant" / "polyMesh"
    poly.mkdir(parents=True)
    td = case / "1"
    td.mkdir()

    # 12 vertices
    pts = [
        (0, 0, 0),  # 0
        (1, 0, 0),  # 1
        (2, 0, 0),  # 2
        (0, 1, 0),  # 3
        (1, 1, 0),  # 4
        (2, 1, 0),  # 5
        (0, 0, 1),  # 6
        (1, 0, 1),  # 7
        (2, 0, 1),  # 8
        (0, 1, 1),  # 9
        (1, 1, 1),  # 10
        (2, 1, 1),  # 11
    ]
    _write_points(poly, pts)

    # Face ordering: internal face first, then boundary faces.
    # Internal face (shared at x=1): vertices 1, 4, 10, 7
    # Boundary faces for cell 0: left(x=0), bottom(z=0), top(z=1), front(y=0), back(y=1)
    # Boundary faces for cell 1: right(x=2), bottom(z=0), top(z=1), front(y=0), back(y=1)
    faces = [
        [1, 4, 10, 7],    # 0: internal face at x=1
        [0, 6, 9, 3],     # 1: cell0 left   (x=0)
        [0, 1, 4, 3],     # 2: cell0 bottom  (z=0)
        [6, 7, 10, 9],    # 3: cell0 top     (z=1)
        [0, 1, 7, 6],     # 4: cell0 front   (y=0)
        [3, 4, 10, 9],    # 5: cell0 back    (y=1)
        [2, 5, 11, 8],    # 6: cell1 right   (x=2)
        [1, 2, 5, 4],     # 7: cell1 bottom  (z=0)
        [7, 8, 11, 10],   # 8: cell1 top     (z=1)
        [1, 2, 8, 7],     # 9: cell1 front   (y=0)
        [4, 5, 11, 10],   # 10: cell1 back   (y=1)
    ]
    _write_faces(poly, faces)

    # Owner: face_i -> cell that owns it
    owner = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
    _write_label_list(poly, "owner", owner)

    # Neighbour: only internal face 0 has neighbour = cell 1
    _write_label_list(poly, "neighbour", [1])

    _write_boundary(poly, [
        {"name": "walls", "type": "wall", "nFaces": 10, "startFace": 1},
    ])

    # Write a scalar field: cell0=10.0, cell1=20.0
    _write_scalar_field(td / "p", "p", 2, [10.0, 20.0])

    return case


# ===================================================================
# Tests for _clip_face_to_plane
# ===================================================================


class TestClipFaceToPlane:
    """Tests for the Sutherland-Hodgman face-plane clipper."""

    def _square_face(self) -> np.ndarray:
        """A unit square in the XY plane at z=0: x in [0,2], y in [0,2]."""
        return np.array([
            [0, 0, 0],
            [2, 0, 0],
            [2, 2, 0],
            [0, 2, 0],
        ], dtype=np.float64)

    def test_clip_x_axis_crossing(self):
        """Plane at x=1 should produce intersection points on the crossing edges."""
        face = self._square_face()
        result = _clip_face_to_plane(face, ax=0, position=1.0)
        # Edges 0->1 and 3->0 cross x=1; edges 1->2 and 2->3 also cross x=1
        assert len(result) >= 2
        # All result points should have x == 1.0
        np.testing.assert_allclose(result[:, 0], 1.0, atol=1e-12)

    def test_clip_y_axis_crossing(self):
        face = self._square_face()
        result = _clip_face_to_plane(face, ax=1, position=1.0)
        assert len(result) >= 2
        np.testing.assert_allclose(result[:, 1], 1.0, atol=1e-12)

    def test_clip_z_axis_crossing(self):
        """Face in XY plane; slicing at z=0 means all vertices are ON the plane."""
        face = self._square_face()
        result = _clip_face_to_plane(face, ax=2, position=0.0)
        # All 4 vertices lie on the plane (z=0), so all should be included
        assert len(result) == 4
        np.testing.assert_allclose(result[:, 2], 0.0, atol=1e-12)

    def test_face_fully_inside_no_crossing(self):
        """Plane that doesn't intersect the face at all (no vertex on plane, all same side)."""
        face = self._square_face()  # x in [0,2]
        result = _clip_face_to_plane(face, ax=0, position=5.0)
        # No edge crosses x=5, no vertex is at x=5
        assert len(result) == 0

    def test_face_fully_outside(self):
        """Plane far away on the other side."""
        face = self._square_face()
        result = _clip_face_to_plane(face, ax=0, position=-3.0)
        assert len(result) == 0

    def test_degenerate_face_too_few_verts(self):
        """Face with fewer than 3 vertices returns empty."""
        face = np.array([[0, 0, 0], [1, 0, 0]], dtype=np.float64)
        result = _clip_face_to_plane(face, ax=0, position=0.5)
        assert len(result) == 0

    def test_3d_face_clip(self):
        """A face in 3D space clipped at y=0.5."""
        face = np.array([
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 1],
            [0, 1, 1],
        ], dtype=np.float64)
        result = _clip_face_to_plane(face, ax=1, position=0.5)
        assert len(result) >= 2
        np.testing.assert_allclose(result[:, 1], 0.5, atol=1e-12)


# ===================================================================
# Tests for compute_cell_centers
# ===================================================================


class TestComputeCellCenters:
    def test_single_hex_cell(self, hex_case):
        """Center of a cube spanning (0,0,0)-(2,2,2) should be (1,1,1)."""
        from services.field_parser import parse_faces, parse_points

        points = parse_points(hex_case)
        faces = parse_faces(hex_case)
        owner = parse_owner(hex_case)
        neighbour = parse_neighbour(hex_case)

        centers = compute_cell_centers(points, faces, owner, neighbour)
        assert centers.shape == (1, 3)
        np.testing.assert_allclose(centers[0], [1.0, 1.0, 1.0], atol=1e-10)

    def test_two_cells(self, two_cell_case):
        """Two adjacent unit cubes: centers at (0.5,0.5,0.5) and (1.5,0.5,0.5)."""
        from services.field_parser import parse_faces, parse_points

        points = parse_points(two_cell_case)
        faces = parse_faces(two_cell_case)
        owner = parse_owner(two_cell_case)
        neighbour = parse_neighbour(two_cell_case)

        centers = compute_cell_centers(points, faces, owner, neighbour)
        assert centers.shape == (2, 3)
        np.testing.assert_allclose(centers[0], [0.5, 0.5, 0.5], atol=0.15)
        np.testing.assert_allclose(centers[1], [1.5, 0.5, 0.5], atol=0.15)


# ===================================================================
# Tests for parse_owner / parse_neighbour
# ===================================================================


class TestParseOwnerNeighbour:
    def test_parse_owner_ascii(self, hex_case):
        owner = parse_owner(hex_case)
        assert len(owner) == 6
        np.testing.assert_array_equal(owner, [0, 0, 0, 0, 0, 0])

    def test_parse_neighbour_ascii_empty(self, hex_case):
        neighbour = parse_neighbour(hex_case)
        assert len(neighbour) == 0

    def test_parse_owner_two_cells(self, two_cell_case):
        owner = parse_owner(two_cell_case)
        assert len(owner) == 11
        assert owner[0] == 0  # internal face owned by cell 0

    def test_parse_neighbour_two_cells(self, two_cell_case):
        neighbour = parse_neighbour(two_cell_case)
        assert len(neighbour) == 1
        assert neighbour[0] == 1

    def test_owner_missing_file(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            parse_owner(tmp_path)

    def test_neighbour_missing_file(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            parse_neighbour(tmp_path)


# ===================================================================
# Tests for slice_field (integration)
# ===================================================================


class TestSliceField:
    def test_slice_returns_expected_keys(self, two_cell_case):
        """Slice at x=1.0 (the internal face) should produce valid output."""
        result = slice_field(two_cell_case, "1", "p", "x", 1.0)
        expected_keys = {"vertices", "faces", "values", "min", "max", "field", "axis", "position"}
        assert expected_keys.issubset(result.keys())
        assert result["field"] == "p"
        assert result["axis"] == "x"
        assert result["position"] == 1.0

    def test_slice_has_geometry(self, two_cell_case):
        """Slice at x=1.0 should produce at least one triangle."""
        result = slice_field(two_cell_case, "1", "p", "x", 1.0)
        assert len(result["vertices"]) > 0
        assert len(result["faces"]) > 0
        assert len(result["values"]) > 0

    def test_slice_interpolated_value(self, two_cell_case):
        """At x=1.0 (midway), interpolated value should be between 10 and 20."""
        result = slice_field(two_cell_case, "1", "p", "x", 1.0)
        if result["values"]:
            for v in result["values"]:
                assert 9.0 <= v <= 21.0

    def test_slice_no_intersection(self, two_cell_case):
        """Slice outside the mesh should return empty geometry."""
        result = slice_field(two_cell_case, "1", "p", "x", 100.0)
        assert len(result["vertices"]) == 0
        assert len(result["faces"]) == 0
        assert "message" in result

    def test_slice_invalid_axis(self, two_cell_case):
        with pytest.raises(ValueError, match="Invalid axis"):
            slice_field(two_cell_case, "1", "p", "w", 1.0)

    def test_slice_missing_field(self, two_cell_case):
        with pytest.raises(FileNotFoundError):
            slice_field(two_cell_case, "1", "nonexistent", "x", 1.0)

    def test_slice_y_axis(self, two_cell_case):
        """Slice at y=0.5 should also work (crosses both cells)."""
        result = slice_field(two_cell_case, "1", "p", "y", 0.5)
        expected_keys = {"vertices", "faces", "values", "min", "max", "field", "axis", "position"}
        assert expected_keys.issubset(result.keys())

    def test_slice_z_axis(self, two_cell_case):
        """Slice at z=0.5 should also work."""
        result = slice_field(two_cell_case, "1", "p", "z", 0.5)
        expected_keys = {"vertices", "faces", "values", "min", "max", "field", "axis", "position"}
        assert expected_keys.issubset(result.keys())


# ===================================================================
# Tests for _get_cached_mesh
# ===================================================================


class TestGetCachedMesh:
    def test_caching_returns_same_object(self, two_cell_case):
        """Calling _get_cached_mesh twice should return the cached result."""
        _mesh_cache.clear()
        result1 = _get_cached_mesh(two_cell_case)
        cache_size_after_first = len(_mesh_cache)
        result2 = _get_cached_mesh(two_cell_case)
        cache_size_after_second = len(_mesh_cache)

        # Cache should not grow on second call
        assert cache_size_after_first == cache_size_after_second
        assert cache_size_after_first == 1
        # Should be the exact same dict object (cached)
        assert result1 is result2

    def test_cache_contains_expected_keys(self, two_cell_case):
        _mesh_cache.clear()
        result = _get_cached_mesh(two_cell_case)
        assert "points" in result
        assert "faces" in result
        assert "owner" in result
        assert "neighbour" in result
        assert "cell_centers" in result

    def test_cache_eviction(self, tmp_path):
        """Cache should evict oldest entry when exceeding _MESH_CACHE_MAX."""
        from services.field_parser import _MESH_CACHE_MAX

        _mesh_cache.clear()

        # Create several case directories that look valid
        cases = []
        for i in range(_MESH_CACHE_MAX + 1):
            case = tmp_path / f"case_{i}"
            poly = case / "constant" / "polyMesh"
            poly.mkdir(parents=True)
            td = case / "1"
            td.mkdir()

            pts = [
                (0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
                (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1),
            ]
            _write_points(poly, pts)
            faces = [
                [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
                [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5],
            ]
            _write_faces(poly, faces)
            _write_label_list(poly, "owner", [0] * 6)
            _write_label_list(poly, "neighbour", [])
            _write_boundary(poly, [
                {"name": "walls", "type": "wall", "nFaces": 6, "startFace": 0}
            ])
            cases.append(case)

        for case in cases:
            _get_cached_mesh(case)

        assert len(_mesh_cache) <= _MESH_CACHE_MAX
        _mesh_cache.clear()


# ===================================================================
# Error case tests
# ===================================================================


class TestErrorCases:
    def test_missing_field_file_raises(self, two_cell_case):
        with pytest.raises(FileNotFoundError):
            slice_field(two_cell_case, "1", "does_not_exist", "x", 1.0)

    def test_invalid_axis_raises_value_error(self, two_cell_case):
        with pytest.raises(ValueError, match="Invalid axis"):
            slice_field(two_cell_case, "1", "p", "q", 0.5)

    def test_missing_time_dir(self, two_cell_case):
        """Referencing a time directory that doesn't exist should raise."""
        with pytest.raises(FileNotFoundError):
            slice_field(two_cell_case, "999", "p", "x", 1.0)
