"""Pydantic schemas for FoamPilot API."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Cases ────────────────────────────────────────────────────────────


class FoamCase(BaseModel):
    name: str
    path: str
    modified: Optional[datetime] = None


class CaseCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_\-]+$")
    template: str = Field(..., min_length=1)


class CaseCloneRequest(BaseModel):
    new_name: str = Field(..., min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_\-]+$")


# ── Runner ───────────────────────────────────────────────────────────


class RunRequest(BaseModel):
    case_name: str
    commands: list[str] = Field(
        ...,
        min_length=1,
        description="OpenFOAM commands to run sequentially, e.g. ['blockMesh', 'icoFoam']",
    )


class JobStatusEnum(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class JobStatus(BaseModel):
    job_id: str
    case_name: str
    commands: list[str]
    status: JobStatusEnum
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    exit_code: Optional[int] = None


# ── Log line (sent over WebSocket) ───────────────────────────────────


class LogLine(BaseModel):
    line: str
    stream: str  # "stdout" | "stderr"


# ── Files ────────────────────────────────────────────────────────────


class FileNode(BaseModel):
    name: str
    path: str
    type: str  # "file" | "dir"
    children: list["FileNode"] | None = None


# ── Pipeline ────────────────────────────────────────────────────────


class PipelineCreateRequest(BaseModel):
    case_name: str = Field(..., min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_\-]+$")
    template: str = Field("", description="Template name to create from, or empty for existing case")


class PipelineAdvanceRequest(BaseModel):
    target_state: str = Field(..., description="Target state: meshed, configured, or complete")


class PipelineResetRequest(BaseModel):
    target_state: str = Field(..., description="State to reset to: draft, meshed, or configured")


class ValidationResultResponse(BaseModel):
    rule: str
    passed: bool
    message: str = ""


class PipelineResponse(BaseModel):
    id: str
    case_name: str
    template: str = ""
    state: str
    created_at: str
    steps: dict
    active_job_id: Optional[str] = None
    validation_errors: list[dict] = []


class TemplateStepInfo(BaseModel):
    title: str = ""
    description: str = ""
    files: list[str] = []
    commands: list[str] = []
    tip: str = ""


class TemplateInfo(BaseModel):
    name: str
    path: str
    description: str = ""
    difficulty: str = ""
    solver: str = ""
    estimated_runtime: str = ""
    learning_objectives: list[str] = []
    fields: list[str] = []
    steps: dict[str, TemplateStepInfo] = {}
    source: str = "builtin"
    domain_type: str = ""
    has_geometry: bool = False
    category: str = ""


# ── Field data (3D visualization) ─────────────────────────────────


class FieldDataResponse(BaseModel):
    vertices: list[list[float]]
    faces: list[list[int]]
    values: list[float]
    vectors: list[list[float]] | None = None
    min: float
    max: float
    field: str
    time: str
    patches: list[dict]
    available_fields: list[str]
    available_times: list[str]
    warning: str | None = None
