"""Tests for the GET /cases/{name}/slice endpoint."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app

client = TestClient(app)


FAKE_SLICE_RESULT = {
    "vertices": [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0]],
    "faces": [[0, 1, 2]],
    "values": [0.5, 0.8, 0.3],
    "min": 0.3,
    "max": 0.8,
}


def test_slice_valid_params(tmp_foam_run):
    """GET /cases/{name}/slice with valid params returns 200 and expected shape."""
    case = tmp_foam_run / "mycase"
    case.mkdir()

    with patch("routers.geometry.FOAM_RUN", str(tmp_foam_run)), \
         patch("routers.geometry.resolve_time", return_value="100"), \
         patch("routers.geometry.slice_field", return_value=FAKE_SLICE_RESULT):
        resp = client.get("/cases/mycase/slice", params={
            "field": "p", "time": "latest", "axis": "x", "position": 0.5,
        })

    assert resp.status_code == 200
    data = resp.json()
    assert "vertices" in data
    assert "faces" in data
    assert "values" in data
    assert "min" in data
    assert "max" in data
    assert isinstance(data["vertices"], list)
    assert isinstance(data["faces"], list)


def test_slice_invalid_axis(tmp_foam_run):
    """GET /cases/{name}/slice with invalid axis returns 400."""
    case = tmp_foam_run / "mycase"
    case.mkdir()

    with patch("routers.geometry.FOAM_RUN", str(tmp_foam_run)), \
         patch("routers.geometry.resolve_time", return_value="100"):
        resp = client.get("/cases/mycase/slice", params={
            "field": "p", "axis": "w", "position": 0.0,
        })

    assert resp.status_code == 400
    assert "Invalid axis" in resp.json()["detail"]


def test_slice_nonexistent_case(tmp_foam_run):
    """GET /cases/{name}/slice for a missing case returns 404."""
    with patch("routers.geometry.FOAM_RUN", str(tmp_foam_run)):
        resp = client.get("/cases/noexist/slice", params={
            "field": "p", "axis": "x", "position": 0.0,
        })

    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_slice_field_file_missing(tmp_foam_run):
    """GET /cases/{name}/slice when field file is missing returns 404."""
    case = tmp_foam_run / "mycase"
    case.mkdir()

    with patch("routers.geometry.FOAM_RUN", str(tmp_foam_run)), \
         patch("routers.geometry.resolve_time", return_value="100"), \
         patch("routers.geometry.slice_field",
               side_effect=FileNotFoundError("Field file 'p' not found in 100")):
        resp = client.get("/cases/mycase/slice", params={
            "field": "p", "axis": "x", "position": 0.0,
        })

    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()
