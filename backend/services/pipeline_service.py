"""Stateful pipeline engine for guided simulation workflows.

Models the CFD simulation lifecycle as a state machine with validation gates.
Delegates command execution to the existing foam_runner service.

State Machine (5 milestone states):
┌─────────────────────────────────────────────────────────────┐
│  DRAFT ──validate──> MESHED ──validate──> CONFIGURED        │
│                                               │              │
│                                          run solver          │
│                                               │              │
│                                               v              │
│                                           COMPLETE           │
│                                                              │
│    (any step can fail) ──────────────> FAILED                │
│                                          │ reset             │
│                                          └──> (prev state)   │
└─────────────────────────────────────────────────────────────┘
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

from services.foam_runner import FOAM_RUN, FOAM_TEMPLATES, validate_case_path


# ── Pipeline States ─────────────────────────────────────────────────


class PipelineState(str, Enum):
    DRAFT = "draft"
    MESHED = "meshed"
    CONFIGURED = "configured"
    COMPLETE = "complete"
    FAILED = "failed"


# Valid forward transitions: current_state -> set of reachable states
_TRANSITIONS: dict[PipelineState, set[PipelineState]] = {
    PipelineState.DRAFT: {PipelineState.MESHED, PipelineState.FAILED},
    PipelineState.MESHED: {PipelineState.CONFIGURED, PipelineState.FAILED},
    PipelineState.CONFIGURED: {PipelineState.COMPLETE, PipelineState.FAILED},
    PipelineState.COMPLETE: set(),
    PipelineState.FAILED: {PipelineState.DRAFT, PipelineState.MESHED, PipelineState.CONFIGURED},
}

# Which step maps to which target state
STEP_TARGET: dict[str, PipelineState] = {
    "mesh": PipelineState.MESHED,
    "boundaries": PipelineState.CONFIGURED,
    "solver": PipelineState.CONFIGURED,  # alias — same target
    "run": PipelineState.COMPLETE,
}

# Commands associated with each step (for delegation to runner)
STEP_COMMANDS: dict[str, list[str]] = {
    "mesh": ["blockMesh"],
    "run": [],  # solver command comes from controlDict — set dynamically
}


# ── Validation ──────────────────────────────────────────────────────


class ValidationResult:
    """Result of a single validation check."""

    __slots__ = ("rule", "passed", "message")

    def __init__(self, rule: str, passed: bool, message: str = "") -> None:
        self.rule = rule
        self.passed = passed
        self.message = message

    def to_dict(self) -> dict:
        return {"rule": self.rule, "passed": self.passed, "message": self.message}


def _file_exists(case_path: str, relative: str) -> ValidationResult:
    """Check that a file exists in the case directory."""
    full = Path(case_path) / relative
    if full.is_file():
        return ValidationResult(f"file_exists:{relative}", True)
    return ValidationResult(
        f"file_exists:{relative}", False, f"File not found: {relative}"
    )


def _brace_balance(case_path: str, relative: str) -> ValidationResult:
    """Check that braces/brackets are balanced in a dictionary file."""
    full = Path(case_path) / relative
    if not full.is_file():
        return ValidationResult(
            f"brace_balance:{relative}", False, f"File not found: {relative}"
        )
    text = full.read_text(encoding="utf-8", errors="replace")
    opens = text.count("{") + text.count("(")
    closes = text.count("}") + text.count(")")
    if opens == closes:
        return ValidationResult(f"brace_balance:{relative}", True)
    return ValidationResult(
        f"brace_balance:{relative}",
        False,
        f"Unbalanced braces/parens in {relative}: {opens} opening vs {closes} closing",
    )


def _time_range_valid(case_path: str) -> ValidationResult:
    """Check that startTime < endTime in controlDict."""
    control = Path(case_path) / "system" / "controlDict"
    if not control.is_file():
        return ValidationResult(
            "time_range", False, "system/controlDict not found"
        )
    text = control.read_text(encoding="utf-8", errors="replace")
    start_time = _extract_keyword_value(text, "startTime")
    end_time = _extract_keyword_value(text, "endTime")
    if start_time is None or end_time is None:
        return ValidationResult(
            "time_range", False, "Could not parse startTime/endTime from controlDict"
        )
    try:
        if float(start_time) < float(end_time):
            return ValidationResult("time_range", True)
        return ValidationResult(
            "time_range",
            False,
            f"startTime ({start_time}) must be less than endTime ({end_time})",
        )
    except ValueError:
        return ValidationResult(
            "time_range", False, f"Non-numeric time values: start={start_time}, end={end_time}"
        )


def _extract_keyword_value(text: str, keyword: str) -> Optional[str]:
    """Extract a simple keyword value from OpenFOAM dictionary text.

    Handles format: keyword    value;
    """
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(keyword):
            rest = stripped[len(keyword):].strip()
            if rest.endswith(";"):
                return rest[:-1].strip()
    return None


# Tier 1 validation rules per target state
def validate_for_state(
    case_path: str, target: PipelineState
) -> list[ValidationResult]:
    """Run Tier 1 validation rules for transitioning to the target state."""
    results: list[ValidationResult] = []

    if target == PipelineState.MESHED:
        results.append(_file_exists(case_path, "system/blockMeshDict"))
        results.append(_brace_balance(case_path, "system/blockMeshDict"))

    elif target == PipelineState.CONFIGURED:
        results.append(_file_exists(case_path, "system/controlDict"))
        results.append(_file_exists(case_path, "system/fvSchemes"))
        results.append(_file_exists(case_path, "system/fvSolution"))
        results.append(_brace_balance(case_path, "system/controlDict"))
        results.append(_brace_balance(case_path, "system/fvSchemes"))
        results.append(_brace_balance(case_path, "system/fvSolution"))
        results.append(_time_range_valid(case_path))

    elif target == PipelineState.COMPLETE:
        results.append(_file_exists(case_path, "system/controlDict"))
        results.append(_time_range_valid(case_path))

    return results


# ── Pipeline Data ───────────────────────────────────────────────────


class Pipeline:
    """Represents a simulation pipeline with state and step tracking."""

    __slots__ = (
        "id",
        "case_name",
        "template",
        "state",
        "created_at",
        "steps",
        "active_job_id",
        "validation_errors",
    )

    def __init__(
        self,
        case_name: str,
        template: str = "",
        pipeline_id: Optional[str] = None,
        state: PipelineState = PipelineState.DRAFT,
        created_at: Optional[datetime] = None,
    ) -> None:
        self.id = pipeline_id or uuid.uuid4().hex[:12]
        self.case_name = case_name
        self.template = template
        self.state = state
        self.created_at = created_at or datetime.now(timezone.utc)
        self.steps: dict[str, dict] = {
            "mesh": {"status": "pending"},
            "boundaries": {"status": "pending"},
            "solver": {"status": "pending"},
            "run": {"status": "pending"},
            "postprocess": {"status": "pending"},
        }
        self.active_job_id: Optional[str] = None
        self.validation_errors: list[dict] = []

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "case_name": self.case_name,
            "template": self.template,
            "state": self.state.value,
            "created_at": self.created_at.isoformat(),
            "steps": self.steps,
            "active_job_id": self.active_job_id,
            "validation_errors": self.validation_errors,
        }

    @classmethod
    def from_dict(cls, data: dict) -> Pipeline:
        p = cls(
            case_name=data["case_name"],
            template=data.get("template", ""),
            pipeline_id=data["id"],
            state=PipelineState(data["state"]),
        )
        p.created_at = datetime.fromisoformat(data["created_at"])
        p.steps = data.get("steps", p.steps)
        p.active_job_id = data.get("active_job_id")
        p.validation_errors = data.get("validation_errors", [])
        return p

    def can_transition_to(self, target: PipelineState) -> bool:
        return target in _TRANSITIONS.get(self.state, set())

    def advance(self, target: PipelineState) -> None:
        """Move the pipeline to a new state. Raises ValueError if invalid."""
        if not self.can_transition_to(target):
            raise ValueError(
                f"Cannot transition from {self.state.value} to {target.value}"
            )
        self.state = target

    def mark_step(self, step: str, status: str, **kwargs: object) -> None:
        """Update a step's status and metadata."""
        if step in self.steps:
            self.steps[step]["status"] = status
            self.steps[step].update(kwargs)

    def reset_to(self, target: PipelineState) -> None:
        """Reset the pipeline to an earlier state. Only valid from FAILED."""
        if self.state != PipelineState.FAILED:
            raise ValueError("Can only reset from FAILED state")
        if target not in (PipelineState.DRAFT, PipelineState.MESHED, PipelineState.CONFIGURED):
            raise ValueError(f"Cannot reset to {target.value}")
        self.state = target
        self.validation_errors = []
        self.active_job_id = None


# ── Persistence (.foampilot/pipeline.json) ──────────────────────────


PIPELINE_DIR = ".foampilot"
PIPELINE_FILE = "pipeline.json"


def _pipeline_path(case_path: str) -> Path:
    return Path(case_path) / PIPELINE_DIR / PIPELINE_FILE


def save_pipeline(pipeline: Pipeline) -> None:
    """Write pipeline state to disk."""
    case_path = validate_case_path(pipeline.case_name)
    p = _pipeline_path(case_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(pipeline.to_dict(), indent=2), encoding="utf-8")


def load_pipeline(case_name: str) -> Optional[Pipeline]:
    """Load pipeline state from disk. Returns None if not found."""
    try:
        case_path = validate_case_path(case_name)
    except ValueError:
        return None
    p = _pipeline_path(case_path)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return Pipeline.from_dict(data)
    except (json.JSONDecodeError, KeyError, ValueError):
        return None


def delete_pipeline(case_name: str) -> bool:
    """Delete pipeline state from disk. Returns True if deleted."""
    try:
        case_path = validate_case_path(case_name)
    except ValueError:
        return False
    p = _pipeline_path(case_path)
    if p.is_file():
        p.unlink()
        return True
    return False
