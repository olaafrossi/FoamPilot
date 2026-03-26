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
