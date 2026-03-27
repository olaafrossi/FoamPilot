# TODOS

## Deferred

## DictEditor Refactor to Reusable UserControl
**Priority:** Medium | **Effort:** human: ~1 week / CC: ~30 min
**What:** Extract DictEditorPage into a reusable UserControl that can be embedded in other pages (wizard, future compare view, template editor).
**Why:** The wizard uses a simpler inline editor that duplicates some DictEditor functionality. When file editing appears in a 3rd place, the duplication becomes unmaintainable.
**Context:** Deferred from the wizard PR to avoid risky refactor. Currently tightly coupled to navigation context, DI, case selection, and dialog patterns. The reflection-based GetModel() pattern in code-behind makes extraction harder.
**Trigger:** When file editing is needed in a 3rd location beyond DictEditor page and wizard.
**Depends on:** Wizard ships first. GetModel() reflection cleanup (below) is a nice-to-have prerequisite.

## Version-Pinned Backend Docker Updates
**Priority:** Medium | **Effort:** human: ~4 days / CC: ~15 min
**What:** When the UI auto-updates via Velopack, automatically detect if the Docker backend image version mismatches and prompt the user to pull the new image. Ship a `docker-compose.yml` that pins the backend image tag to a matching version (e.g., `ghcr.io/olaafrossi/foampilot-backend:v0.2.0`).
**Why:** Frontend and backend share an API contract. If the UI updates but the backend stays on an old version, new API endpoints or schema changes will break silently. Currently deferred — users must manually pull new Docker images when instructed by release notes.
**Context:** Deferred from the auto-update PR to limit scope. The auto-update only covers the desktop UI via Velopack. Backend runs in Docker with its own lifecycle. Start by adding a `/version` endpoint to the FastAPI backend that returns the expected API version, then compare it in the UI on startup.
**Depends on:** Auto-update system must ship first. Backend CI/CD for publishing Docker images to GHCR.

## WinGet Manifest Submission
**Priority:** Low | **Effort:** human: ~2 hours / CC: ~10 min
**What:** After the first successful GitHub Release with Velopack, submit a WinGet manifest to `microsoft/winget-pkgs` so users can `winget install FoamPilot`.
**Why:** Secondary distribution channel for discoverability. Windows users who prefer package managers can install and update via `winget upgrade`.
**Context:** WinGet manifests are YAML files submitted as PRs to the winget-pkgs community repo. Can be automated with `wingetcreate` in CI. Not critical since the primary audience (OpenFOAM users) will likely find FoamPilot through academic/CFD channels rather than WinGet search.
**Depends on:** First successful GitHub Release with Velopack packaging.

## Replace Reflection-Based GetModel() Pattern
**Priority:** Low | **Effort:** human: ~2 hours / CC: ~10 min
**What:** Replace `DataContext?.GetType().GetProperty("Model")?.GetValue(DataContext) as XModel` with a typed base class or interface across all page code-behind files.
**Why:** Runtime reflection with silent null return — no compile-time safety. Used in LogsPage, SettingsPage, DictEditorPage, RunControlPage, and will be used in WizardPage.
**Context:** Pre-existing tech debt. Needs investigation into Uno MVUX internals to find the correct typed accessor pattern. May require changes to all 6+ page code-behind files.
**Depends on:** Nothing. Can be done independently.

## 'Run Again with Different Settings' (Clone-and-Iterate)
**Priority:** P2 | **Effort:** human: ~4 hours / CC: ~10 min
**What:** Add a "Run Again with Different Settings" button on the wizard results page that clones the case and returns the user to the Physics step (Step 2) with the cloned case.
**Why:** Enables the iterate-fast workflow — a drone builder tests at 10 m/s, 20 m/s, 30 m/s without re-meshing. Bridge to parametric studies.
**Pros:** Simple to build (POST `/cases/{name}/clone` already exists). Unlocks the comparison workflow.
**Cons:** Need to track parent-child case relationships for meaningful comparison. UI for comparing results across runs doesn't exist yet.
**Context:** Deferred from the wizard-first rearchitecture (CEO review 2026-03-26). The clone API exists. The main work is UI: a results comparison view showing Cd/Cl across multiple runs.
**Depends on:** Wizard rearchitecture must ship first. Results summary card (forceCoeffs parsing) must exist.

## In-App Pressure Contour Rendering
**Priority:** P2 | **Effort:** human: ~2 weeks / CC: ~3 hours
**What:** Extend the WebView2 3D viewer to display pressure/velocity contours on the mesh surface using VTK.js or a custom OpenFOAM → Three.js data pipeline.
**Why:** The "never leave the app" north star. Users see results without ParaView. Eliminates the biggest external dependency for hobbyists.
**Pros:** Massive 'whoa' moment. ParaView becomes optional for basic visualization. Keeps the user in the guided flow.
**Cons:** Requires parsing OpenFOAM field data (binary or ASCII) and mapping to Three.js vertex colors. VTK.js is an option but heavyweight. Custom pipeline is lighter but more work.
**Context:** Deferred from the wizard-first rearchitecture (CEO review 2026-03-26). The 3D mesh preview (WebView2 + Three.js) ships in this plan — this TODO extends it to show simulation results, not just the mesh.
**Depends on:** 3D mesh preview (Expansion 1) must ship first. Solver must write results to time directories.

## AI Mesh Assistant
**Priority:** P3 | **Effort:** human: ~1 month / CC: ~1 week (research + implementation)
**What:** Upload any STL → AI analyzes geometry (complexity, feature sizes, thin walls, leading/trailing edges) → auto-generates optimal snappyHexMesh config with targeted refinement regions, boundary layer settings, and quality targets.
**Why:** The current auto-config uses bounding box only — it can't distinguish a thin airfoil from a bluff body. AI-driven mesh settings would make FoamPilot genuinely intelligent about CFD.
**Pros:** The 10x vision's ultimate expression. Differentiates FoamPilot from every other OpenFOAM GUI.
**Cons:** Research-heavy. Options: (1) LLM with geometry context (describe the STL features in text, ask for mesh settings), (2) rule-based geometry analysis (curvature, feature size detection), (3) trained model on OpenFOAM mesh quality outcomes.
**Context:** Deferred from the wizard-first rearchitecture (CEO review 2026-03-26). Needs real user feedback on where bounding-box auto-config fails before investing in AI. Start by instrumenting which custom STL uploads produce bad meshes and why.
**Depends on:** STL upload + auto-config generation must ship first. Need data on failure modes.

### Web Worker for Streamline Computation
**What:** Offload `traceStreamlines()` from `streamlines.ts` to a Web Worker so the UI doesn't freeze during RK4 integration on large meshes.
**Why:** Main-thread tracing takes ~100-500ms on typical meshes (100K triangles). On larger meshes (500K+), this could cause noticeable UI freezes.
**Pros:** Zero-freeze streamline computation, better UX on heavy cases.
**Cons:** Requires Vite worker bundling setup (`import MyWorker from './worker?worker'`), ~20min CC effort.
**Context:** The `traceStreamlines()` function in `electron-ui/src/lib/streamlines.ts` is pure math with zero DOM dependencies — perfect worker candidate. The current implementation uses `useMemo` gated on the streamlines toggle. To convert: create a worker that imports `traceStreamlines`, post message with vertices/faces/vectors/seeds, return polylines.
**Depends on:** Streamline rendering implementation (animated TubeGeometry).
**Added:** 2026-03-27
