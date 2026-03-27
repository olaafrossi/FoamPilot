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
