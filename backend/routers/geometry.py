"""Geometry upload and auto-configuration endpoints."""

from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import struct
import subprocess
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services.config_generator import (
    ensure_patches_in_bc_files,
    generate_block_mesh_dict,
    generate_decompose_par_dict,
    generate_snappy_hex_mesh_dict,
    generate_surface_feature_extract_dict,
    scale_stl,
    stl_bounds,
    transform_stl,
)
from services.foam_runner import FOAM_CORES, FOAM_RUN, FOAM_TEMPLATES, validate_case_path
from services.field_parser import (
    discover_available_fields,
    discover_time_directories,
    extract_boundary_field_data,
    resolve_time,
    slice_field,
)
from services.foam_runner import list_jobs
from services.parsers import AeroResults, MeshQuality, parse_check_mesh, parse_force_coeffs

router = APIRouter(prefix="/cases", tags=["geometry"])

_VALID_CASE_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_ALLOWED_EXTENSIONS = {".stl", ".obj"}


# ---------------------------------------------------------------------------
# POST /cases/{name}/upload-geometry
# ---------------------------------------------------------------------------

@router.post("/{name}/upload-geometry")
async def upload_geometry(
    name: str,
    file: UploadFile = File(...),
    scale: float = Form(1.0),
    template: str = Form("motorBike"),
):
    """Upload an STL/OBJ file, scaffold the case, and auto-generate mesh dicts.

    ``scale`` converts geometry coordinates to meters.  Pass 0.001 for
    millimetres, 0.0254 for inches, etc.  The STL vertices are rewritten
    on disk so that every downstream tool sees metre-scale geometry.

    ``template`` selects which template's physics to use as scaffold.
    Each template has its own boundary conditions, force directions,
    and domain type (ground_vehicle vs freestream).
    """

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

    # -- Load template physics from template.json --
    template_dir = Path(FOAM_TEMPLATES) / template
    if not template_dir.is_dir():
        # Fall back to motorBike if requested template doesn't exist
        template_dir = Path(FOAM_TEMPLATES) / "motorBike"

    physics: dict = {}
    meta_file = template_dir / "template.json"
    if meta_file.is_file():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            physics = meta.get("physics", {})
        except (json.JSONDecodeError, OSError):
            pass

    domain_type = physics.get("domain_type", "ground_vehicle")
    patch_group = physics.get("patchGroup", "motorBikeGroup")

    # -- Copy scaffold from template (system/, 0/ directories) --
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

    # -- Rename template patch references to match uploaded geometry --
    # The template uses its own patchGroup (e.g. "raceCarGroup") but
    # snappyHexMesh will create "{stem}Group" based on the uploaded filename.
    stl_stem = Path(file.filename).stem  # e.g. "Ahmed" from "Ahmed.stl"
    new_group = f"{stl_stem}Group"
    if new_group != patch_group:
        for search_dir in [dst_zero, dst_system]:
            if not search_dir.is_dir():
                continue
            for foam_file_path in search_dir.rglob("*"):
                if not foam_file_path.is_file() or foam_file_path.name.startswith("."):
                    continue
                try:
                    text = foam_file_path.read_text(encoding="utf-8")
                    if patch_group in text:
                        text = text.replace(patch_group, new_group)
                        foam_file_path.write_text(text, encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    pass  # skip binary or unreadable files

    # Copy constant/ directory (transport/turbulence properties, triSurface/)
    src_const = template_dir / "constant"
    dst_const = case_path / "constant"
    if src_const.is_dir() and not dst_const.exists():
        shutil.copytree(str(src_const), str(dst_const))

    # Ensure constant/triSurface/ exists
    tri_surface_dir = case_path / "constant" / "triSurface"
    tri_surface_dir.mkdir(parents=True, exist_ok=True)

    # -- Save uploaded geometry file (scaled to meters if needed) --
    dest_file = tri_surface_dir / file.filename
    contents = await file.read()
    if ext == ".stl" and abs(scale - 1.0) > 1e-12:
        contents = scale_stl(contents, scale)
    dest_file.write_bytes(contents)

    # -- Create .foam file for ParaView (empty marker file) --
    foam_file = case_path / f"{name}.foam"
    if not foam_file.exists():
        foam_file.touch()

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

        block_mesh_dict = generate_block_mesh_dict(bbox, file.filename, domain_type)
        (system_dir / "blockMeshDict").write_text(block_mesh_dict, encoding="utf-8")

        snappy_dict = generate_snappy_hex_mesh_dict(bbox, file.filename, domain_type)
        (system_dir / "snappyHexMeshDict").write_text(snappy_dict, encoding="utf-8")

        sfe_dict = generate_surface_feature_extract_dict(file.filename)
        (system_dir / "surfaceFeatureExtractDict").write_text(sfe_dict, encoding="utf-8")

        # Generate decomposeParDict for parallel runs
        if FOAM_CORES > 1:
            decompose_dict = generate_decompose_par_dict(FOAM_CORES)
            (system_dir / "decomposeParDict").write_text(decompose_dict, encoding="utf-8")

        # Ensure all blockMesh patches have boundary condition entries
        ensure_patches_in_bc_files(case_path / "0")

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
# POST /cases/{name}/transform-geometry
# ---------------------------------------------------------------------------


class TransformRequest(BaseModel):
    rotate_x: float = 0.0
    rotate_y: float = 0.0
    rotate_z: float = 0.0
    translate_x: float = 0.0
    translate_y: float = 0.0
    translate_z: float = 0.0


@router.post("/{name}/transform-geometry")
async def transform_geometry(name: str, req: TransformRequest):
    """Rotate and/or translate the uploaded STL geometry, then regenerate mesh dicts.

    Rotation is in degrees (XYZ Euler order), translation in meters.
    The STL file is rewritten on disk and new bounding-box-based configs
    are regenerated.
    """
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    tri_dir = case_path / "constant" / "triSurface"
    if not tri_dir.is_dir():
        raise HTTPException(status_code=404, detail="No triSurface directory")

    # Find the STL file
    stl_files = [f for f in tri_dir.glob("*.stl") if not f.name.endswith(".gz")]
    if not stl_files:
        raise HTTPException(status_code=404, detail="No STL file found in triSurface/")

    stl_file = stl_files[0]
    raw = stl_file.read_bytes()

    # Apply transform
    transformed = transform_stl(
        raw,
        rotate_x=req.rotate_x,
        rotate_y=req.rotate_y,
        rotate_z=req.rotate_z,
        translate_x=req.translate_x,
        translate_y=req.translate_y,
        translate_z=req.translate_z,
    )
    stl_file.write_bytes(transformed)

    # Re-parse bounds
    try:
        bbox = stl_bounds(stl_file)
    except (ValueError, struct.error) as exc:
        raise HTTPException(status_code=422, detail=f"Failed to parse transformed STL: {exc}")

    # Detect domain_type from template.json if available
    domain_type = "ground_vehicle"
    meta_file = case_path / "template.json"
    if not meta_file.is_file():
        # Check in the template dirs
        for tpl_dir in Path(FOAM_TEMPLATES).iterdir():
            tj = tpl_dir / "template.json"
            if tj.is_file():
                try:
                    meta = json.loads(tj.read_text(encoding="utf-8"))
                    # Can't easily tell which template was used — keep default
                except (json.JSONDecodeError, OSError):
                    pass

    # Regenerate mesh dicts
    system_dir = case_path / "system"
    system_dir.mkdir(parents=True, exist_ok=True)

    block_mesh_dict = generate_block_mesh_dict(bbox, stl_file.name, domain_type)
    (system_dir / "blockMeshDict").write_text(block_mesh_dict, encoding="utf-8")

    snappy_dict = generate_snappy_hex_mesh_dict(bbox, stl_file.name, domain_type)
    (system_dir / "snappyHexMeshDict").write_text(snappy_dict, encoding="utf-8")

    sfe_dict = generate_surface_feature_extract_dict(stl_file.name)
    (system_dir / "surfaceFeatureExtractDict").write_text(sfe_dict, encoding="utf-8")

    return {
        "filename": stl_file.name,
        "triangles": bbox.num_triangles,
        "bounds": {
            "min": [bbox.min_x, bbox.min_y, bbox.min_z],
            "max": [bbox.max_x, bbox.max_y, bbox.max_z],
        },
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


# ---------------------------------------------------------------------------
# GET /cases/{name}/geometry-file
# ---------------------------------------------------------------------------

@router.get("/{name}/geometry-file")
async def serve_geometry_file(name: str):
    """Serve the geometry file (STL/OBJ) from constant/triSurface/.

    Automatically decompresses .gz files if needed.
    """
    case_path = Path(validate_case_path(name))
    tri_dir = case_path / "constant" / "triSurface"
    if not tri_dir.is_dir():
        raise HTTPException(status_code=404, detail="No triSurface directory")

    # Search for geometry files in priority order
    for ext in ("*.stl", "*.obj"):
        matches = [f for f in tri_dir.glob(ext) if not f.name.endswith(".gz")]
        if matches:
            geo_file = matches[0]
            media = "model/stl" if geo_file.suffix == ".stl" else "text/plain"
            return FileResponse(str(geo_file), media_type=media, filename=geo_file.name)

    # Try .gz compressed files
    for ext in ("*.stl.gz", "*.obj.gz"):
        matches = list(tri_dir.glob(ext))
        if matches:
            gz_file = matches[0]
            # Decompress to sibling path (strip .gz)
            decompressed = gz_file.with_suffix("")  # e.g. motorBike.obj.gz -> motorBike.obj
            if not decompressed.exists():
                with gzip.open(gz_file, "rb") as f_in:
                    decompressed.write_bytes(f_in.read())
            media = "model/stl" if decompressed.suffix == ".stl" else "text/plain"
            return FileResponse(str(decompressed), media_type=media, filename=decompressed.name)

    raise HTTPException(status_code=404, detail="No geometry file found in triSurface/")


# ---------------------------------------------------------------------------
# GET /cases/{name}/field-data
# ---------------------------------------------------------------------------


@router.get("/{name}/field-data")
async def field_data(name: str, field: str = "p", time: str = "latest"):
    """Serve mesh geometry + field values for 3D visualization.

    Returns boundary faces only (surface mesh) with interpolated field values
    at vertices.  For vector fields (e.g. U) the magnitude is returned in
    ``values`` and the raw vectors in ``vectors``.
    """
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    # Resolve the requested time directory
    all_times = discover_time_directories(case_path)
    try:
        resolved_time = resolve_time(case_path, time)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"No time directories found in case '{name}'. "
            f"Has the solver run and completed reconstructPar? "
            f"Case path: {case_path}. Dirs found: {[d.name for d in case_path.iterdir() if d.is_dir()][:20]}",
        )

    # Check that the requested field exists
    available_fields = discover_available_fields(case_path, resolved_time)
    if field not in available_fields:
        raise HTTPException(
            status_code=404,
            detail=f"Field '{field}' not found in time directory '{resolved_time}'. "
            f"Available fields: {available_fields}. All time dirs: {all_times}",
        )

    # Extract boundary mesh + field data
    try:
        data = extract_boundary_field_data(case_path, resolved_time, field)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # Check for active jobs on this case
    warning = None
    for job in list_jobs():
        if job.case_name == name and job.status in ("queued", "running"):
            warning = "Simulation still running \u2014 results may be incomplete"
            break

    return {
        **data,
        "available_fields": available_fields,
        "available_times": discover_time_directories(case_path),
        "warning": warning,
    }


# ---------------------------------------------------------------------------
# GET /cases/{name}/slice
# ---------------------------------------------------------------------------


@router.get("/{name}/slice")
async def get_slice(
    name: str,
    field: str = "p",
    time: str = "latest",
    axis: str = "x",
    position: float = 0.0,
):
    """Compute a slice plane through the mesh."""
    case_dir = os.path.join(FOAM_RUN, name)
    if not os.path.isdir(case_dir):
        raise HTTPException(404, f"Case not found: {name}")

    try:
        time_dir = resolve_time(case_dir, time)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(404, str(e))

    if axis.lower() not in ("x", "y", "z"):
        raise HTTPException(400, f"Invalid axis: {axis}. Must be x, y, or z.")

    try:
        result = slice_field(case_dir, time_dir, field, axis, position)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))

    return result
