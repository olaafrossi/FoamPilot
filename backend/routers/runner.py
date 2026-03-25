"""Run management and log streaming endpoints."""

from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from models import JobStatus, JobStatusEnum, RunRequest
from services.foam_runner import cancel_job, case_dir, get_job, list_jobs, start_job

router = APIRouter(tags=["runner"])


# ── Start a run ──────────────────────────────────────────────────────


@router.post("/run", response_model=JobStatus, status_code=202)
async def run_case(req: RunRequest):
    """Start an OpenFOAM run (one or more commands) on a case."""
    path = case_dir(req.case_name)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Case '{req.case_name}' not found")

    job = start_job(req.case_name, req.commands)
    return _job_status(job)


# ── Get job status ───────────────────────────────────────────────────


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_status(job)


# ── Cancel / delete job ──────────────────────────────────────────────


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(job_id: str):
    """Cancel a running job."""
    if not cancel_job(job_id):
        raise HTTPException(status_code=404, detail="Job not found or already finished")


# ── WebSocket log stream ─────────────────────────────────────────────


@router.websocket("/logs/{job_id}")
async def stream_logs(websocket: WebSocket, job_id: str):
    """Stream log lines for a job over WebSocket.

    Protocol:
    - Sends buffered lines first, then streams new lines in real time.
    - Each message is JSON: {"line": "...", "stream": "stdout|stderr"}
    - Sends {"line": "", "stream": "eof"} when the job finishes, then closes.
    """
    job = get_job(job_id)
    if not job:
        await websocket.close(code=4004, reason="Job not found")
        return

    await websocket.accept()

    try:
        # Send buffered log lines
        for entry in list(job.log):
            await websocket.send_json(entry)

        # If already done, signal and close
        if job.status in (
            JobStatusEnum.completed,
            JobStatusEnum.failed,
            JobStatusEnum.cancelled,
        ):
            await websocket.send_json({"line": "", "stream": "eof"})
            await websocket.close()
            return

        # Subscribe for live lines
        queue = job.subscribe()
        try:
            while True:
                entry = await queue.get()
                if entry is None:
                    # Job finished
                    await websocket.send_json({"line": "", "stream": "eof"})
                    break
                await websocket.send_json(entry)
        finally:
            job.unsubscribe(queue)

        await websocket.close()

    except WebSocketDisconnect:
        pass


# ── Helpers ──────────────────────────────────────────────────────────


def _job_status(job) -> JobStatus:
    return JobStatus(
        job_id=job.job_id,
        case_name=job.case_name,
        commands=job.commands,
        status=job.status,
        start_time=job.start_time,
        end_time=job.end_time,
        exit_code=job.exit_code,
    )
