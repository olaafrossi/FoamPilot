"""Parse OpenFOAM solver log output for residual data."""

from __future__ import annotations

import re
from typing import TypedDict

_RESIDUAL_RE = re.compile(
    r"Solving for (\w+), Initial residual = ([\d.e+-]+), "
    r"Final residual = ([\d.e+-]+), No Iterations (\d+)"
)


class ResidualEntry(TypedDict):
    iteration: int
    initial: float
    final: float
    no_iterations: int


def parse_residuals(log_lines: list[dict]) -> dict[str, list[ResidualEntry]]:
    """Parse residual data from a list of log entries.

    Args:
        log_lines: List of dicts with "line" and "stream" keys.

    Returns:
        Dict mapping field name to list of residual entries.
    """
    fields: dict[str, list[ResidualEntry]] = {}
    # Global iteration counter — incremented each time we see the first
    # field repeat, indicating a new time step.
    iteration = 0
    seen_in_step: set[str] = set()

    for entry in log_lines:
        line = entry.get("line", "")
        m = _RESIDUAL_RE.search(line)
        if not m:
            continue

        field = m.group(1)

        # Detect new time step: if we see a field we already saw in the
        # current step, a new step has begun.
        if field in seen_in_step:
            iteration += 1
            seen_in_step.clear()
        seen_in_step.add(field)

        if field not in fields:
            fields[field] = []

        fields[field].append(
            ResidualEntry(
                iteration=iteration,
                initial=float(m.group(2)),
                final=float(m.group(3)),
                no_iterations=int(m.group(4)),
            )
        )

    return fields
