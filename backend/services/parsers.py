"""Parse OpenFOAM command output for UI display."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class MeshQuality:
    cells: int = 0
    faces: int = 0
    points: int = 0
    max_non_orthogonality: float = 0.0
    max_skewness: float = 0.0
    max_aspect_ratio: float = 0.0
    ok: bool = True
    errors: list[str] = field(default_factory=list)


@dataclass
class AeroResults:
    cd: float | None = None  # drag coefficient
    cl: float | None = None  # lift coefficient
    cm: float | None = None  # moment coefficient
    cd_pressure: float | None = None
    cd_viscous: float | None = None
    iterations: int = 0
    wall_time_seconds: float = 0.0
    converged: bool = True


# ---------------------------------------------------------------------------
# checkMesh parser
# ---------------------------------------------------------------------------

def parse_check_mesh(output: str) -> MeshQuality:
    """Parse checkMesh stdout and return structured quality metrics."""
    result = MeshQuality()

    # Cell/face/point counts
    m = re.search(r"cells:\s+(\d+)", output)
    if m:
        result.cells = int(m.group(1))

    m = re.search(r"faces:\s+(\d+)", output)
    if m:
        result.faces = int(m.group(1))

    m = re.search(r"points:\s+(\d+)", output)
    if m:
        result.points = int(m.group(1))

    # Quality metrics
    m = re.search(r"Max non-orthogonality\s*=\s*([\d.eE+-]+)", output, re.IGNORECASE)
    if m:
        result.max_non_orthogonality = float(m.group(1))

    m = re.search(r"Max skewness\s*=\s*([\d.eE+-]+)", output, re.IGNORECASE)
    if m:
        result.max_skewness = float(m.group(1))

    m = re.search(r"Max aspect ratio\s*=\s*([\d.eE+-]+)", output, re.IGNORECASE)
    if m:
        result.max_aspect_ratio = float(m.group(1))

    # Overall mesh status
    if "Mesh OK." in output:
        result.ok = True
    else:
        result.ok = False
        # Collect error lines: checkMesh prefixes failures with "***"
        for line in output.splitlines():
            stripped = line.strip()
            if stripped.startswith("***"):
                result.errors.append(stripped.lstrip("* "))

    return result


# ---------------------------------------------------------------------------
# forceCoeffs parser
# ---------------------------------------------------------------------------

def parse_force_coeffs(file_path: str) -> AeroResults:
    """Parse forceCoeffs.dat file and return the final-iteration values.

    Expected columns (tab or whitespace separated, comment lines start with #):
    Time  Cd  Cs  Cl  CmRoll  CmPitch  CmYaw  Cd(f)  Cd(r)  Cs(f)  Cs(r)  Cl(f)  Cl(r)
    """
    result = AeroResults()
    path = Path(file_path)

    if not path.is_file():
        return result

    last_data_line: str | None = None
    line_count = 0

    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            last_data_line = stripped
            line_count += 1

    if last_data_line is None:
        return result

    cols = last_data_line.split()
    result.iterations = line_count

    try:
        # Column indices: 0=Time, 1=Cd, 2=Cs, 3=Cl, 4=CmRoll, 5=CmPitch, 6=CmYaw,
        #                 7=Cd(f), 8=Cd(r), 9=Cs(f), 10=Cs(r), 11=Cl(f), 12=Cl(r)
        if len(cols) > 1:
            result.cd = float(cols[1])
        if len(cols) > 3:
            result.cl = float(cols[3])
        if len(cols) > 5:
            result.cm = float(cols[5])  # CmPitch
        # Cd(f) + Cd(r) = total Cd; approximate pressure/viscous split from front/rear
        if len(cols) > 8:
            result.cd_pressure = float(cols[7])   # Cd(f) as pressure approximation
            result.cd_viscous = float(cols[8])     # Cd(r) as viscous approximation
    except (ValueError, IndexError):
        pass

    return result


# ---------------------------------------------------------------------------
# Residual line parser
# ---------------------------------------------------------------------------

_RESIDUAL_RE = re.compile(
    r"Solving for (\w+),\s+"
    r"Initial residual\s*=\s*([\d.eE+-]+),\s+"
    r"Final residual\s*=\s*([\d.eE+-]+),\s+"
    r"No Iterations\s+(\d+)",
    re.IGNORECASE,
)


def parse_residual_line(line: str) -> dict | None:
    """Parse a single simpleFoam/solver log line for residual data.

    Returns dict with keys: field, initial, final, iterations.
    Returns None if the line is not a residual line.
    """
    m = _RESIDUAL_RE.search(line)
    if not m:
        return None
    return {
        "field": m.group(1),
        "initial": float(m.group(2)),
        "final": float(m.group(3)),
        "iterations": int(m.group(4)),
    }
