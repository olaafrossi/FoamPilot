"""Pipeline management endpoints for the guided simulation wizard.

Provides CRUD + state transition endpoints for simulation pipelines.
Delegates command execution to the existing runner service.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException

from models import (
    PipelineAdvanceRequest,
    PipelineCreateRequest,
    PipelineResetRequest,
    PipelineResponse,
    TemplateInfo,
    TemplateStepInfo,
    ValidationResultResponse,
)
from services.foam_runner import (
    FOAM_RUN,
    FOAM_TEMPLATES,
    FOAM_USER_TEMPLATES,
    validate_case_path,
)
from services.pipeline_service import (
    Pipeline,
    PipelineState,
    delete_pipeline,
    load_pipeline,
    save_pipeline,
    validate_for_state,
)

router = APIRouter(tags=["pipeline"])


# ── Helpers ─────────────────────────────────────────────────────────


def _get_pipeline_or_404(case_name: str) -> Pipeline:
    pipeline = load_pipeline(case_name)
    if pipeline is None:
        raise HTTPException(status_code=404, detail=f"No pipeline found for case '{case_name}'")
    return pipeline


def _pipeline_response(p: Pipeline) -> PipelineResponse:
    d = p.to_dict()
    return PipelineResponse(**d)


# ── Create pipeline ─────────────────────────────────────────────────


@router.post("/pipeline/create", response_model=PipelineResponse, status_code=201)
async def create_pipeline(req: PipelineCreateRequest):
    """Create a new pipeline, optionally from a template.

    If template is provided and the case doesn't exist, copies the template
    case files first. If the case already exists, creates a pipeline for it.
    """
    try:
        case_path = validate_case_path(req.case_name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid case name")

    # Check if pipeline already exists
    existing = load_pipeline(req.case_name)
    if existing is not None:
        raise HTTPException(
            status_code=409, detail=f"Pipeline already exists for case '{req.case_name}'"
        )

    # If template specified and case doesn't exist, copy template
    if req.template and not os.path.isdir(case_path):
        tpl_root = Path(FOAM_TEMPLATES) / req.template
        # Template case files may be in a 'case' subdirectory or at root
        tpl_case = tpl_root / "case" if (tpl_root / "case").is_dir() else tpl_root
        if not tpl_case.is_dir() or not (tpl_case / "system").is_dir():
            raise HTTPException(
                status_code=404, detail=f"Template '{req.template}' not found or invalid"
            )
        shutil.copytree(str(tpl_case), case_path)
    elif not os.path.isdir(case_path):
        raise HTTPException(
            status_code=404,
            detail=f"Case '{req.case_name}' does not exist. Provide a template to create it.",
        )

    pipeline = Pipeline(case_name=req.case_name, template=req.template)
    save_pipeline(pipeline)
    return _pipeline_response(pipeline)


# ── Get pipeline state ──────────────────────────────────────────────


@router.get("/pipeline/{case_name}", response_model=PipelineResponse)
async def get_pipeline(case_name: str):
    """Get the current pipeline state for a case."""
    pipeline = _get_pipeline_or_404(case_name)
    return _pipeline_response(pipeline)


# ── Advance pipeline ────────────────────────────────────────────────


@router.post("/pipeline/{case_name}/advance", response_model=PipelineResponse)
async def advance_pipeline(case_name: str, req: PipelineAdvanceRequest):
    """Attempt to advance the pipeline to the next state.

    Runs validation checks before transitioning. For mesh and run steps,
    the actual command execution should be triggered separately via POST /run
    and the pipeline advanced after the job completes.
    """
    pipeline = _get_pipeline_or_404(case_name)

    try:
        target = PipelineState(req.target_state)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid target state: {req.target_state}"
        )

    if not pipeline.can_transition_to(target):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot transition from {pipeline.state.value} to {target.value}",
        )

    # Reject advance while a job is active
    if pipeline.active_job_id:
        raise HTTPException(
            status_code=409, detail="Cannot advance while a job is active"
        )

    # Run validation
    try:
        case_path = validate_case_path(case_name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid case name")

    results = validate_for_state(case_path, target)
    failures = [r for r in results if not r.passed]

    if failures:
        pipeline.validation_errors = [r.to_dict() for r in failures]
        save_pipeline(pipeline)
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Validation failed",
                "errors": [r.to_dict() for r in failures],
            },
        )

    # Transition
    pipeline.advance(target)
    pipeline.validation_errors = []

    # Mark appropriate steps as complete
    step_map = {
        PipelineState.MESHED: "mesh",
        PipelineState.CONFIGURED: "boundaries",
        PipelineState.COMPLETE: "run",
    }
    step = step_map.get(target)
    if step:
        pipeline.mark_step(step, "complete")

    save_pipeline(pipeline)
    return _pipeline_response(pipeline)


# ── Validate (dry-run) ──────────────────────────────────────────────


@router.post(
    "/pipeline/{case_name}/validate",
    response_model=list[ValidationResultResponse],
)
async def validate_pipeline(case_name: str, req: PipelineAdvanceRequest):
    """Run validation checks without advancing the pipeline."""
    _get_pipeline_or_404(case_name)

    try:
        target = PipelineState(req.target_state)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid target state: {req.target_state}"
        )

    try:
        case_path = validate_case_path(case_name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid case name")

    results = validate_for_state(case_path, target)
    return [ValidationResultResponse(**r.to_dict()) for r in results]


# ── Reset step ──────────────────────────────────────────────────────


@router.post("/pipeline/{case_name}/reset/{step}", response_model=PipelineResponse)
async def reset_pipeline_step(case_name: str, step: str, req: PipelineResetRequest):
    """Reset the pipeline to an earlier state. Only valid from FAILED state."""
    pipeline = _get_pipeline_or_404(case_name)

    if pipeline.active_job_id:
        raise HTTPException(
            status_code=409, detail="Cannot reset while a job is running"
        )

    try:
        target = PipelineState(req.target_state)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid target state: {req.target_state}"
        )

    try:
        pipeline.reset_to(target)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    save_pipeline(pipeline)
    return _pipeline_response(pipeline)


# ── Templates with metadata ─────────────────────────────────────────


def _scan_template_dir(tpl_dir: Path, source: str) -> list[TemplateInfo]:
    """Scan a directory for valid OpenFOAM templates and return metadata."""
    if not tpl_dir.is_dir():
        return []

    # Templates whose solver is simpleFoam (external aero) vs learning cases
    _LEARNING_SOLVERS = {"icoFoam"}

    templates = []
    for entry in sorted(tpl_dir.iterdir()):
        if not entry.is_dir():
            continue

        # Check for template.json metadata
        meta_file = entry / "template.json"
        meta: dict = {}
        if meta_file.is_file():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass

        # Skip hidden templates (still usable as scaffolds, just not listed)
        if meta.get("hidden", False):
            continue

        # Check if it's a valid template (has case/system or system dir)
        case_dir = entry / "case" if (entry / "case").is_dir() else entry
        if not (case_dir / "system").is_dir():
            continue

        # Parse step metadata if present
        raw_steps = meta.get("steps", {})
        steps = {}
        for step_key, step_data in raw_steps.items():
            if isinstance(step_data, dict):
                steps[step_key] = TemplateStepInfo(
                    title=step_data.get("title", ""),
                    description=step_data.get("description", ""),
                    files=step_data.get("files", []),
                    commands=step_data.get("commands", []),
                    tip=step_data.get("tip", ""),
                )

        # Extract physics metadata
        physics = meta.get("physics", {})
        domain_type = physics.get("domain_type", "")
        solver = meta.get("solver", "")

        # Detect if sample geometry exists (triSurface for STL/OBJ, or polyMesh for pre-meshed cases)
        tri_dir = case_dir / "constant" / "triSurface"
        poly_dir = case_dir / "constant" / "polyMesh"
        has_tri = tri_dir.is_dir() and any(tri_dir.iterdir()) if tri_dir.is_dir() else False
        has_poly = poly_dir.is_dir() and any(poly_dir.iterdir()) if poly_dir.is_dir() else False
        has_geometry = has_tri or has_poly

        # Categorize: external aero vs learning
        category = "learning" if solver in _LEARNING_SOLVERS else "aero"

        templates.append(
            TemplateInfo(
                name=meta.get("name", entry.name),
                path=entry.name,
                description=meta.get("description", ""),
                difficulty=meta.get("difficulty", ""),
                solver=solver,
                estimated_runtime=meta.get("estimated_runtime", ""),
                learning_objectives=meta.get("learning_objectives", []),
                fields=meta.get("fields", []),
                steps=steps,
                source=source,
                domain_type=domain_type,
                has_geometry=has_geometry,
                category=category,
            )
        )

    return templates


@router.get("/templates", response_model=list[TemplateInfo])
async def list_templates_with_metadata():
    """List available templates with metadata from template.json files.

    Scans both the built-in templates directory (FOAM_TEMPLATES) and the
    user templates directory (FOAM_USER_TEMPLATES) if configured.
    """
    templates = _scan_template_dir(Path(FOAM_TEMPLATES), "builtin")

    if FOAM_USER_TEMPLATES:
        user_dir = Path(FOAM_USER_TEMPLATES)
        templates.extend(_scan_template_dir(user_dir, "user"))

    return templates
