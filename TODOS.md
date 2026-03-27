# TODOS

## Deferred

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
**Added:** 2026-03-27
