#!/bin/bash

# ── Source OpenFOAM environment ──────────────────────────────────────
# OpenFOAM's bashrc and config.sh/setup use bash features (local outside
# function context, unset variables) that break under strict modes.
# Source it first with no shell options, then enable strict mode after.
FOAM_BASHRC="/usr/lib/openfoam/openfoam2512/etc/bashrc"
if [ -f "$FOAM_BASHRC" ]; then
    # shellcheck disable=SC1090
    . "$FOAM_BASHRC" || true
else
    echo "ERROR: OpenFOAM bashrc not found at $FOAM_BASHRC" >&2
    exit 1
fi

set -eo pipefail

# ── Ensure run directory exists and is writable ──────────────────────
if [ ! -d "$FOAM_RUN" ]; then
    echo "WARNING: FOAM_RUN ($FOAM_RUN) does not exist, creating it" >&2
    mkdir -p "$FOAM_RUN"
fi

if [ ! -w "$FOAM_RUN" ]; then
    echo "ERROR: FOAM_RUN ($FOAM_RUN) is not writable by $(whoami)" >&2
    exit 1
fi

# ── Quick OpenFOAM sanity check ──────────────────────────────────────
if ! blockMesh -help >/dev/null 2>&1; then
    echo "ERROR: blockMesh not found — OpenFOAM environment may not be loaded" >&2
    exit 1
fi

echo "OpenFOAM $(blockMesh -help 2>&1 | head -1) ready"
echo "FOAM_RUN=$FOAM_RUN"

# ── Launch backend ───────────────────────────────────────────────────
cd /app
exec uvicorn main:app --host 0.0.0.0 --port 8000
