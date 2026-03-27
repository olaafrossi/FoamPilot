"""Tests for the /health endpoint."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app

client = TestClient(app)


def test_health_endpoint_returns_200():
    """Health endpoint should always return 200 with status ok."""
    with patch("main.subprocess.run"):
        response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_health_endpoint_includes_version():
    """Health endpoint should include the version string."""
    with patch("main.subprocess.run"):
        response = client.get("/health")
    data = response.json()
    assert isinstance(data["version"], str)
    assert len(data["version"]) > 0


def test_health_endpoint_openfoam_available():
    """When OpenFOAM is available, openfoam should be True."""
    with patch("main.subprocess.run") as mock_run:
        mock_run.return_value = None  # success
        response = client.get("/health")
    data = response.json()
    assert data["openfoam"] is True


def test_health_endpoint_openfoam_unavailable():
    """When OpenFOAM is not available, openfoam should be False."""
    with patch("main.subprocess.run", side_effect=FileNotFoundError):
        response = client.get("/health")
    data = response.json()
    assert data["status"] == "ok"
    assert data["openfoam"] is False
