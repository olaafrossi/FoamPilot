"""Tests for services.parsers — checkMesh, forceCoeffs, and residual parsing."""

from __future__ import annotations

from pathlib import Path

import pytest

from services.parsers import (
    AeroResults,
    MeshQuality,
    parse_check_mesh,
    parse_force_coeffs,
    parse_residual_line,
)


# ---------------------------------------------------------------------------
# checkMesh parser
# ---------------------------------------------------------------------------


class TestParseCheckMeshOk:
    def test_parse_check_mesh_ok(self, check_mesh_output_ok):
        """Sample checkMesh with 'Mesh OK.' -- verify cells/faces/points extracted."""
        result = parse_check_mesh(check_mesh_output_ok)

        assert result.ok is True
        assert result.cells == 2100000
        assert result.faces == 6350000
        assert result.points == 2200000
        assert result.max_non_orthogonality == pytest.approx(65.2)
        assert result.max_skewness == pytest.approx(2.1)
        assert result.max_aspect_ratio == pytest.approx(12.5)
        assert result.errors == []


class TestParseCheckMeshErrors:
    def test_parse_check_mesh_errors(self, check_mesh_output_errors):
        """Sample with mesh errors, verify ok=False and errors collected."""
        result = parse_check_mesh(check_mesh_output_errors)

        assert result.ok is False
        assert result.cells == 500000
        assert result.faces == 1500000
        assert result.points == 600000
        assert result.max_non_orthogonality == pytest.approx(89.5)
        assert result.max_skewness == pytest.approx(8.3)
        assert result.max_aspect_ratio == pytest.approx(45.2)
        # Should have captured the *** error lines
        assert len(result.errors) == 2
        assert any("non-orthogonal" in e.lower() for e in result.errors)
        assert any("pyramids" in e.lower() for e in result.errors)


class TestParseCheckMeshEmpty:
    def test_parse_check_mesh_empty(self):
        """Empty string yields defaults."""
        result = parse_check_mesh("")

        assert result.ok is False  # no "Mesh OK." found
        assert result.cells == 0
        assert result.faces == 0
        assert result.points == 0
        assert result.max_non_orthogonality == 0.0
        assert result.max_skewness == 0.0
        assert result.max_aspect_ratio == 0.0


# ---------------------------------------------------------------------------
# forceCoeffs parser
# ---------------------------------------------------------------------------


class TestParseForceCoeffs:
    def test_parse_force_coeffs(self, tmp_path, force_coeffs_content):
        """Sample forceCoeffs.dat with 4 data lines, verify last-line Cd/Cl."""
        fc_path = tmp_path / "forceCoeffs.dat"
        fc_path.write_text(force_coeffs_content, encoding="utf-8")

        result = parse_force_coeffs(str(fc_path))

        # Last data line: 500  0.4215  0.0005  0.0812
        assert result.cd == pytest.approx(0.4215)
        assert result.cl == pytest.approx(0.0812)
        assert result.iterations == 4  # 4 data lines (excluding comments)

    def test_parse_force_coeffs_empty(self, tmp_path):
        """Empty file yields None values."""
        fc_path = tmp_path / "empty_coeffs.dat"
        fc_path.write_text("", encoding="utf-8")

        result = parse_force_coeffs(str(fc_path))

        assert result.cd is None
        assert result.cl is None
        assert result.cm is None
        assert result.iterations == 0

    def test_parse_force_coeffs_nonexistent(self, tmp_path):
        """Non-existent file yields default AeroResults."""
        result = parse_force_coeffs(str(tmp_path / "does_not_exist.dat"))

        assert result.cd is None
        assert result.cl is None
        assert result.iterations == 0

    def test_parse_force_coeffs_comments_only(self, tmp_path):
        """File with only comment lines yields None values."""
        fc_path = tmp_path / "comments_only.dat"
        fc_path.write_text("# comment 1\n# comment 2\n", encoding="utf-8")

        result = parse_force_coeffs(str(fc_path))

        assert result.cd is None
        assert result.cl is None
        assert result.iterations == 0


# ---------------------------------------------------------------------------
# Residual line parser
# ---------------------------------------------------------------------------


class TestParseResidualLineValid:
    def test_parse_residual_line_valid(self):
        """Standard Ux residual line."""
        line = "Solving for Ux, Initial residual = 0.123, Final residual = 0.00456, No Iterations 7"
        result = parse_residual_line(line)

        assert result is not None
        assert result["field"] == "Ux"
        assert result["initial"] == pytest.approx(0.123)
        assert result["final"] == pytest.approx(0.00456)
        assert result["iterations"] == 7


class TestParseResidualLineInvalid:
    def test_parse_residual_line_invalid(self):
        """Random text returns None."""
        assert parse_residual_line("time step continuity errors : sum local = 1.23e-07") is None
        assert parse_residual_line("ExecutionTime = 42.5 s  ClockTime = 43 s") is None
        assert parse_residual_line("") is None
        assert parse_residual_line("some random log output") is None


class TestParseResidualLinePressure:
    def test_parse_residual_line_pressure(self):
        """Verify p field parsing works."""
        line = "Solving for p, Initial residual = 0.987, Final residual = 0.0001, No Iterations 120"
        result = parse_residual_line(line)

        assert result is not None
        assert result["field"] == "p"
        assert result["initial"] == pytest.approx(0.987)
        assert result["final"] == pytest.approx(0.0001)
        assert result["iterations"] == 120

    def test_parse_residual_line_scientific_notation(self):
        """Verify scientific notation in residuals."""
        line = "Solving for k, Initial residual = 1.5e-03, Final residual = 2.1e-06, No Iterations 3"
        result = parse_residual_line(line)

        assert result is not None
        assert result["field"] == "k"
        assert result["initial"] == pytest.approx(1.5e-03)
        assert result["final"] == pytest.approx(2.1e-06)
        assert result["iterations"] == 3
