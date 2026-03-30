# OpenFOAM Tutorial Templates

Seed this directory with tutorial cases from the OpenFOAM installation.
Inside the container, tutorials live at `$WM_PROJECT_DIR/tutorials/`.

## Cases to copy

| Case | Source path (in container) | Purpose |
|------|---------------------------|---------|
| **cavity** | `$FOAM_TUTORIALS/incompressible/icoFoam/cavity/cavity` | Lid-driven cavity — the "hello world" of CFD. Steady laminar flow, simple blockMesh geometry. |
| **pitzDaily** | `$FOAM_TUTORIALS/incompressible/simpleFoam/pitzDaily` | Backward-facing step with turbulence (k-epsilon). Good for testing steady-state RANS workflows. |

## How to seed (run inside the container)

```bash
source /usr/lib/openfoam/openfoam2512/etc/bashrc
cp -r $FOAM_TUTORIALS/incompressible/icoFoam/cavity/cavity   /home/openfoam/templates/cavity
cp -r $FOAM_TUTORIALS/incompressible/simpleFoam/pitzDaily     /home/openfoam/templates/pitzDaily
```

These templates are mounted read-only into the container. The backend copies
them into `$FOAM_RUN` when a user creates a new simulation.
