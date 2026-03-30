"""Case management endpoints."""

from __future__ import annotations

import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from models import CaseCloneRequest, CaseCreateRequest, FoamCase
from services.foam_runner import FOAM_RUN, FOAM_TEMPLATES, validate_case_path

router = APIRouter(prefix="/cases", tags=["cases"])


def _case_info(name: str, path: str) -> FoamCase:
    p = Path(path)
    mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc) if p.exists() else None
    return FoamCase(name=name, path=path, modified=mtime)


# ── List cases ───────────────────────────────────────────────────────


@router.get("", response_model=list[FoamCase])
async def list_cases():
    """List all cases under FOAM_RUN."""
    run_dir = Path(FOAM_RUN)
    if not run_dir.is_dir():
        return []
    cases = []
    for entry in sorted(run_dir.iterdir()):
        if entry.is_dir() and not entry.name.startswith("."):
            cases.append(_case_info(entry.name, str(entry)))
    return cases


# ── Create case from template ────────────────────────────────────────


@router.post("", response_model=FoamCase, status_code=201)
async def create_case(req: CaseCreateRequest):
    """Create a new case by copying a template."""
    dest = validate_case_path(req.name)
    if os.path.exists(dest):
        raise HTTPException(status_code=409, detail=f"Case '{req.name}' already exists")

    tpl_dir = Path(FOAM_TEMPLATES)
    src = tpl_dir / req.template
    if not src.is_dir():
        raise HTTPException(status_code=404, detail=f"Template '{req.template}' not found")

    # Ensure src is under FOAM_TEMPLATES
    try:
        src.resolve().relative_to(tpl_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid template path")

    shutil.copytree(str(src), dest)

    # OpenFOAM tutorials use .orig directories. Copy so the wizard can work with them.
    dest_path = Path(dest)
    for orig_name, target_name in [("0.orig", "0"), ("constant/polyMesh.orig", "constant/polyMesh")]:
        orig = dest_path / orig_name
        target = dest_path / target_name
        if orig.is_dir() and not target.is_dir():
            shutil.copytree(str(orig), str(target))

    return _case_info(req.name, dest)


# ── Clone case ───────────────────────────────────────────────────────


@router.post("/{name}/clone", response_model=FoamCase, status_code=201)
async def clone_case(name: str, req: CaseCloneRequest):
    """Clone an existing case."""
    src = validate_case_path(name)
    if not os.path.isdir(src):
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    dest = validate_case_path(req.new_name)
    if os.path.exists(dest):
        raise HTTPException(status_code=409, detail=f"Case '{req.new_name}' already exists")

    shutil.copytree(src, dest)
    return _case_info(req.new_name, dest)


# ── Delete case ──────────────────────────────────────────────────────


# ── Get solver application ───────────────────────────────────────


@router.get("/{name}/solver")
async def get_solver(name: str):
    """Read the application field from system/controlDict."""
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    control_dict = case_path / "system" / "controlDict"
    if not control_dict.is_file():
        raise HTTPException(status_code=404, detail="controlDict not found")

    try:
        text = control_dict.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    match = re.search(r"^\s*application\s+(\S+)\s*;", text, re.MULTILINE)
    if not match:
        raise HTTPException(status_code=404, detail="application field not found in controlDict")

    return {"solver": match.group(1)}


# ── Delete case ──────────────────────────────────────────────────


@router.delete("/{name}", status_code=204)
async def delete_case(name: str):
    """Delete a case directory."""
    case_path = validate_case_path(name)
    if not os.path.isdir(case_path):
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")
    shutil.rmtree(case_path)


# ── Ensure .foam file for ParaView ──────────────────────────────


@router.post("/{name}/ensure-foam")
async def ensure_foam_file(name: str):
    """Create an empty .foam file in the case directory if missing.

    ParaView uses this file as an entry point to open OpenFOAM cases.
    """
    case_path = Path(validate_case_path(name))
    if not case_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    foam_file = case_path / f"{name}.foam"
    if not foam_file.exists():
        foam_file.touch()

    return {"path": str(foam_file)}
