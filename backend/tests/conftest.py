"""Shared fixtures for FoamPilot backend tests."""

from __future__ import annotations

import os
import struct
import sys
from pathlib import Path

import pytest

# Add backend to path so imports work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def tmp_foam_run(tmp_path, monkeypatch):
    """Create a temporary FOAM_RUN directory and patch the environment."""
    foam_run = tmp_path / "run"
    foam_run.mkdir()
    monkeypatch.setenv("FOAM_RUN", str(foam_run))
    # Also patch the module-level constants
    import services.foam_runner as fr

    monkeypatch.setattr(fr, "FOAM_RUN", str(foam_run))
    return foam_run


@pytest.fixture
def tmp_foam_templates(tmp_path, monkeypatch):
    """Create a temporary FOAM_TEMPLATES directory."""
    templates = tmp_path / "templates"
    templates.mkdir()
    monkeypatch.setenv("FOAM_TEMPLATES", str(templates))
    import services.foam_runner as fr

    monkeypatch.setattr(fr, "FOAM_TEMPLATES", str(templates))
    return templates


@pytest.fixture
def sample_case(tmp_foam_run):
    """Create a minimal OpenFOAM case directory structure."""
    case = tmp_foam_run / "cavity"
    (case / "system").mkdir(parents=True)
    (case / "constant").mkdir()
    (case / "0").mkdir()

    # blockMeshDict
    (case / "system" / "blockMeshDict").write_text(
        """\
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}

vertices
(
    (0 0 0)
    (1 0 0)
    (1 1 0)
    (0 1 0)
    (0 0 0.1)
    (1 0 0.1)
    (1 1 0.1)
    (0 1 0.1)
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (20 20 1) simpleGrading (1 1 1)
);

boundary
(
    movingWall
    {
        type wall;
        faces ((3 7 6 2));
    }
    fixedWalls
    {
        type wall;
        faces ((0 4 7 3) (2 6 5 1) (1 5 4 0));
    }
    frontAndBack
    {
        type empty;
        faces ((0 3 2 1) (4 5 6 7));
    }
);
""",
        encoding="utf-8",
    )

    # controlDict
    (case / "system" / "controlDict").write_text(
        """\
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      controlDict;
}

application     icoFoam;
startTime       0;
endTime         0.5;
deltaT          0.005;
writeInterval   0.1;
""",
        encoding="utf-8",
    )

    # fvSchemes
    (case / "system" / "fvSchemes").write_text(
        """\
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      fvSchemes;
}

ddtSchemes { default Euler; }
gradSchemes { default Gauss linear; }
divSchemes { default none; div(phi,U) Gauss linear; }
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
""",
        encoding="utf-8",
    )

    # fvSolution
    (case / "system" / "fvSolution").write_text(
        """\
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      fvSolution;
}

solvers
{
    p { solver PCG; preconditioner DIC; tolerance 1e-06; relTol 0; }
    U { solver PBiCG; preconditioner DILU; tolerance 1e-05; relTol 0; }
}

PISO { nCorrectors 2; nNonOrthogonalCorrectors 0; }
""",
        encoding="utf-8",
    )

    # 0/U
    (case / "0" / "U").write_text(
        """\
FoamFile
{
    version     2.0;
    format      ascii;
    class       volVectorField;
    object      U;
}

dimensions      [0 1 -1 0 0 0 0];
internalField   uniform (0 0 0);

boundaryField
{
    movingWall { type fixedValue; value uniform (1 0 0); }
    fixedWalls { type noSlip; }
    frontAndBack { type empty; }
}
""",
        encoding="utf-8",
    )

    # 0/p
    (case / "0" / "p").write_text(
        """\
FoamFile
{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      p;
}

dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;

boundaryField
{
    movingWall { type zeroGradient; }
    fixedWalls { type zeroGradient; }
    frontAndBack { type empty; }
}
""",
        encoding="utf-8",
    )

    return case


# ---------------------------------------------------------------------------
# STL file fixtures
# ---------------------------------------------------------------------------


def _make_binary_stl(triangles: list[tuple]) -> bytes:
    """Build a binary STL from a list of (normal, v1, v2, v3) tuples.

    Each element is a tuple of 3 floats: (x, y, z).
    Format: 80-byte header + uint32 count + per-triangle data.
    """
    header = b"\x00" * 80
    count = struct.pack("<I", len(triangles))
    data = header + count
    for normal, v1, v2, v3 in triangles:
        # 12 floats: normal(3) + v1(3) + v2(3) + v3(3)
        floats = struct.pack(
            "<12f",
            *normal,
            *v1,
            *v2,
            *v3,
        )
        attr = struct.pack("<H", 0)
        data += floats + attr
    return data


@pytest.fixture
def binary_stl_file(tmp_path):
    """Create a minimal binary STL with 1 triangle at known coordinates."""
    triangles = [
        (
            (0.0, 0.0, 1.0),  # normal
            (0.0, 0.0, 0.0),  # vertex 1
            (1.0, 0.0, 0.0),  # vertex 2
            (0.0, 1.0, 0.0),  # vertex 3
        )
    ]
    stl_path = tmp_path / "test_binary.stl"
    stl_path.write_bytes(_make_binary_stl(triangles))
    return stl_path


@pytest.fixture
def ascii_stl_file(tmp_path):
    """Create a minimal ASCII STL with 1 triangle at known coordinates."""
    content = """\
solid test
  facet normal 0 0 1
    outer loop
      vertex 0.0 0.0 0.0
      vertex 1.0 0.0 0.0
      vertex 0.0 1.0 0.0
    endloop
  endfacet
endsolid test
"""
    stl_path = tmp_path / "test_ascii.stl"
    stl_path.write_text(content, encoding="utf-8")
    return stl_path


@pytest.fixture
def degenerate_stl_file(tmp_path):
    """Create a binary STL where all vertices are at the same point."""
    triangles = [
        (
            (0.0, 0.0, 1.0),
            (5.0, 5.0, 5.0),
            (5.0, 5.0, 5.0),
            (5.0, 5.0, 5.0),
        )
    ]
    stl_path = tmp_path / "degenerate.stl"
    stl_path.write_bytes(_make_binary_stl(triangles))
    return stl_path


@pytest.fixture
def large_geometry_stl_file(tmp_path):
    """Create a binary STL spanning (-100,-50,0) to (100,50,200)."""
    triangles = [
        (
            (0.0, 0.0, 1.0),
            (-100.0, -50.0, 0.0),
            (100.0, 50.0, 200.0),
            (0.0, 0.0, 100.0),
        )
    ]
    stl_path = tmp_path / "large.stl"
    stl_path.write_bytes(_make_binary_stl(triangles))
    return stl_path


# ---------------------------------------------------------------------------
# checkMesh / forceCoeffs / solver log fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def check_mesh_output_ok():
    """Sample checkMesh output that passes (Mesh OK.)."""
    return """\
Checking geometry...
    Overall domain bounding box (-5 -4 0) (15 4 8)
    Mesh has 3 geometric (non-empty/wedge) directions

Checking topology...
    cells:           2100000
    faces:           6350000
    points:          2200000

Checking geometry...
    Max non-orthogonality = 65.2
    Max skewness = 2.1
    Max aspect ratio = 12.5

Mesh OK.
"""


@pytest.fixture
def check_mesh_output_errors():
    """Sample checkMesh output with mesh errors."""
    return """\
Checking geometry...
    Overall domain bounding box (-5 -4 0) (15 4 8)

Checking topology...
    cells:           500000
    faces:           1500000
    points:          600000

Checking geometry...
    Max non-orthogonality = 89.5
    Max skewness = 8.3
    Max aspect ratio = 45.2

 ***Number of severely non-orthogonal (> 70) faces: 1234.
 ***Error in face pyramids: 56 faces are incorrectly oriented.

Failed 2 mesh checks.
"""


@pytest.fixture
def force_coeffs_content():
    """Sample forceCoeffs.dat file content."""
    return """\
# Force coefficients
# Time          Cd          Cs          Cl
0               0           0           0
100             0.5432      0.0012      0.0876
200             0.4987      0.0008      0.0834
500             0.4215      0.0005      0.0812
"""


@pytest.fixture
def solver_log_lines():
    """Sample solver residual log lines."""
    return [
        "Solving for Ux, Initial residual = 0.123, Final residual = 0.00456, No Iterations 7",
        "Solving for Uy, Initial residual = 0.0567, Final residual = 0.00123, No Iterations 5",
        "Solving for p, Initial residual = 0.987, Final residual = 0.0001, No Iterations 120",
        "time step continuity errors : sum local = 1.23e-07",
        "ExecutionTime = 42.5 s  ClockTime = 43 s",
    ]
