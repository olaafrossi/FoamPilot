"""Geometry upload and auto-configuration endpoints."""

from __future__ import annotations

import os
import re
import shutil
import struct
import subprocess
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from services.config_generator import (
    generate_block_mesh_dict,
    generate_decompose_par_dict,
    generate_snappy_hex_mesh_dict,
    generate_surface_feature_extract_dict,
    stl_bounds,
)
from services.foam_runner import FOAM_CORES, FOAM_RUN, FOAM_TEMPLATES, validate_case_path
from services.parsers import AeroResults, MeshQuality, parse_check_mesh, parse_force_coeffs

router = APIRouter(prefix="/cases", tags=["geometry"])

_VALID_CASE_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_ALLOWED_EXTENSIONS = {".stl", ".obj"}


# ---------------------------------------------------------------------------
# POST /cases/{name}/upload-geometry
# ---------------------------------------------------------------------------

@router.post("/{name}/upload-geometry")
async def upload_geometry(name: str, file: UploadFile = File(...)):
    """Upload an STL/OBJ file, scaffold the case, and auto-generate mesh dicts."""

    # -- Validate case name --
    if not _VALID_CASE_RE.match(name):
        raise HTTPException(status_code=400, detail="Case name must be alphanumeric, hyphens, or underscores")

    # -- Validate file extension --
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(_ALLOWED_EXTENSIONS))}",
        )

    # -- Create case directory --
    case_path = Path(validate_case_path(name))
    case_path.mkdir(parents=True, exist_ok=True)

    # -- Copy scaffold from motorBike template (system/, 0/ directories) --
    template_dir = Path(FOAM_TEMPLATES) / "motorBike"

    # Copy system/ directory (controlDict, fvSchemes, fvSolution, meshQualityDict, etc.)
    src_system = template_dir / "system"
    dst_system = case_path / "system"
    if src_system.is_dir() and not dst_system.exists():
        shutil.copytree(str(src_system), str(dst_system))

    # Copy 0/ directory (boundary conditions)
    src_zero = template_dir / "0"
    dst_zero = case_path / "0"
    if src_zero.is_dir() and not dst_zero.exists():
        shutil.copytree(str(src_zero), str(dst_zero))

    # Copy constant/ directory (transport/turbulence properties, triSurface/)
    src_const = template_dir / "constant"
    dst_const = case_path / "constant"
    if src_const.is_dir() and not dst_const.exists():
        shutil.copytree(str(src_const), str(dst_const))

    # Ensure constant/triSurface/ exists
    tri_surface_dir = case_path / "constant" / "triSurface"
    tri_surface_dir.mkdir(parents=True, exist_ok=True)

    # -- Save uploaded geometry file --
    dest_file = tri_surface_dir / file.filename
    contents = await file.read()
    dest_file.write_bytes(contents)

    # -- Parse STL bounds (only for .stl files) --
    if ext == ".stl":
        try:
            bbox = stl_bounds(dest_file)
        except (ValueError, struct.error) as exc:
            raise HTTPException(status_code=422, detail=f"Failed to parse STL: {exc}")

        # Check for degenerate geometry
        if bbox.size_x < 0.001 or bbox.size_y < 0.001 or bbox.size_z < 0.001:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Degenerate geometry: dimensions ({bbox.size_x:.6f}, "
                    f"{bbox.size_y:.6f}, {bbox.size_z:.6f}) — "
                    "each dimension must be >= 0.001"
                ),
            )

        # -- Generate and write OpenFOAM dict files --
        system_dir = case_path / "system"
        system_dir.mkdir(parents=True, exist_ok=True)

        block_mesh_dict = generate_block_mesh_dict(bbox, file.filename)
        (system_dir / "blockMeshDict").write_text(block_mesh_dict, encoding="utf-8")

        snappy_dict = generate_snappy_hex_mesh_dict(bbox, file.filename)
        (system_dir / "snappyHexMeshDict").write_text(snappy_dict, encoding="utf-8")

        sfe_dict = generate_surface_feature_extract_dict(file.filename)
        (system_dir / "surfaceFeatureExtractDict").write_text(sfe_dict, encoding="utf-8")

        # Generate decomposeParDict for parallel runs
        if FOAM_CORES > 1:
            decompose_dict = generate_decompose_par_dict(FOAM_CORES)
            (system_dir / "decomposeParDict").write_text(decompose_dict, encoding="utf-8")

        return {
            "filename": file.filename,
            "triangles": bbox.num_triangles,
            "bounds": {
                "min": [bbox.min_x, bbox.min_y, bbox.min_z],
                "max": [bbox.max_x, bbox.max_y, bbox.max_z],
            },
            "case_path": str(case_path),
        }

    # For .obj files we cannot parse bounds, just return file info
    return {
        "filename": file.filename,
        "triangles": None,
        "bounds": None,
        "case_path": str(case_path),
    }


# ---------------------------------------------------------------------------
# GET /cases/{name}/mesh-quality
# ---------------------------------------------------------------------------

@router.get("/{name}/mesh-quality")
async def mesh_quality(name: str):
    """Run checkMesh on the case and return structured quality metrics."""
    case_path = validate_case_path(name)
    if not os.path.isdir(case_path):
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    try:
        proc = subprocess.run(
            ["bash", "-lc", f"cd {case_path} && checkMesh"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        output = proc.stdout + "\n" + proc.stderr
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="checkMesh timed out")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="bash not available")

    result = parse_check_mesh(output)
    return {
        "cells": result.cells,
        "faces": result.faces,
        "points": result.points,
        "max_non_orthogonality": result.max_non_orthogonality,
        "max_skewness": result.max_skewness,
        "max_aspect_ratio": result.max_aspect_ratio,
        "ok": result.ok,
        "errors": result.errors,
    }


# ---------------------------------------------------------------------------
# GET /cases/{name}/results
# ---------------------------------------------------------------------------

@router.get("/{name}/results")
async def case_results(name: str):
    """Parse forceCoeffs output and return aerodynamic results."""
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    # Look for forceCoeffs.dat in postProcessing/
    post_dir = case_path / "postProcessing"
    result = AeroResults()

    if post_dir.is_dir():
        # Search for forceCoeffs output — typical path:
        # postProcessing/forceCoeffs/<timeDir>/forceCoeffs.dat
        for dat_file in sorted(post_dir.rglob("forceCoeffs.dat")):
            result = parse_force_coeffs(str(dat_file))
            break  # Use the first match

    return {
        "cd": result.cd,
        "cl": result.cl,
        "cm": result.cm,
        "cd_pressure": result.cd_pressure,
        "cd_viscous": result.cd_viscous,
        "iterations": result.iterations,
        "wall_time_seconds": result.wall_time_seconds,
        "converged": result.converged,
    }
