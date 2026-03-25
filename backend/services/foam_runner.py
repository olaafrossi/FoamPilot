"""Async subprocess management and job store for OpenFOAM runs."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Optional

from models import JobStatusEnum

# ── Configuration ────────────────────────────────────────────────────

FOAM_RUN = os.environ.get("FOAM_RUN", "/home/openfoam/run")
FOAM_TEMPLATES = os.environ.get("FOAM_TEMPLATES", "/home/openfoam/templates")
LOG_BUFFER_SIZE = 5000


# ── Job dataclass ────────────────────────────────────────────────────


class Job:
    __slots__ = (
        "job_id",
        "case_name",
        "commands",
        "status",
        "process",
        "log",
        "start_time",
        "end_time",
        "exit_code",
        "_subscribers",
    )

    def __init__(self, job_id: str, case_name: str, commands: list[str]) -> None:
        self.job_id = job_id
        self.case_name = case_name
        self.commands = commands
        self.status: JobStatusEnum = JobStatusEnum.queued
        self.process: Optional[asyncio.subprocess.Process] = None
        self.log: deque[dict] = deque(maxlen=LOG_BUFFER_SIZE)
        self.start_time: Optional[datetime] = None
        self.end_time: Optional[datetime] = None
        self.exit_code: Optional[int] = None
        self._subscribers: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    def _push(self, entry: dict) -> None:
        self.log.append(entry)
        for q in self._subscribers:
            q.put_nowait(entry)


# ── Job store ────────────────────────────────────────────────────────

_jobs: dict[str, Job] = {}


def get_job(job_id: str) -> Optional[Job]:
    return _jobs.get(job_id)


def list_jobs() -> list[Job]:
    return list(_jobs.values())


# ── Path helpers ─────────────────────────────────────────────────────


def validate_case_path(case_name: str) -> str:
    """Return the absolute case path, or raise ValueError if it escapes FOAM_RUN."""
    resolved = str(PurePosixPath(FOAM_RUN) / case_name)
    if not resolved.startswith(FOAM_RUN):
        raise ValueError(f"Invalid case name: {case_name}")
    return resolved


def case_dir(case_name: str) -> str:
    return validate_case_path(case_name)


def template_dir(template_name: str) -> str:
    resolved = str(PurePosixPath(FOAM_TEMPLATES) / template_name)
    if not resolved.startswith(FOAM_TEMPLATES):
        raise ValueError(f"Invalid template name: {template_name}")
    return resolved


# ── Runner ───────────────────────────────────────────────────────────


async def _read_stream(
    stream: asyncio.StreamReader, stream_name: str, job: Job
) -> None:
    """Read lines from a subprocess stream and push to the job log."""
    while True:
        line_bytes = await stream.readline()
        if not line_bytes:
            break
        line = line_bytes.decode("utf-8", errors="replace").rstrip("\n")
        job._push({"line": line, "stream": stream_name})


async def _run_job(job: Job) -> None:
    """Execute the command chain for a job."""
    case_path = case_dir(job.case_name)
    job.status = JobStatusEnum.running
    job.start_time = datetime.now(timezone.utc)

    try:
        for cmd in job.commands:
            shell_cmd = f"cd {case_path} && {cmd}"
            proc = await asyncio.create_subprocess_exec(
                "bash",
                "-lc",
                shell_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            job.process = proc

            tasks = []
            if proc.stdout:
                tasks.append(asyncio.create_task(_read_stream(proc.stdout, "stdout", job)))
            if proc.stderr:
                tasks.append(asyncio.create_task(_read_stream(proc.stderr, "stderr", job)))

            await asyncio.gather(*tasks)
            await proc.wait()

            if proc.returncode != 0:
                job.exit_code = proc.returncode
                job.status = JobStatusEnum.failed
                job.end_time = datetime.now(timezone.utc)
                # Signal end to subscribers
                for q in job._subscribers:
                    q.put_nowait(None)
                return

        job.exit_code = 0
        job.status = JobStatusEnum.completed

    except asyncio.CancelledError:
        if job.process and job.process.returncode is None:
            job.process.terminate()
            try:
                await asyncio.wait_for(job.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                job.process.kill()
        job.status = JobStatusEnum.cancelled

    except Exception as exc:
        job._push({"line": f"Internal error: {exc}", "stream": "stderr"})
        job.status = JobStatusEnum.failed

    finally:
        job.end_time = datetime.now(timezone.utc)
        # Signal end to subscribers
        for q in job._subscribers:
            q.put_nowait(None)


def start_job(case_name: str, commands: list[str]) -> Job:
    """Create a job and schedule it to run."""
    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id=job_id, case_name=case_name, commands=commands)
    _jobs[job_id] = job
    asyncio.create_task(_run_job(job))
    return job


def cancel_job(job_id: str) -> bool:
    """Cancel a running job. Returns True if cancellation was attempted."""
    job = _jobs.get(job_id)
    if not job:
        return False
    if job.status in (JobStatusEnum.completed, JobStatusEnum.failed, JobStatusEnum.cancelled):
        return False
    if job.process and job.process.returncode is None:
        job.process.terminate()
    job.status = JobStatusEnum.cancelled
    job.end_time = datetime.now(timezone.utc)
    return True
