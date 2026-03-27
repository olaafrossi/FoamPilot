"""Tests for OpenFOAM field file parser and field-data endpoint."""

from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from services.field_parser import (
    discover_available_fields,
    discover_time_directories,
    extract_boundary_field_data,
    parse_boundary,
    parse_faces,
    parse_field,
    parse_points,
    triangulate_faces,
)

# Path to the hand-written tiny_case fixture
_FIXTURES = Path(__file__).resolve().parent / "fixtures"
_TINY_CASE = _FIXTURES / "tiny_case"


# ---------------------------------------------------------------------------
# polyMesh parsing
# ---------------------------------------------------------------------------


class TestParsePoints:
    """Tests for parse_points."""

    def test_parse_points(self):
        """Reads the tiny_case points file and returns (8, 3) numpy array."""
        pts = parse_points(_TINY_CASE)
        assert isinstance(pts, np.ndarray)
        assert pts.shape == (8, 3)
        # First vertex should be origin
        np.testing.assert_array_almost_equal(pts[0], [0.0, 0.0, 0.0])
        # Last vertex should be (0, 1, 1)
        np.testing.assert_array_almost_equal(pts[7], [0.0, 1.0, 1.0])

    def test_parse_points_missing_file(self, tmp_path):
        """Raises FileNotFoundError for a nonexistent case."""
        with pytest.raises(FileNotFoundError):
            parse_points(tmp_path / "no_such_case")


class TestParseFaces:
    """Tests for parse_faces."""

    def test_parse_faces(self):
        """Reads the tiny_case faces file and returns list of 6 quad faces."""
        faces = parse_faces(_TINY_CASE)
        assert isinstance(faces, list)
        assert len(faces) == 6
        # Each face should be a quad (4 vertices)
        for face in faces:
            assert len(face) == 4
        # First face: bottom face (0 3 2 1)
        assert faces[0] == [0, 3, 2, 1]

    def test_parse_faces_missing_file(self, tmp_path):
        """Raises FileNotFoundError for a nonexistent case."""
        with pytest.raises(FileNotFoundError):
            parse_faces(tmp_path / "no_such_case")


class TestParseBoundary:
    """Tests for parse_boundary."""

    def test_parse_boundary(self):
        """Reads boundary file and returns a list with one 'walls' patch."""
        patches = parse_boundary(_TINY_CASE)
        assert isinstance(patches, list)
        assert len(patches) == 1
        patch = patches[0]
        assert patch["name"] == "walls"
        assert patch["type"] == "wall"
        assert patch["nFaces"] == 6
        assert patch["startFace"] == 0

    def test_parse_boundary_missing_file(self, tmp_path):
        """Raises FileNotFoundError for a nonexistent case."""
        with pytest.raises(FileNotFoundError):
            parse_boundary(tmp_path / "no_such_case")


# ---------------------------------------------------------------------------
# Field parsing
# ---------------------------------------------------------------------------


class TestParseScalarFieldAscii:
    """Tests for parsing ASCII scalar fields."""

    def test_parse_scalar_field_ascii(self):
        """Reads 0/p (uniform 0) and returns a float array."""
        field_type, values = parse_field(_TINY_CASE, "0", "p")
        assert field_type == "uniform_scalar"
        assert isinstance(values, np.ndarray)
        assert len(values) == 1
        assert values[0] == pytest.approx(0.0)

    def test_parse_field_missing(self, tmp_path):
        """Raises FileNotFoundError for a missing field file."""
        with pytest.raises(FileNotFoundError):
            parse_field(tmp_path, "0", "nonexistent")


class TestParseVectorFieldAscii:
    """Tests for parsing ASCII vector fields."""

    def test_parse_vector_field_ascii(self):
        """Reads 0/U (uniform (1 0 0)) and returns (1, 3) array."""
        field_type, values = parse_field(_TINY_CASE, "0", "U")
        assert field_type == "uniform_vector"
        assert isinstance(values, np.ndarray)
        assert values.shape == (1, 3)
        np.testing.assert_array_almost_equal(values[0], [1.0, 0.0, 0.0])


# ---------------------------------------------------------------------------
# Time directory discovery
# ---------------------------------------------------------------------------


class TestDiscoverTimeDirectories:
    """Tests for discover_time_directories."""

    def test_discover_time_directories(self):
        """Finds the '0' directory in tiny_case."""
        times = discover_time_directories(_TINY_CASE)
        assert isinstance(times, list)
        assert "0" in times

    def test_discover_time_directories_empty(self, tmp_path):
        """Returns empty list for a nonexistent directory."""
        times = discover_time_directories(tmp_path / "no_such_case")
        assert times == []

    def test_discover_time_directories_multiple(self, tmp_path):
        """Correctly sorts multiple numeric directories."""
        case = tmp_path / "multi_time"
        case.mkdir()
        (case / "0").mkdir()
        (case / "100").mkdir()
        (case / "0.5").mkdir()
        (case / "200").mkdir()
        (case / "system").mkdir()  # non-numeric, should be excluded

        times = discover_time_directories(case)
        assert times == ["0", "0.5", "100", "200"]


class TestDiscoverAvailableFields:
    """Tests for discover_available_fields."""

    def test_discover_available_fields(self):
        """Lists field names (p, U) in the 0/ directory of tiny_case."""
        fields = discover_available_fields(_TINY_CASE, "0")
        assert isinstance(fields, list)
        assert "p" in fields
        assert "U" in fields

    def test_discover_available_fields_empty(self, tmp_path):
        """Returns empty list for a nonexistent time dir."""
        fields = discover_available_fields(tmp_path, "999")
        assert fields == []


# ---------------------------------------------------------------------------
# Triangulation
# ---------------------------------------------------------------------------


class TestTriangulateFaces:
    """Tests for fan triangulation of N-gon faces."""

    def test_quad_to_two_triangles(self):
        """A quad face should produce 2 triangles."""
        faces = [[0, 1, 2, 3]]
        tris = triangulate_faces(faces)
        assert len(tris) == 2
        assert tris[0] == [0, 1, 2]
        assert tris[1] == [0, 2, 3]

    def test_triangle_unchanged(self):
        """A triangle face should produce 1 triangle."""
        faces = [[0, 1, 2]]
        tris = triangulate_faces(faces)
        assert len(tris) == 1
        assert tris[0] == [0, 1, 2]

    def test_pentagon(self):
        """A 5-sided face should produce 3 triangles."""
        faces = [[0, 1, 2, 3, 4]]
        tris = triangulate_faces(faces)
        assert len(tris) == 3


# ---------------------------------------------------------------------------
# Integration: extract_boundary_field_data
# ---------------------------------------------------------------------------


class TestExtractBoundaryFieldData:
    """Tests for the high-level extraction function."""

    def test_extract_scalar(self):
        """Extracts boundary field data for scalar field p."""
        data = extract_boundary_field_data(_TINY_CASE, "0", "p")
        assert "vertices" in data
        assert "faces" in data
        assert "values" in data
        assert "patches" in data
        assert data["field"] == "p"
        assert data["time"] == "0"
        # 8 vertices, values at each vertex
        assert len(data["vertices"]) == 8
        assert len(data["values"]) == 8
        # 6 quad faces -> 12 triangles
        assert len(data["faces"]) == 12

    def test_extract_vector(self):
        """Extracts boundary field data for vector field U, includes vectors."""
        data = extract_boundary_field_data(_TINY_CASE, "0", "U")
        assert "vectors" in data
        assert data["vectors"] is not None
        assert len(data["vectors"]) == 8
        # Values should be magnitudes
        assert all(v >= 0 for v in data["values"])


# ---------------------------------------------------------------------------
# FastAPI endpoint tests
# ---------------------------------------------------------------------------


@pytest.fixture
def _field_data_case(tmp_foam_run):
    """Copy tiny_case into the tmp FOAM_RUN so the endpoint can find it."""
    dest = tmp_foam_run / "tiny_case"
    shutil.copytree(str(_TINY_CASE), str(dest))
    return dest


@pytest.fixture
def client():
    """Create a FastAPI TestClient."""
    from main import app

    return TestClient(app)


class TestFieldDataEndpoint:
    """Tests for GET /cases/{name}/field-data."""

    def test_field_data_endpoint_success(self, client, _field_data_case):
        """Returns 200 with expected schema for a valid case + field."""
        resp = client.get("/cases/tiny_case/field-data?field=p&time=0")
        assert resp.status_code == 200
        body = resp.json()
        assert "vertices" in body
        assert "faces" in body
        assert "values" in body
        assert body["field"] == "p"
        assert body["time"] == "0"
        assert "available_fields" in body
        assert "available_times" in body
        assert "patches" in body
        assert body["warning"] is None

    def test_field_data_endpoint_no_time_dirs(self, client, tmp_foam_run):
        """Returns 404 when the case has no numeric time directories."""
        case = tmp_foam_run / "empty_case"
        case.mkdir()
        (case / "system").mkdir()
        (case / "constant").mkdir()

        resp = client.get("/cases/empty_case/field-data?field=p&time=latest")
        assert resp.status_code == 404

    def test_field_data_endpoint_missing_field(self, client, _field_data_case):
        """Returns 404 when the requested field does not exist."""
        resp = client.get("/cases/tiny_case/field-data?field=nonexistent&time=0")
        assert resp.status_code == 404

    def test_field_data_endpoint_case_not_found(self, client, tmp_foam_run):
        """Returns 404 for a nonexistent case."""
        resp = client.get("/cases/no_such_case/field-data?field=p&time=latest")
        assert resp.status_code == 404

    def test_field_data_endpoint_vector_field(self, client, _field_data_case):
        """Returns vectors array for a vector field like U."""
        resp = client.get("/cases/tiny_case/field-data?field=U&time=0")
        assert resp.status_code == 200
        body = resp.json()
        assert body["field"] == "U"
        assert body["vectors"] is not None
