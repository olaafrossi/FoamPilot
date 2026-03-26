"""FoamPilot – FastAPI application entry point."""

from __future__ import annotations

import subprocess

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import cases, files, geometry, pipeline, runner

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
app.include_router(pipeline.router)
app.include_router(geometry.router)


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


@app.get("/config")
async def get_config():
    """Return server configuration (cores, paths)."""
    from services.foam_runner import FOAM_CORES, FOAM_RUN, FOAM_TEMPLATES
    return {
        "cores": FOAM_CORES,
        "foam_run": FOAM_RUN,
        "foam_templates": FOAM_TEMPLATES,
    }
