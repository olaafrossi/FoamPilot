"""Aerodynamic intelligence endpoints — geometry classification,
mesh/physics/solver suggestions, y+ calculator, Reynolds number."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from services.config_generator import stl_bounds
from services.foam_runner import validate_case_path
from services.geometry import classify_geometry, GeometryClass
from services.aero_suggestions import (
    AeroSuggestions,
    calc_reynolds,
    calc_y_plus,
    suggest_parameters,
)

router = APIRouter(prefix="/cases", tags=["suggestions"])


# ---------------------------------------------------------------------------
# GET /cases/{name}/classify
# ---------------------------------------------------------------------------

@router.get("/{name}/classify")
async def classify(name: str):
    """Classify the geometry in the case and return analysis."""
    case_path = Path(validate_case_path(name))
    stl_path = _find_stl(case_path)

    bbox = stl_bounds(stl_path)
    analysis = classify_geometry(bbox)

    return {
        "geometry_class": analysis.geometry_class.value,
        "characteristic_length": analysis.characteristic_length,
        "frontal_area": analysis.frontal_area,
        "wetted_area_estimate": analysis.wetted_area_estimate,
        "aspect_ratio": analysis.aspect_ratio,
        "description": analysis.description,
        "warning": analysis.warning,
    }


# ---------------------------------------------------------------------------
# GET /cases/{name}/suggest
# ---------------------------------------------------------------------------

@router.get("/{name}/suggest")
async def suggest(
    name: str,
    velocity: float = Query(20.0, ge=0, description="Freestream velocity in m/s"),
    geometry_class: str | None = Query(None, description="Override geometry class"),
):
    """Return full parameter suggestions for mesh, physics, solver, convergence."""
    case_path = Path(validate_case_path(name))
    stl_path = _find_stl(case_path)

    bbox = stl_bounds(stl_path)
    analysis = classify_geometry(bbox)

    # Allow manual override of geometry class
    if geometry_class and geometry_class in GeometryClass.__members__:
        analysis.geometry_class = GeometryClass(geometry_class)

    suggestions = suggest_parameters(analysis, velocity)

    return {
        "geometry": {
            "geometry_class": analysis.geometry_class.value,
            "characteristic_length": analysis.characteristic_length,
            "frontal_area": analysis.frontal_area,
            "aspect_ratio": analysis.aspect_ratio,
            "description": analysis.description,
            "warning": analysis.warning,
        },
        "mesh": {
            "domain_multiplier_upstream": suggestions.mesh.domain_multiplier_upstream,
            "domain_multiplier_downstream": suggestions.mesh.domain_multiplier_downstream,
            "domain_multiplier_side": suggestions.mesh.domain_multiplier_side,
            "domain_multiplier_top": suggestions.mesh.domain_multiplier_top,
            "surface_refinement_min": suggestions.mesh.surface_refinement_min,
            "surface_refinement_max": suggestions.mesh.surface_refinement_max,
            "feature_level": suggestions.mesh.feature_level,
            "region_refinement_level": suggestions.mesh.region_refinement_level,
            "n_surface_layers": suggestions.mesh.n_surface_layers,
            "expansion_ratio": suggestions.mesh.expansion_ratio,
            "first_layer_height": suggestions.mesh.first_layer_height,
            "y_plus_target": suggestions.mesh.y_plus_target,
            "estimated_cells": suggestions.mesh.estimated_cells,
            "rationale": suggestions.mesh.rationale,
        },
        "physics": {
            "reynolds_number": suggestions.physics.reynolds_number,
            "turbulence_model": suggestions.physics.turbulence_model,
            "turbulence_model_rationale": suggestions.physics.turbulence_model_rationale,
            "freestream_k": suggestions.physics.freestream_k,
            "freestream_omega": suggestions.physics.freestream_omega,
            "freestream_nut": suggestions.physics.freestream_nut,
            "inlet_velocity": list(suggestions.physics.inlet_velocity),
        },
        "solver": {
            "solver_name": suggestions.solver.solver_name,
            "end_time": suggestions.solver.end_time,
            "write_interval": suggestions.solver.write_interval,
            "convergence_target": suggestions.solver.convergence_target,
            "rationale": suggestions.solver.rationale,
        },
        "convergence": {
            "expected_iterations": suggestions.convergence.expected_iterations,
            "confidence": suggestions.convergence.confidence,
            "risk_factors": suggestions.convergence.risk_factors,
            "status": suggestions.convergence.status,
        },
    }


# ---------------------------------------------------------------------------
# GET /cases/{name}/y-plus
# ---------------------------------------------------------------------------

@router.get("/{name}/y-plus")
async def y_plus_calculator(
    name: str,
    velocity: float = Query(20.0, ge=0),
    y_plus_target: float = Query(30.0, ge=1),
):
    """Calculate first cell height for a target y+."""
    case_path = Path(validate_case_path(name))
    stl_path = _find_stl(case_path)

    bbox = stl_bounds(stl_path)
    analysis = classify_geometry(bbox)

    result = calc_y_plus(velocity, analysis.characteristic_length, y_plus_target)
    result["characteristic_length"] = analysis.characteristic_length
    return result


# ---------------------------------------------------------------------------
# GET /cases/{name}/reynolds
# ---------------------------------------------------------------------------

@router.get("/{name}/reynolds")
async def reynolds_number(
    name: str,
    velocity: float = Query(20.0, ge=0),
):
    """Calculate Reynolds number for the geometry."""
    case_path = Path(validate_case_path(name))
    stl_path = _find_stl(case_path)

    bbox = stl_bounds(stl_path)
    analysis = classify_geometry(bbox)
    re = calc_reynolds(velocity, analysis.characteristic_length)

    regime = "laminar" if re < 5e5 else "transitional" if re < 1e6 else "turbulent"

    return {
        "reynolds_number": re,
        "velocity": velocity,
        "characteristic_length": analysis.characteristic_length,
        "kinematic_viscosity": 1.46e-5,
        "regime": regime,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_stl(case_path: Path) -> Path:
    """Find the STL file in a case's constant/triSurface/ directory."""
    tri_dir = case_path / "constant" / "triSurface"
    if not tri_dir.is_dir():
        raise HTTPException(status_code=404, detail="No triSurface directory — upload geometry first")

    # Look for uncompressed STL first
    for f in tri_dir.iterdir():
        if f.suffix.lower() == ".stl" and not f.name.endswith(".gz"):
            return f

    # Try compressed
    import gzip
    for f in tri_dir.iterdir():
        if f.name.lower().endswith(".stl.gz"):
            decompressed = f.with_suffix("")
            if not decompressed.exists():
                with gzip.open(f, "rb") as fin:
                    decompressed.write_bytes(fin.read())
            return decompressed

    raise HTTPException(status_code=404, detail="No STL file found in triSurface/")
