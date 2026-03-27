"""Geometry classification and analysis service.

Classifies uploaded STL geometries into aerodynamic categories
(streamlined / bluff / complex) based on bounding box aspect ratios
and triangle density.  This classification drives downstream mesh
and physics parameter suggestions.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

from services.config_generator import BoundingBox


class GeometryClass(str, Enum):
    streamlined = "streamlined"
    bluff = "bluff"
    complex = "complex"


@dataclass
class GeometryAnalysis:
    geometry_class: GeometryClass
    characteristic_length: float  # metres — longest bbox dimension
    frontal_area: float  # m² — Y×Z cross-section (approx)
    wetted_area_estimate: float  # m² — rough estimate from triangle count
    aspect_ratio: float  # length / max(width, height)
    description: str  # human-readable explanation
    warning: str | None = None


def classify_geometry(bbox: BoundingBox) -> GeometryAnalysis:
    """Classify geometry from its bounding box and triangle count.

    Heuristic rules:
    - aspect_ratio > 4  → streamlined (wings, airfoils, rockets)
    - aspect_ratio 1.5–4 → bluff (cars, Ahmed body, buildings)
    - aspect_ratio < 1.5 OR degenerate → complex (compact/irregular shapes)

    Zero-thickness geometries (flat plates) are classified as streamlined
    with a warning.
    """
    sx, sy, sz = bbox.size_x, bbox.size_y, bbox.size_z
    char_length = max(sx, sy, sz, 1e-6)
    frontal_area = sy * sz  # Y × Z cross-section approximation
    # Rough wetted area: assume average triangle area ≈ (char_length / sqrt(N))²
    if bbox.num_triangles > 0:
        avg_edge = char_length / math.sqrt(bbox.num_triangles)
        wetted_area_estimate = 0.5 * avg_edge * avg_edge * bbox.num_triangles * math.sqrt(3) / 2
    else:
        wetted_area_estimate = 2.0 * (sx * sy + sy * sz + sx * sz)

    # Aspect ratio: longest dim / max of the other two
    dims = sorted([sx, sy, sz])
    cross = max(dims[0], dims[1], 1e-6)
    aspect_ratio = dims[2] / cross

    warning = None

    # Check for zero-thickness (flat plate)
    min_dim = min(sx, sy, sz)
    if min_dim < 0.001:
        geo_class = GeometryClass.streamlined
        description = (
            "Flat plate or zero-thickness geometry — classified as streamlined. "
            "Consider whether this is intentional."
        )
        warning = "Zero-thickness geometry detected — one dimension < 0.001 m"
    elif bbox.num_triangles == 0:
        geo_class = GeometryClass.complex
        description = "No triangles found — using complex defaults."
        warning = "Degenerate STL with 0 triangles"
    elif aspect_ratio > 4.0:
        geo_class = GeometryClass.streamlined
        description = (
            f"High aspect ratio ({aspect_ratio:.1f}) — likely a wing, airfoil, "
            "or slender body.  Expect attached flow over most of the surface."
        )
    elif aspect_ratio >= 1.5:
        geo_class = GeometryClass.bluff
        description = (
            f"Moderate aspect ratio ({aspect_ratio:.1f}) — likely a vehicle, "
            "Ahmed body, or bluff body.  Expect separated wake region."
        )
    else:
        geo_class = GeometryClass.complex
        description = (
            f"Low aspect ratio ({aspect_ratio:.1f}) — compact or irregular shape. "
            "Using conservative mesh settings."
        )

    return GeometryAnalysis(
        geometry_class=geo_class,
        characteristic_length=char_length,
        frontal_area=frontal_area,
        wetted_area_estimate=wetted_area_estimate,
        aspect_ratio=aspect_ratio,
        description=description,
        warning=warning,
    )
