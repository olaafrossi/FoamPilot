"""Shared fixtures for FoamPilot backend tests."""

from __future__ import annotations

import os
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
