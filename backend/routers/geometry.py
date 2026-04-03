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
    BoundingBox,
    GeometryEntry,
    MRFZoneConfig,
    ensure_patches_in_bc_files,
    generate_block_mesh_dict,
    generate_cylinder_stl,
    generate_decompose_par_dict,
    generate_mrf_properties,
    generate_snappy_hex_mesh_dict,
    generate_surface_feature_extract_dict,
    scale_stl,
    stl_bounds,
    stl_y_stats,
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


def _y_stats_dict(stl_path: Path) -> dict:
    """Return Y-axis stats as a JSON-serializable dict."""
    stats = stl_y_stats(stl_path)
    return {
        "min": stats.min_y,
        "max": stats.max_y,
        "bbox_center": stats.bbox_center,
        "centroid": stats.centroid,
        "median": stats.median,
    }
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

        entry = GeometryEntry(filename=file.filename, bbox=bbox, role="body")
        block_mesh_dict = generate_block_mesh_dict([entry], domain_type)
        (system_dir / "blockMeshDict").write_text(block_mesh_dict, encoding="utf-8")

        snappy_dict = generate_snappy_hex_mesh_dict([entry], domain_type)
        (system_dir / "snappyHexMeshDict").write_text(snappy_dict, encoding="utf-8")

        sfe_dict = generate_surface_feature_extract_dict([file.filename])
        (system_dir / "surfaceFeatureExtractDict").write_text(sfe_dict, encoding="utf-8")

        # Generate decomposeParDict for parallel runs
        if FOAM_CORES > 1:
            decompose_dict = generate_decompose_par_dict(FOAM_CORES)
            (system_dir / "decomposeParDict").write_text(decompose_dict, encoding="utf-8")

        # Ensure all blockMesh patches have boundary condition entries
        ensure_patches_in_bc_files(case_path / "0")

        # Write initial entry to geometries.json for multi-geometry support
        bbox_dict = {"min": [bbox.min_x, bbox.min_y, bbox.min_z], "max": [bbox.max_x, bbox.max_y, bbox.max_z]}
        geo_data = _read_geometries(case_path)
        if not any(g["filename"] == file.filename for g in geo_data.get("geometries", [])):
            geo_data["geometries"].append({
                "filename": file.filename,
                "role": "body",
                "refinement_min": 5,
                "refinement_max": 6,
                "bounds": bbox_dict,
            })
            _write_geometries(case_path, geo_data)

        return {
            "filename": file.filename,
            "triangles": bbox.num_triangles,
            "bounds": bbox_dict,
            "y_stats": _y_stats_dict(dest_file),
            "case_path": str(case_path),
        }

    # For .obj files we cannot parse bounds, just return file info
    # Write initial entry to geometries.json
    geo_data = _read_geometries(case_path)
    if not any(g["filename"] == file.filename for g in geo_data.get("geometries", [])):
        geo_data["geometries"].append({
            "filename": file.filename,
            "role": "body",
            "refinement_min": 5,
            "refinement_max": 6,
        })
        _write_geometries(case_path, geo_data)

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
    filename: str | None = None  # Target specific geometry; default: first STL
    rotate_x: float = 0.0
    rotate_y: float = 0.0
    rotate_z: float = 0.0
    translate_x: float = 0.0
    translate_y: float = 0.0
    translate_z: float = 0.0


@router.post("/{name}/transform-geometry")
async def transform_geometry(name: str, req: TransformRequest):
    """Rotate and/or translate a geometry STL, then regenerate mesh dicts.

    If ``filename`` is provided, transforms that specific geometry.
    Otherwise transforms the first STL found (backward compatible).
    Rotation is in degrees (XYZ Euler order), translation in meters.

    All geometries in the case receive the same transform so that parts
    exported from the same CAD origin stay aligned.
    """
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    tri_dir = case_path / "constant" / "triSurface"
    if not tri_dir.is_dir():
        raise HTTPException(status_code=404, detail="No triSurface directory")

    if req.filename:
        stl_file = tri_dir / req.filename
        if not stl_file.is_file():
            raise HTTPException(status_code=404, detail=f"Geometry '{req.filename}' not found")
    else:
        stl_files = [f for f in tri_dir.glob("*.stl") if not f.name.endswith(".gz")]
        if not stl_files:
            raise HTTPException(status_code=404, detail="No STL file found in triSurface/")
        stl_file = stl_files[0]

    # Apply the same transform to ALL geometries so parts from the same
    # CAD coordinate system stay aligned.
    geo_data = _read_geometries(case_path)
    all_stls = [tri_dir / g["filename"] for g in geo_data.get("geometries", [])
                if (tri_dir / g["filename"]).is_file()]
    if not all_stls:
        # Fallback: just the primary file (no geometries.json)
        all_stls = [stl_file]
    elif stl_file not in all_stls:
        all_stls.append(stl_file)

    for sf in all_stls:
        raw = sf.read_bytes()
        transformed = transform_stl(
            raw,
            rotate_x=req.rotate_x,
            rotate_y=req.rotate_y,
            rotate_z=req.rotate_z,
            translate_x=req.translate_x,
            translate_y=req.translate_y,
            translate_z=req.translate_z,
        )
        sf.write_bytes(transformed)

    # Re-parse bounds of the primary geometry for the response
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

    # Update bounds in geometries.json for all transformed STLs
    geo_data = _read_geometries(case_path)
    for sf in all_stls:
        try:
            sb = stl_bounds(sf)
            sb_dict = {"min": [sb.min_x, sb.min_y, sb.min_z], "max": [sb.max_x, sb.max_y, sb.max_z]}
            for g in geo_data.get("geometries", []):
                if g["filename"] == sf.name:
                    g["bounds"] = sb_dict
        except (ValueError, struct.error):
            pass
    _write_geometries(case_path, geo_data)

    # Regenerate mesh dicts from full geometry list (multi-STL aware)
    if geo_data.get("geometries"):
        _regenerate_all_dicts(case_path, geo_data, domain_type)
    else:
        # Fallback: single-geometry mode (no geometries.json)
        system_dir = case_path / "system"
        system_dir.mkdir(parents=True, exist_ok=True)
        entry = GeometryEntry(filename=stl_file.name, bbox=bbox, role="body")
        (system_dir / "blockMeshDict").write_text(generate_block_mesh_dict([entry], domain_type), encoding="utf-8")
        (system_dir / "snappyHexMeshDict").write_text(generate_snappy_hex_mesh_dict([entry], domain_type), encoding="utf-8")
        (system_dir / "surfaceFeatureExtractDict").write_text(generate_surface_feature_extract_dict([stl_file.name]), encoding="utf-8")

    return {
        "filename": stl_file.name,
        "triangles": bbox.num_triangles,
        "bounds": {
            "min": [bbox.min_x, bbox.min_y, bbox.min_z],
            "max": [bbox.max_x, bbox.max_y, bbox.max_z],
        },
        "y_stats": _y_stats_dict(stl_file),
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
async def serve_geometry_file(name: str, filename: str | None = None):
    """Serve a geometry file (STL/OBJ) from constant/triSurface/.

    If ``filename`` is provided, serves that specific file.
    Otherwise serves the first geometry found (backward compatible).
    Automatically decompresses .gz files if needed.
    """
    case_path = Path(validate_case_path(name))
    tri_dir = case_path / "constant" / "triSurface"
    if not tri_dir.is_dir():
        raise HTTPException(status_code=404, detail="No triSurface directory")

    # If specific filename requested, serve it directly
    if filename:
        target = tri_dir / filename
        if target.is_file():
            media = "model/stl" if target.suffix == ".stl" else "text/plain"
            return FileResponse(str(target), media_type=media, filename=target.name)
        # Try .gz version
        gz_target = tri_dir / f"{filename}.gz"
        if gz_target.is_file():
            decompressed = tri_dir / filename
            if not decompressed.exists():
                with gzip.open(gz_target, "rb") as f_in:
                    decompressed.write_bytes(f_in.read())
            media = "model/stl" if decompressed.suffix == ".stl" else "text/plain"
            return FileResponse(str(decompressed), media_type=media, filename=decompressed.name)
        raise HTTPException(status_code=404, detail=f"Geometry file '{filename}' not found")

    # Default: search for geometry files in priority order
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
            decompressed = gz_file.with_suffix("")
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
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"{type(exc).__name__}: {exc}",
        )

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


# ---------------------------------------------------------------------------
# Multi-geometry + MRF endpoints
# ---------------------------------------------------------------------------

def _geometries_path(case_path: Path) -> Path:
    """Path to the geometry list metadata file."""
    foampilot_dir = case_path / ".foampilot"
    foampilot_dir.mkdir(parents=True, exist_ok=True)
    return foampilot_dir / "geometries.json"


def _read_geometries(case_path: Path) -> dict:
    """Read geometries.json or return empty structure."""
    gpath = _geometries_path(case_path)
    if gpath.is_file():
        try:
            return json.loads(gpath.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"geometries": [], "mrf_zones": []}


def _write_geometries(case_path: Path, data: dict) -> None:
    """Write geometries.json."""
    gpath = _geometries_path(case_path)
    gpath.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _build_geometry_entries(case_path: Path, geo_data: dict) -> list[GeometryEntry]:
    """Build GeometryEntry list from geometries.json for dict generation."""
    tri_dir = case_path / "constant" / "triSurface"
    entries: list[GeometryEntry] = []
    for g in geo_data.get("geometries", []):
        stl_file = tri_dir / g["filename"]
        if not stl_file.is_file():
            continue
        try:
            bbox = stl_bounds(stl_file)
        except (ValueError, struct.error):
            continue
        entries.append(GeometryEntry(
            filename=g["filename"],
            bbox=bbox,
            role=g.get("role", "body"),
            refinement_min=g.get("refinement_min", 5),
            refinement_max=g.get("refinement_max", 6),
            zone_name=g.get("zone_name"),
        ))
    return entries


def _regenerate_all_dicts(case_path: Path, geo_data: dict, domain_type: str = "ground_vehicle") -> None:
    """Regenerate all OpenFOAM dict files from the geometry list."""
    entries = _build_geometry_entries(case_path, geo_data)
    if not entries:
        return

    system_dir = case_path / "system"
    system_dir.mkdir(parents=True, exist_ok=True)

    (system_dir / "blockMeshDict").write_text(
        generate_block_mesh_dict(entries, domain_type), encoding="utf-8"
    )
    (system_dir / "snappyHexMeshDict").write_text(
        generate_snappy_hex_mesh_dict(entries, domain_type), encoding="utf-8"
    )
    (system_dir / "surfaceFeatureExtractDict").write_text(
        generate_surface_feature_extract_dict([e.filename for e in entries]), encoding="utf-8"
    )

    # Generate MRFProperties if zones exist
    zones = geo_data.get("mrf_zones", [])
    full_model = len(zones) > 0
    if zones:
        mrf_configs = [
            MRFZoneConfig(
                name=z["name"],
                origin=tuple(z["origin"]),
                axis=tuple(z["axis"]),
                rpm=z["rpm"],
            )
            for z in zones
        ]
        const_dir = case_path / "constant"
        const_dir.mkdir(parents=True, exist_ok=True)
        (const_dir / "MRFProperties").write_text(
            generate_mrf_properties(mrf_configs), encoding="utf-8"
        )

    # Collect geometry-derived patch names (STL filenames without extension)
    geo_patches = [
        Path(e.filename).stem for e in entries
    ]

    # Update 0/ boundary conditions to match the generated blockMesh patches
    ensure_patches_in_bc_files(
        case_path / "0", full_model=full_model, geometry_patches=geo_patches
    )


@router.get("/{name}/geometries")
async def list_geometries(name: str):
    """List all geometries and MRF zones for a case."""
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")
    return _read_geometries(case_path)


@router.post("/{name}/add-geometry")
async def add_geometry(
    name: str,
    file: UploadFile = File(...),
    scale: float = Form(1.0),
    role: str = Form("body"),
    refinement_min: int = Form(5),
    refinement_max: int = Form(6),
):
    """Add an additional geometry to an existing case (no scaffolding)."""
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext}'")

    # Check for duplicate
    geo_data = _read_geometries(case_path)
    existing_names = {g["filename"] for g in geo_data.get("geometries", [])}
    if file.filename in existing_names:
        raise HTTPException(status_code=409, detail=f"Geometry '{file.filename}' already exists")

    # Save file
    tri_dir = case_path / "constant" / "triSurface"
    tri_dir.mkdir(parents=True, exist_ok=True)
    dest_file = tri_dir / file.filename
    contents = await file.read()
    if ext == ".stl" and abs(scale - 1.0) > 1e-12:
        contents = scale_stl(contents, scale)
    dest_file.write_bytes(contents)

    # Parse bounds
    bbox_dict = None
    triangles = None
    if ext == ".stl":
        try:
            bbox = stl_bounds(dest_file)
            bbox_dict = {"min": [bbox.min_x, bbox.min_y, bbox.min_z], "max": [bbox.max_x, bbox.max_y, bbox.max_z]}
            triangles = bbox.num_triangles
        except (ValueError, struct.error) as exc:
            raise HTTPException(status_code=422, detail=f"Failed to parse STL: {exc}")

    # Update geometries.json (include bounds so the frontend can compute MRF origin)
    entry: dict = {
        "filename": file.filename,
        "role": role,
        "refinement_min": refinement_min,
        "refinement_max": refinement_max,
    }
    if bbox_dict:
        entry["bounds"] = bbox_dict
    geo_data["geometries"].append(entry)
    _write_geometries(case_path, geo_data)

    # Regenerate dicts
    _regenerate_all_dicts(case_path, geo_data)

    return {"filename": file.filename, "triangles": triangles, "bounds": bbox_dict}


@router.delete("/{name}/geometry/{filename}")
async def remove_geometry(name: str, filename: str):
    """Remove a geometry from the case."""
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    geo_data = _read_geometries(case_path)
    original_len = len(geo_data.get("geometries", []))
    geo_data["geometries"] = [g for g in geo_data.get("geometries", []) if g["filename"] != filename]

    if len(geo_data["geometries"]) == original_len:
        raise HTTPException(status_code=404, detail=f"Geometry '{filename}' not found")

    # Remove associated MRF zones
    geo_data["mrf_zones"] = [z for z in geo_data.get("mrf_zones", []) if not any(
        g.get("mrf_zone") == z["name"] and g["filename"] == filename
        for g in [{"filename": filename, "mrf_zone": z["name"]}]
    )]

    # Delete file
    stl_file = case_path / "constant" / "triSurface" / filename
    if stl_file.is_file():
        stl_file.unlink()

    _write_geometries(case_path, geo_data)
    _regenerate_all_dicts(case_path, geo_data)

    return {"removed": filename}


class MRFZoneRequest(BaseModel):
    zone_name: str
    geometry: str  # filename of the rotating geometry
    origin: list[float]  # [x, y, z]
    axis: list[float]  # [ax, ay, az]
    rpm: float
    radius: float
    half_length: float


@router.post("/{name}/mrf-zones")
async def create_mrf_zone(name: str, req: MRFZoneRequest):
    """Create an MRF rotation zone with auto-generated cylinder STL."""
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    geo_data = _read_geometries(case_path)

    # Verify the associated geometry exists
    geo_names = {g["filename"] for g in geo_data.get("geometries", [])}
    if req.geometry not in geo_names:
        raise HTTPException(status_code=404, detail=f"Geometry '{req.geometry}' not found in case")

    # Generate cylinder STL
    try:
        cyl_bytes = generate_cylinder_stl(
            origin=tuple(req.origin),
            axis=tuple(req.axis),
            radius=req.radius,
            half_length=req.half_length,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Write cylinder STL
    tri_dir = case_path / "constant" / "triSurface"
    tri_dir.mkdir(parents=True, exist_ok=True)
    zone_filename = f"{req.zone_name}.stl"
    (tri_dir / zone_filename).write_bytes(cyl_bytes)

    # Parse cylinder bounds
    cyl_bbox = stl_bounds(tri_dir / zone_filename)

    # Update the rotating geometry entry
    for g in geo_data["geometries"]:
        if g["filename"] == req.geometry:
            g["role"] = "rotating"
            g["mrf_zone"] = req.zone_name
            break

    # Add zone geometry entry (if not already present)
    zone_geo_names = {g["filename"] for g in geo_data["geometries"]}
    if zone_filename not in zone_geo_names:
        geo_data["geometries"].append({
            "filename": zone_filename,
            "role": "zone",
            "refinement_min": 4,
            "refinement_max": 4,
            "zone_name": req.zone_name,
        })

    # Add/update MRF zone config
    geo_data["mrf_zones"] = [z for z in geo_data.get("mrf_zones", []) if z["name"] != req.zone_name]
    geo_data["mrf_zones"].append({
        "name": req.zone_name,
        "origin": req.origin,
        "axis": req.axis,
        "rpm": req.rpm,
        "radius": req.radius,
        "half_length": req.half_length,
    })

    _write_geometries(case_path, geo_data)
    _regenerate_all_dicts(case_path, geo_data)

    return {
        "zone_name": req.zone_name,
        "zone_stl": zone_filename,
        "omega": req.rpm * 2.0 * 3.141592653589793 / 60.0,
        "bounds": {"min": [cyl_bbox.min_x, cyl_bbox.min_y, cyl_bbox.min_z],
                   "max": [cyl_bbox.max_x, cyl_bbox.max_y, cyl_bbox.max_z]},
    }


@router.delete("/{name}/mrf-zones/{zone_name}")
async def delete_mrf_zone(name: str, zone_name: str):
    """Remove an MRF zone and its auto-generated cylinder STL."""
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    geo_data = _read_geometries(case_path)

    # Remove zone config
    original_zones = len(geo_data.get("mrf_zones", []))
    geo_data["mrf_zones"] = [z for z in geo_data.get("mrf_zones", []) if z["name"] != zone_name]
    if len(geo_data["mrf_zones"]) == original_zones:
        raise HTTPException(status_code=404, detail=f"MRF zone '{zone_name}' not found")

    # Remove zone geometry entry
    zone_filename = f"{zone_name}.stl"
    geo_data["geometries"] = [g for g in geo_data["geometries"] if g["filename"] != zone_filename]

    # Clear mrf_zone reference from rotating geometries
    for g in geo_data["geometries"]:
        if g.get("mrf_zone") == zone_name:
            g["role"] = "body"
            g.pop("mrf_zone", None)

    # Delete cylinder STL file
    stl_file = case_path / "constant" / "triSurface" / zone_filename
    if stl_file.is_file():
        stl_file.unlink()

    # Remove MRFProperties if no zones left
    mrf_file = case_path / "constant" / "MRFProperties"
    if not geo_data["mrf_zones"] and mrf_file.is_file():
        mrf_file.unlink()

    _write_geometries(case_path, geo_data)
    _regenerate_all_dicts(case_path, geo_data)

    return {"removed": zone_name}


@router.post("/{name}/regenerate-dicts")
async def regenerate_dicts(name: str):
    """Regenerate all mesh dicts from the geometry list."""
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    geo_data = _read_geometries(case_path)
    if not geo_data.get("geometries"):
        raise HTTPException(status_code=422, detail="No geometries in case")

    _regenerate_all_dicts(case_path, geo_data)
    return {"regenerated": True, "geometry_count": len(geo_data["geometries"])}
