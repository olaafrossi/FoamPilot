# TODOS

## Deferred

### Sample Geometry Files for New Templates
**What:** Source or create freely-licensed STL geometry files for the raceCar, smallPlane, and fixedWingDrone templates.
**Why:** Templates without geometry show "Bring your own STL" in the wizard. Adding sample geometry makes them fully runnable out of the box (click template, mesh, solve, visualize).
**Pros:** Complete out-of-box experience for all templates, better onboarding.
**Cons:** Requires finding/creating good representative STLs with compatible licenses. OpenFOAM tutorials include Ahmed body (simplified car shape), various airfoil geometries. Community has freely available STLs.
**Context:** The templates at `templates/raceCar/`, `templates/smallPlane/`, `templates/fixedWingDrone/` have all dicts configured but no `constant/triSurface/` geometry files. motorBike has `motorBike.obj.gz`. Each new template needs a representative geometry: simplified car body (~50K-200K triangles), NACA wing extrusion, and a drone frame or wing.
**Depends on:** Nothing. Templates work for custom STL upload without this.
**Added:** 2026-03-27

### SVG Silhouette Thumbnails for Template Cards
**What:** Create simple SVG silhouette illustrations for each template (car profile, plane profile, drone profile, motorcycle profile) to use as card thumbnails in the wizard.
**Why:** Visual differentiation at a glance. Lucide icons work but custom silhouettes make each card feel unique and premium.
**Pros:** Instant recognition, premium feel, matches industrial aesthetic.
**Cons:** Requires design work or sourcing SVGs. Not blocking.
**Context:** Template cards in `GeometryStep.tsx` currently use Lucide icons (Car, Plane, Radio, Bike). Simple outline/silhouette style that matches the DESIGN.md industrial aesthetic would be the 10/10 solution.
**Depends on:** Nothing.
**Added:** 2026-03-27

### Web Worker for Streamline Computation
**What:** Offload `traceStreamlines()` from `streamlines.ts` to a Web Worker so the UI doesn't freeze during RK4 integration on large meshes.
**Why:** Main-thread tracing takes ~100-500ms on typical meshes (100K triangles). On larger meshes (500K+), this could cause noticeable UI freezes.
**Pros:** Zero-freeze streamline computation, better UX on heavy cases.
**Cons:** Requires Vite worker bundling setup (`import MyWorker from './worker?worker'`), ~20min CC effort.
**Context:** The `traceStreamlines()` function in `electron-ui/src/lib/streamlines.ts` is pure math with zero DOM dependencies — perfect worker candidate. The current implementation uses `useMemo` gated on the streamlines toggle. To convert: create a worker that imports `traceStreamlines`, post message with vertices/faces/vectors/seeds, return polylines.
**Depends on:** Streamline rendering implementation (animated TubeGeometry).
**Added:** 2026-03-27

### 'Run Again with Different Settings' Clone-and-Iterate
**What:** Add a "Run Again with Different Settings" button on the Results page that clones the current case and re-enters the wizard at the Physics step with modified parameters.
**Why:** Bridge to parametric studies — lets users iterate on a design without losing previous results. The most natural next action after seeing Cd/Cl numbers.
**Pros:** Enables rapid design iteration, preserves history of runs.
**Cons:** Requires case cloning logic, ~1-2hr CC effort.
**Context:** The backend already has a `POST /cases/{name}/clone` endpoint. The UI would clone the case, navigate to Physics step, and let the user adjust velocity/BCs before re-running. Results comparison view would be a natural follow-on.
**Depends on:** Wizard-first rearchitecture (current work).
## Aero Knowledge Engine Phase 2

### Laminar Solver Path (icoFoam)
**What:** Add icoFoam as an alternative solver for Re < 2000 with streamlined geometries.
**Why:** Some educational cases (creeping flow, Stokes drag) need laminar solvers. Not relevant for most aero use cases but completes the Re spectrum.
**Pros:** Full Re range coverage, better for educational cases.
**Cons:** Requires separate case setup: different BCs (fixedValue/zeroGradient without turbulence fields), different fvSchemes (no turbulence discretization), different fvSolution, different controlDict (transient with deltaT). Significant config generation work.
**Context:** v1 uses simpleFoam + k-omega SST for all cases. icoFoam path requires regenerating the entire 0/, system/ directory structure.
**Effort:** S (CC: ~15 min) | **Priority:** P3
**Depends on:** Aero Knowledge Engine v1 (baseline rules module).
**Added:** 2026-03-27

### Wall-Resolved y+ Path
**What:** Support y+ ~ 1 wall-resolved meshing for low-Re streamlined bodies (Re < 50K).
**Why:** Wall-function approach (y+ ~ 30) is less accurate for attached boundary layers at low Re. Students studying boundary layer theory benefit from seeing resolved profiles.
**Pros:** More accurate BL prediction, educational value.
**Cons:** Requires ~20 prism layers (vs 5), much higher cell count, longer solve times.
**Context:** v1 targets y+ ~ 30 wall-function for all cases. This path would add a toggle: "Resolve boundary layer (slower, more accurate)."
**Effort:** M (CC: ~30 min) | **Priority:** P3
**Depends on:** Aero Knowledge Engine v1.
**Added:** 2026-03-27

### k-epsilon Turbulence Model Alternative
**What:** Offer k-epsilon as an alternative to k-omega SST for fully turbulent high-Re cases (Re > 10^7).
**Why:** k-epsilon is more robust for fully turbulent flows far from walls. Some industrial cases prefer it.
**Pros:** Better convergence for very high Re, familiar to industrial users.
**Cons:** Requires additional BC templates, fvSchemes/fvSolution variants.
**Context:** v1 uses k-omega SST exclusively. k-epsilon would be a dropdown alternative in the Physics step.
**Effort:** S (CC: ~15 min) | **Priority:** P3
**Depends on:** Aero Knowledge Engine v1.
**Added:** 2026-03-27

### Auto-Run Grid Independence Study
**What:** Automatically run coarse/medium/fine meshes, solve each, and compare Cd/Cl values with a convergence plot.
**Why:** Grid independence is the gold standard for CFD validation. Manual execution of 3 separate runs is tedious and error-prone.
**Pros:** One-click academic rigor, differentiation for student audience, publishable results.
**Cons:** 3x solve time, requires job queue modifications (currently single-run), result comparison logic, UI for comparative plots.
**Context:** v1 generates 3 configs but user runs them manually. This would orchestrate the full study: mesh all three, solve all three, parse force coefficients, plot convergence, estimate grid convergence index (GCI per Roache).
**Effort:** L (CC: ~1.5 hours) | **Priority:** P2
**Depends on:** Aero Knowledge Engine v1, Mesh Independence Config Generation.
**Added:** 2026-03-27

### fvSchemes/fvSolution Adaptation per Turbulence Model
**What:** Generate fvSchemes and fvSolution that match the selected turbulence model.
**Why:** Currently hardcoded for k-omega SST. When multiple models are supported, schemes and solver settings must be consistent.
**Pros:** Correct discretization per model, prevents divergence from mismatched settings.
**Cons:** Adds complexity to config_generator.py, needs test matrix of model x scheme combinations.
**Context:** v1 uses k-omega SST only so this isn't needed yet. Becomes required when k-epsilon or laminar paths are added.
**Effort:** M (CC: ~30 min) | **Priority:** P2
**Depends on:** k-epsilon alternative, laminar solver path.
**Added:** 2026-03-27

### Run Step Iteration Suggestion
**What:** Add a `/suggest/run` endpoint that recommends iteration count and endTime based on mesh size, solver, and expected convergence rate.
**Why:** "How many iterations should I run?" is the #1 question beginners ask. The convergence predictor helps DURING the run, but a good starting guess prevents under/over-running.
**Pros:** Better first-run experience, fewer "my simulation didn't converge" complaints.
**Cons:** Prediction accuracy varies widely by case (100-10,000 iterations for simpleFoam).
**Context:** v1 uses template defaults (e.g., 500 iterations for motorBike). This would estimate based on mesh cell count and flow complexity.
**Effort:** S (CC: ~15 min) | **Priority:** P2
**Depends on:** Aero Knowledge Engine v1.
**Added:** 2026-03-27
