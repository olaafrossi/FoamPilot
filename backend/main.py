import subprocess

from fastapi import FastAPI

app = FastAPI(title="FoamPilot")


@app.get("/health")
async def health():
    """Return service health, including whether OpenFOAM is available."""
    try:
        subprocess.run(
            ["blockMesh", "-help"],
            capture_output=True,
            timeout=10,
            check=True,
        )
        openfoam_ok = True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        openfoam_ok = False

    return {"status": "ok", "openfoam": openfoam_ok}
