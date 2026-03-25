"""FoamPilot – FastAPI application entry point."""

from __future__ import annotations

import subprocess

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import cases, files, runner

app = FastAPI(title="FoamPilot", version="0.1.0")

# ── CORS (allow everything in dev; tighten for prod) ─────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Mount routers ────────────────────────────────────────────────────

app.include_router(cases.router)
app.include_router(runner.router)
app.include_router(files.router)


# ── Health check ─────────────────────────────────────────────────────


@app.get("/health")
async def health():
    """Return service health, including whether OpenFOAM is available."""
    try:
        subprocess.run(
            ["bash", "-lc", "blockMesh -help"],
            capture_output=True,
            timeout=10,
            check=True,
        )
        openfoam_ok = True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        openfoam_ok = False

    return {"status": "ok", "openfoam": openfoam_ok}
