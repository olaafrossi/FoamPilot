"""Tests for geometry upload — .foam file auto-creation."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app


def _make_binary_stl() -> bytes:
    """Build a minimal binary STL with 2 triangles forming a valid 3D bbox."""
    header = b"\x00" * 80
    count = struct.pack("<I", 2)
    data = header + count
    # Triangle 1: in XY plane at z=0
    data += struct.pack(
        "<12f",
        0.0, 0.0, 1.0,    # normal
        0.0, 0.0, 0.0,    # v1
        1.0, 0.0, 0.0,    # v2
        0.0, 1.0, 0.0,    # v3
    ) + struct.pack("<H", 0)
    # Triangle 2: extends to z=1 for valid 3D bbox (>0.001 in all dims)
    data += struct.pack(
        "<12f",
        0.0, 0.0, 1.0,    # normal
        0.0, 0.0, 1.0,    # v1
        1.0, 0.0, 1.0,    # v2
        0.0, 1.0, 1.0,    # v3
    ) + struct.pack("<H", 0)
    return data


def test_upload_geometry_creates_foam_file(tmp_foam_run, tmp_foam_templates):
    """Uploading an STL should auto-create a .foam file for ParaView."""
    # Create motorBike template scaffold (upload_geometry copies from it)
    template_dir = tmp_foam_templates / "motorBike"
    (template_dir / "system").mkdir(parents=True)
    (template_dir / "constant").mkdir(parents=True)
    (template_dir / "0").mkdir(parents=True)

    stl_data = _make_binary_stl()

    client = TestClient(app)
    resp = client.post(
        "/cases/testcase/upload-geometry",
        files={"file": ("motor.stl", stl_data, "application/octet-stream")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["filename"] == "motor.stl"

    # Verify .foam file was created
    foam_file = tmp_foam_run / "testcase" / "testcase.foam"
    assert foam_file.exists(), ".foam file should be auto-created during upload"
    assert foam_file.stat().st_size == 0, ".foam file should be empty"


def test_upload_geometry_foam_file_idempotent(tmp_foam_run, tmp_foam_templates):
    """Uploading twice should not fail — .foam file creation is idempotent."""
    template_dir = tmp_foam_templates / "motorBike"
    (template_dir / "system").mkdir(parents=True)
    (template_dir / "constant").mkdir(parents=True)
    (template_dir / "0").mkdir(parents=True)

    stl_data = _make_binary_stl()

    client = TestClient(app)
    resp1 = client.post(
        "/cases/testcase2/upload-geometry",
        files={"file": ("part.stl", stl_data, "application/octet-stream")},
    )
    resp2 = client.post(
        "/cases/testcase2/upload-geometry",
        files={"file": ("part.stl", stl_data, "application/octet-stream")},
    )

    assert resp1.status_code == 200
    assert resp2.status_code == 200

    foam_file = tmp_foam_run / "testcase2" / "testcase2.foam"
    assert foam_file.exists()
