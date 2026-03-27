"""Tests for the /health endpoint."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_health_endpoint_returns_200(client):
    """Health endpoint should always return 200 with status and version."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_health_endpoint_includes_openfoam_status(client):
    """Health endpoint should report OpenFOAM availability."""
    response = client.get("/health")
    data = response.json()
    assert "openfoam" in data
    assert isinstance(data["openfoam"], bool)


def test_health_version_from_env(client, monkeypatch):
    """Version should be read from FOAMPILOT_VERSION env var when set."""
    monkeypatch.setenv("FOAMPILOT_VERSION", "2.5.0")
    response = client.get("/health")
    data = response.json()
    assert data["version"] == "2.5.0"
