"""Tests for geometry upload — .foam file auto-creation and template-aware scaffolding."""

from __future__ import annotations

import json
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


@pytest.fixture(autouse=False)
def _patch_geometry_templates(tmp_foam_templates, monkeypatch):
    """Patch FOAM_TEMPLATES in the geometry router module (it imports the constant directly)."""
    import routers.geometry as geo
    monkeypatch.setattr(geo, "FOAM_TEMPLATES", str(tmp_foam_templates))


def _make_template_scaffold(templates_dir: Path, name: str, patch_group: str, domain_type: str = "ground_vehicle"):
    """Create a minimal template with template.json, system/, 0/, constant/."""
    tpl = templates_dir / name
    (tpl / "system").mkdir(parents=True)
    (tpl / "constant").mkdir(parents=True)
    (tpl / "0").mkdir(parents=True)

    # Write a forceCoeffs file referencing the patch group
    (tpl / "system" / "forceCoeffs").write_text(
        f"patches ({patch_group});\nlRef 1.0;\nAref 1.0;\n",
        encoding="utf-8",
    )

    # Write template.json with physics
    meta = {
        "name": f"{name} (simpleFoam)",
        "solver": "simpleFoam",
        "physics": {
            "domain_type": domain_type,
            "velocity": [20, 0, 0],
            "patchGroup": patch_group,
            "liftDir": [0, 0, 1],
            "dragDir": [1, 0, 0],
            "pitchAxis": [0, 1, 0],
            "CofR": [0, 0, 0],
            "magUInf": 20,
            "lRef": 1.0,
            "Aref": 1.0,
            "turbulentKE": 0.24,
            "turbulentOmega": 1.78,
        },
    }
    (tpl / "template.json").write_text(json.dumps(meta), encoding="utf-8")
    return tpl


def test_upload_geometry_with_template_param(tmp_foam_run, tmp_foam_templates, _patch_geometry_templates):
    """Passing template='raceCar' should scaffold from raceCar, not motorBike."""
    _make_template_scaffold(tmp_foam_templates, "raceCar", "raceCarGroup")
    # Also need motorBike as fallback
    _make_template_scaffold(tmp_foam_templates, "motorBike", "motorBikeGroup")

    stl_data = _make_binary_stl()

    client = TestClient(app)
    resp = client.post(
        "/cases/mycar/upload-geometry",
        files={"file": ("car.stl", stl_data, "application/octet-stream")},
        data={"template": "raceCar"},
    )

    assert resp.status_code == 200

    # Verify system/ was copied from raceCar
    force_file = tmp_foam_run / "mycar" / "system" / "forceCoeffs"
    assert force_file.exists()
    text = force_file.read_text(encoding="utf-8")
    # Should have been replaced: raceCarGroup → carGroup
    assert "carGroup" in text
    assert "raceCarGroup" not in text


def test_upload_geometry_default_template(tmp_foam_run, tmp_foam_templates, _patch_geometry_templates):
    """Without template param, should default to motorBike scaffold."""
    _make_template_scaffold(tmp_foam_templates, "motorBike", "motorBikeGroup")

    stl_data = _make_binary_stl()

    client = TestClient(app)
    resp = client.post(
        "/cases/defaultcase/upload-geometry",
        files={"file": ("bike.stl", stl_data, "application/octet-stream")},
    )

    assert resp.status_code == 200

    # Should scaffold from motorBike (the default)
    force_file = tmp_foam_run / "defaultcase" / "system" / "forceCoeffs"
    assert force_file.exists()
    text = force_file.read_text(encoding="utf-8")
    # motorBikeGroup → bikeGroup
    assert "bikeGroup" in text


def test_upload_geometry_nonexistent_template_falls_back(tmp_foam_run, tmp_foam_templates, _patch_geometry_templates):
    """If requested template doesn't exist, fall back to motorBike."""
    _make_template_scaffold(tmp_foam_templates, "motorBike", "motorBikeGroup")

    stl_data = _make_binary_stl()

    client = TestClient(app)
    resp = client.post(
        "/cases/fallbackcase/upload-geometry",
        files={"file": ("part.stl", stl_data, "application/octet-stream")},
        data={"template": "nonExistentTemplate"},
    )

    assert resp.status_code == 200
    # Should have fallen back to motorBike
    force_file = tmp_foam_run / "fallbackcase" / "system" / "forceCoeffs"
    assert force_file.exists()


def _make_binary_stl_at(xmin: float, ymin: float, zmin: float, xmax: float, ymax: float, zmax: float) -> bytes:
    """Build a binary STL with 2 triangles spanning given bounding box."""
    header = b"\x00" * 80
    count = struct.pack("<I", 2)
    data = header + count
    data += struct.pack(
        "<12f",
        0.0, 0.0, 1.0,
        xmin, ymin, zmin,
        xmax, ymin, zmin,
        xmin, ymax, zmin,
    ) + struct.pack("<H", 0)
    data += struct.pack(
        "<12f",
        0.0, 0.0, 1.0,
        xmin, ymin, zmax,
        xmax, ymin, zmax,
        xmin, ymax, zmax,
    ) + struct.pack("<H", 0)
    return data


def test_transform_applies_to_all_geometries(tmp_foam_run, tmp_foam_templates, _patch_geometry_templates):
    """Transforming the primary STL should also transform all other geometries."""
    _make_template_scaffold(tmp_foam_templates, "motorBike", "motorBikeGroup")

    client = TestClient(app)

    # Upload primary geometry (body)
    body_stl = _make_binary_stl_at(0, 0, 0, 1, 0.5, 0.3)
    resp = client.post(
        "/cases/multitransform/upload-geometry",
        files={"file": ("body.stl", body_stl, "application/octet-stream")},
    )
    assert resp.status_code == 200

    # Add a second geometry (propeller)
    prop_stl = _make_binary_stl_at(0.4, -0.1, -0.05, 0.6, 0.1, 0.15)
    resp = client.post(
        "/cases/multitransform/add-geometry",
        files={"file": ("propeller.stl", prop_stl, "application/octet-stream")},
    )
    assert resp.status_code == 200

    # Read original propeller bounds
    resp = client.get("/cases/multitransform/geometry-file?filename=propeller.stl")
    assert resp.status_code == 200
    original_prop = resp.content

    # Apply a 90-degree X rotation to the primary (body) geometry
    resp = client.post(
        "/cases/multitransform/transform-geometry",
        json={"filename": "body.stl", "rotate_x": 90},
    )
    assert resp.status_code == 200

    # Read propeller after transform — it should have changed
    resp = client.get("/cases/multitransform/geometry-file?filename=propeller.stl")
    assert resp.status_code == 200
    transformed_prop = resp.content

    assert original_prop != transformed_prop, (
        "Propeller STL should be transformed when body is rotated"
    )
