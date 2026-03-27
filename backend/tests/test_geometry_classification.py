"""Tests for geometry classification and aero suggestions services."""

from __future__ import annotations

import math
import struct
from pathlib import Path

import pytest

from services.config_generator import BoundingBox, stl_bounds
from services.geometry import GeometryClass, classify_geometry
from services.aero_suggestions import (
    calc_reynolds,
    calc_y_plus,
    suggest_parameters,
)


# ---------------------------------------------------------------------------
# Geometry classification tests
# ---------------------------------------------------------------------------


class TestClassifyGeometry:
    def test_streamlined_high_aspect_ratio(self):
        """Wing-like geometry (AR > 4) → streamlined."""
        bbox = BoundingBox(
            min_x=0, min_y=0, min_z=0,
            max_x=10.0, max_y=0.5, max_z=0.1,
            num_triangles=5000,
        )
        analysis = classify_geometry(bbox)
        assert analysis.geometry_class == GeometryClass.streamlined
        assert analysis.aspect_ratio > 4.0
        assert analysis.characteristic_length == 10.0
        assert analysis.warning is None

    def test_bluff_moderate_aspect_ratio(self):
        """Car-like geometry (AR 1.5–4) → bluff."""
        bbox = BoundingBox(
            min_x=0, min_y=-0.5, min_z=0,
            max_x=4.0, max_y=0.5, max_z=1.5,
            num_triangles=50000,
        )
        analysis = classify_geometry(bbox)
        assert analysis.geometry_class == GeometryClass.bluff
        assert 1.5 <= analysis.aspect_ratio <= 4.0

    def test_complex_low_aspect_ratio(self):
        """Cube-like geometry (AR < 1.5) → complex."""
        bbox = BoundingBox(
            min_x=0, min_y=0, min_z=0,
            max_x=1.0, max_y=1.0, max_z=1.0,
            num_triangles=1000,
        )
        analysis = classify_geometry(bbox)
        assert analysis.geometry_class == GeometryClass.complex
        assert analysis.aspect_ratio < 1.5

    def test_zero_thickness_flat_plate(self):
        """Flat plate (one dim < 0.001) → streamlined with warning."""
        bbox = BoundingBox(
            min_x=0, min_y=0, min_z=0,
            max_x=2.0, max_y=1.0, max_z=0.0005,
            num_triangles=100,
        )
        analysis = classify_geometry(bbox)
        assert analysis.geometry_class == GeometryClass.streamlined
        assert analysis.warning is not None
        assert "zero-thickness" in analysis.warning.lower()

    def test_zero_triangles(self):
        """0 triangles → complex with warning."""
        bbox = BoundingBox(
            min_x=0, min_y=0, min_z=0,
            max_x=1.0, max_y=1.0, max_z=1.0,
            num_triangles=0,
        )
        analysis = classify_geometry(bbox)
        assert analysis.geometry_class == GeometryClass.complex
        assert analysis.warning is not None

    def test_frontal_area_calculation(self):
        """Frontal area = Y × Z cross-section."""
        bbox = BoundingBox(
            min_x=0, min_y=-1.0, min_z=0,
            max_x=5.0, max_y=1.0, max_z=2.0,
            num_triangles=10000,
        )
        analysis = classify_geometry(bbox)
        assert analysis.frontal_area == pytest.approx(2.0 * 2.0, rel=0.01)

    def test_classification_from_real_stl(self, binary_stl_file):
        """End-to-end: parse STL → classify."""
        bbox = stl_bounds(binary_stl_file)
        analysis = classify_geometry(bbox)
        # 1-triangle STL spanning (0,0,0)→(1,1,0) is flat plate
        assert analysis.geometry_class in (GeometryClass.streamlined, GeometryClass.complex)


# ---------------------------------------------------------------------------
# y+ calculator tests
# ---------------------------------------------------------------------------


class TestYPlusCalculator:
    def test_typical_automotive(self):
        """20 m/s, 4m car → reasonable first cell height."""
        result = calc_y_plus(velocity=20.0, char_length=4.0, y_plus_target=30.0)
        assert result["first_cell_height"] is not None
        assert result["first_cell_height"] > 0
        assert result["re"] > 1e6  # high Re for 4m car at 20 m/s
        assert result["message"] is None

    def test_zero_velocity(self):
        """Zero velocity → no calculation possible."""
        result = calc_y_plus(velocity=0.0, char_length=1.0)
        assert result["first_cell_height"] is None
        assert "velocity" in result["message"].lower()

    def test_very_low_re(self):
        """Very low Re (< 100) → Re too low message."""
        result = calc_y_plus(velocity=0.001, char_length=0.001)
        assert result["first_cell_height"] is None
        assert "re too low" in result["message"].lower()

    def test_higher_yplus_gives_larger_cell(self):
        """Higher y+ target → larger first cell height."""
        result_30 = calc_y_plus(velocity=20.0, char_length=1.0, y_plus_target=30)
        result_100 = calc_y_plus(velocity=20.0, char_length=1.0, y_plus_target=100)
        assert result_100["first_cell_height"] > result_30["first_cell_height"]


# ---------------------------------------------------------------------------
# Reynolds number tests
# ---------------------------------------------------------------------------


class TestReynolds:
    def test_basic_calculation(self):
        """Re = U*L/nu, air at 20 m/s over 1m → ~1.37M."""
        re = calc_reynolds(20.0, 1.0)
        assert 1e6 < re < 2e6

    def test_zero_velocity(self):
        re = calc_reynolds(0.0, 1.0)
        assert re == 0.0

    def test_zero_length(self):
        re = calc_reynolds(20.0, 0.0)
        assert re == 0.0


# ---------------------------------------------------------------------------
# Full suggestion pipeline tests
# ---------------------------------------------------------------------------


class TestSuggestParameters:
    def test_bluff_body_suggestions(self):
        """Bluff body at 20 m/s → standard settings."""
        bbox = BoundingBox(
            min_x=0, min_y=-0.5, min_z=0,
            max_x=4.0, max_y=0.5, max_z=1.5,
            num_triangles=50000,
        )
        analysis = classify_geometry(bbox)
        suggestions = suggest_parameters(analysis, velocity=20.0)

        assert suggestions.mesh.n_surface_layers == 5
        assert suggestions.mesh.expansion_ratio == pytest.approx(1.2)
        assert suggestions.physics.turbulence_model == "kOmegaSST"
        assert suggestions.physics.reynolds_number > 0
        assert suggestions.solver.solver_name == "simpleFoam"
        assert suggestions.convergence.confidence in ("low", "medium", "high")

    def test_streamlined_gets_more_layers(self):
        """Streamlined body → more boundary layers."""
        bbox = BoundingBox(
            min_x=0, min_y=0, min_z=0,
            max_x=10.0, max_y=0.5, max_z=0.1,
            num_triangles=5000,
        )
        analysis = classify_geometry(bbox)
        suggestions = suggest_parameters(analysis, velocity=30.0)

        assert suggestions.mesh.n_surface_layers >= 8
        assert suggestions.mesh.surface_refinement_max >= 7

    def test_complex_geometry_low_confidence(self):
        """Complex geometry → low convergence confidence."""
        bbox = BoundingBox(
            min_x=0, min_y=0, min_z=0,
            max_x=1.0, max_y=1.0, max_z=1.0,
            num_triangles=100,
        )
        analysis = classify_geometry(bbox)
        suggestions = suggest_parameters(analysis, velocity=20.0)

        assert suggestions.convergence.confidence == "low"
        assert len(suggestions.convergence.risk_factors) > 0

    def test_freestream_k_positive(self):
        """Freestream k should always be positive for nonzero velocity."""
        bbox = BoundingBox(
            min_x=0, min_y=-0.5, min_z=0,
            max_x=4.0, max_y=0.5, max_z=1.5,
            num_triangles=50000,
        )
        analysis = classify_geometry(bbox)
        suggestions = suggest_parameters(analysis, velocity=20.0)

        assert suggestions.physics.freestream_k > 0
        assert suggestions.physics.freestream_omega > 0
