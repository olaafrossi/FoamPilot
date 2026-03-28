# FoamPilot

Aerodynamics made simple — guided OpenFOAM simulations.

## Architecture

- **Frontend:** Electron + React (TypeScript) in `electron-ui/`
- **Backend:** FastAPI (Python) in `backend/`
- **Infrastructure:** Docker + Docker Compose in `docker/`

## gstack Skills

gstack is installed in `.claude/skills/gstack`. Available slash commands:

- `/plan-ceo-review` — CEO-level product review
- `/plan-eng-review` — Engineering manager architecture review
- `/plan-design-review` — Design review
- `/review` — Code review
- `/qa` — QA with real browser testing
- `/ship` — Ship checklist
- `/browse` — Browser-based testing and dogfooding
- `/investigate` — Deep investigation of issues
- `/retro` — Post-mortem retrospective

Use `/browse` from gstack for all web browsing tasks.
