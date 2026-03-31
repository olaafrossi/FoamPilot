"""File browsing and editing endpoints for OpenFOAM dictionary files."""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, HTTPException, Request

from models import FileNode
from services.foam_runner import FOAM_RUN, validate_case_path

router = APIRouter(prefix="/cases", tags=["files"])

# Directories to expose in the file tree
_TREE_DIRS = ("system", "constant", "0")


# ── Helpers ───────────────────────────────────────────────────────────


def _validate_file_path(case_name: str, rel_path: str) -> Path:
    """Resolve and validate that rel_path stays under the case directory."""
    case_root = Path(validate_case_path(case_name))
    if not case_root.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{case_name}' not found")

    # Normalise and block traversal
    normalised = PurePosixPath(rel_path)
    if ".." in normalised.parts:
        raise HTTPException(status_code=400, detail="Path traversal not allowed")

    full = (case_root / rel_path).resolve()

    # Ensure the resolved path is still under the case root
    try:
        full.relative_to(case_root.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Path traversal not allowed")

    return full


def _build_tree(root: Path, base: str) -> list[FileNode]:
    """Recursively build a tree of FileNode objects."""
    nodes: list[FileNode] = []
    if not root.is_dir():
        return nodes

    for entry in sorted(root.iterdir()):
        if entry.name.startswith("."):
            continue
        rel = f"{base}/{entry.name}" if base else entry.name
        if entry.is_dir():
            children = _build_tree(entry, rel)
            nodes.append(FileNode(name=entry.name, path=rel, type="dir", children=children))
        elif entry.is_file():
            nodes.append(FileNode(name=entry.name, path=rel, type="file"))
    return nodes


# ── Endpoints ─────────────────────────────────────────────────────────


@router.get("/{name}/files", response_model=list[FileNode])
async def list_files(name: str):
    """Return nested file tree for system/, constant/, 0/ directories."""
    case_root = Path(validate_case_path(name))
    if not case_root.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{name}' not found")

    tree: list[FileNode] = []
    for dir_name in _TREE_DIRS:
        dir_path = case_root / dir_name
        if dir_path.is_dir():
            children = _build_tree(dir_path, dir_name)
            tree.append(FileNode(name=dir_name, path=dir_name, type="dir", children=children))
    return tree


@router.get("/{name}/file")
async def read_file(name: str, path: str):
    """Return raw text content of a dictionary file.

    Returns ``{"content": null}`` if the file doesn't exist rather than
    a 404, so the browser doesn't spam the console with network errors
    on expected-missing files (e.g. snappyHexMeshDict in 2-D cases).
    """
    full = _validate_file_path(name, path)
    if not full.is_file():
        return {"content": None}
    try:
        content = full.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"content": content}


@router.put("/{name}/file")
async def write_file(name: str, path: str, request: Request):
    """Write text content to a dictionary file."""
    full = _validate_file_path(name, path)
    if not full.parent.is_dir():
        raise HTTPException(status_code=404, detail=f"Parent directory not found for: {path}")
    try:
        body = await request.body()
        full.write_text(body.decode("utf-8"), encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"success": True}
