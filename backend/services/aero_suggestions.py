"""Aerodynamic parameter suggestion engine.

Given a geometry classification + freestream velocity, produces
recommended mesh, physics, and solver parameters.  All suggestions
are *advisory* — the user can override via the wizard editors.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from services.geometry import GeometryAnalysis, GeometryClass


# ── Physical constants ──────────────────────────────────────────────

AIR_RHO = 1.225  # kg/m³  (sea-level ISA)
AIR_MU = 1.8e-5  # Pa·s   (dynamic viscosity)
AIR_NU = AIR_MU / AIR_RHO  # m²/s   (kinematic viscosity)


# ── Data classes ────────────────────────────────────────────────────


@dataclass
class MeshSuggestion:
    """Recommended mesh parameters for snappyHexMesh + blockMesh."""
    domain_multiplier_upstream: float = 5.0
    domain_multiplier_downstream: float = 15.0
    domain_multiplier_side: float = 4.0
    domain_multiplier_top: float = 8.0
    surface_refinement_min: int = 5
    surface_refinement_max: int = 6
    feature_level: int = 6
    region_refinement_level: int = 4
    n_surface_layers: int = 5
    expansion_ratio: float = 1.2
    final_layer_thickness: float = 0.3
    first_layer_height: float | None = None  # set by y+ calculator
    y_plus_target: float = 30.0
    estimated_cells: int = 0
    rationale: str = ""


@dataclass
class PhysicsSuggestion:
    """Recommended physics/turbulence parameters."""
    reynolds_number: float = 0.0
    turbulence_model: str = "kOmegaSST"
    turbulence_model_rationale: str = ""
    freestream_k: float = 0.0
    freestream_omega: float = 0.0
    freestream_nut: float = 0.0
    inlet_velocity: tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclass
class SolverSuggestion:
    """Recommended solver settings."""
    solver_name: str = "simpleFoam"
    end_time: int = 500
    write_interval: int = 100
    convergence_target: float = 1e-4
    rationale: str = ""


@dataclass
class ConvergencePrediction:
    """Predicted convergence behaviour."""
    expected_iterations: int = 500
    confidence: str = "medium"  # low / medium / high
    risk_factors: list[str] = field(default_factory=list)
    status: str = "pending"  # pending / converging / stalled / diverged


@dataclass
class AeroSuggestions:
    """Complete suggestion bundle returned to the frontend."""
    mesh: MeshSuggestion
    physics: PhysicsSuggestion
    solver: SolverSuggestion
    convergence: ConvergencePrediction


# ── y+ calculator ───────────────────────────────────────────────────


def calc_y_plus(
    velocity: float,
    char_length: float,
    y_plus_target: float = 30.0,
) -> dict:
    """Calculate first cell height for a target y+.

    Uses flat-plate boundary layer correlation:
        Cf = 0.058 * Re_L^(-0.2)
        u_tau = sqrt(tau_w / rho) = U * sqrt(Cf/2)
        y = y+ * nu / u_tau

    Returns dict with y, Re, Cf, u_tau for display.
    """
    if velocity <= 0 or char_length <= 0:
        return {
            "first_cell_height": None,
            "re": 0,
            "cf": 0,
            "u_tau": 0,
            "y_plus_target": y_plus_target,
            "message": "Set velocity first",
        }

    re = velocity * char_length / AIR_NU
    if re < 100:
        return {
            "first_cell_height": None,
            "re": re,
            "cf": 0,
            "u_tau": 0,
            "y_plus_target": y_plus_target,
            "message": "Re too low for turbulent BL estimate",
        }

    cf = 0.058 * re ** (-0.2)
    u_tau = velocity * math.sqrt(cf / 2.0)
    y = y_plus_target * AIR_NU / u_tau

    return {
        "first_cell_height": y,
        "re": re,
        "cf": cf,
        "u_tau": u_tau,
        "y_plus_target": y_plus_target,
        "message": None,
    }


# ── Reynolds number ─────────────────────────────────────────────────


def calc_reynolds(velocity: float, char_length: float) -> float:
    """Reynolds number Re = U * L / nu."""
    if velocity <= 0 or char_length <= 0:
        return 0.0
    return velocity * char_length / AIR_NU


# ── Suggestion engine ───────────────────────────────────────────────


def suggest_parameters(
    analysis: GeometryAnalysis,
    velocity: float = 20.0,
) -> AeroSuggestions:
    """Generate full parameter suggestions from geometry analysis + velocity."""

    re = calc_reynolds(velocity, analysis.characteristic_length)
    geo = analysis.geometry_class

    # ── Mesh suggestions ──
    mesh = _suggest_mesh(analysis, velocity, re)

    # ── Physics suggestions ──
    physics = _suggest_physics(analysis, velocity, re)

    # ── Solver suggestions ──
    solver = _suggest_solver(analysis, re)

    # ── Convergence prediction ──
    convergence = _predict_convergence(analysis, re, mesh)

    return AeroSuggestions(
        mesh=mesh,
        physics=physics,
        solver=solver,
        convergence=convergence,
    )


def _suggest_mesh(
    analysis: GeometryAnalysis,
    velocity: float,
    re: float,
) -> MeshSuggestion:
    geo = analysis.geometry_class

    # Domain sizing per geometry class
    if geo == GeometryClass.streamlined:
        upstream, downstream, side, top = 5.0, 20.0, 5.0, 5.0
        surf_min, surf_max = 5, 7
        feature, region = 7, 5
        layers, exp_ratio = 8, 1.15
        rationale = (
            "Streamlined body — extended downstream domain for wake resolution, "
            "finer surface refinement for thin boundary layers."
        )
    elif geo == GeometryClass.bluff:
        upstream, downstream, side, top = 5.0, 15.0, 4.0, 8.0
        surf_min, surf_max = 5, 6
        feature, region = 6, 4
        layers, exp_ratio = 5, 1.2
        rationale = (
            "Bluff body — standard domain sizing, moderate surface refinement, "
            "5 boundary layers for wall-function approach."
        )
    else:  # complex
        upstream, downstream, side, top = 6.0, 18.0, 5.0, 10.0
        surf_min, surf_max = 6, 7
        feature, region = 7, 5
        layers, exp_ratio = 5, 1.2
        rationale = (
            "Complex geometry — conservative domain and refinement settings. "
            "Extra refinement to capture irregular features."
        )

    # y+ calculation
    yp = calc_y_plus(velocity, analysis.characteristic_length)
    first_layer = yp.get("first_cell_height")

    # Rough cell count estimate
    L = analysis.characteristic_length
    base_cells = 2_000_000 if geo == GeometryClass.bluff else 3_000_000
    if re > 1e7:
        base_cells = int(base_cells * 1.5)

    return MeshSuggestion(
        domain_multiplier_upstream=upstream,
        domain_multiplier_downstream=downstream,
        domain_multiplier_side=side,
        domain_multiplier_top=top,
        surface_refinement_min=surf_min,
        surface_refinement_max=surf_max,
        feature_level=feature,
        region_refinement_level=region,
        n_surface_layers=layers,
        expansion_ratio=exp_ratio,
        first_layer_height=first_layer,
        y_plus_target=30.0,
        estimated_cells=base_cells,
        rationale=rationale,
    )


def _suggest_physics(
    analysis: GeometryAnalysis,
    velocity: float,
    re: float,
) -> PhysicsSuggestion:
    # Turbulence model selection
    if re < 500_000:
        turb_model = "kOmegaSST"
        turb_rationale = (
            f"Re = {re:.0f} — transitional regime. "
            "k-omega SST handles transition well."
        )
    elif re < 1e7:
        turb_model = "kOmegaSST"
        turb_rationale = (
            f"Re = {re:.0f} — fully turbulent. "
            "k-omega SST is the standard choice for external aerodynamics."
        )
    else:
        turb_model = "kOmegaSST"
        turb_rationale = (
            f"Re = {re:.1e} — high Reynolds number. "
            "k-omega SST with wall functions."
        )

    # Turbulence inlet conditions (5% turbulence intensity)
    ti = 0.05
    k = 1.5 * (velocity * ti) ** 2
    # omega = k^0.5 / (Cmu^0.25 * L * 0.07) where Cmu=0.09
    cmu_025 = 0.09 ** 0.25  # ≈ 0.5477
    length_scale = 0.07 * analysis.characteristic_length
    omega = math.sqrt(k) / (cmu_025 * max(length_scale, 1e-6))
    nut = k / max(omega, 1e-6)

    return PhysicsSuggestion(
        reynolds_number=re,
        turbulence_model=turb_model,
        turbulence_model_rationale=turb_rationale,
        freestream_k=k,
        freestream_omega=omega,
        freestream_nut=nut,
        inlet_velocity=(velocity, 0.0, 0.0),
    )


def _suggest_solver(
    analysis: GeometryAnalysis,
    re: float,
) -> SolverSuggestion:
    geo = analysis.geometry_class

    if geo == GeometryClass.streamlined:
        end_time = 800
        rationale = "Streamlined bodies may need more iterations for wake to settle."
    elif geo == GeometryClass.bluff:
        end_time = 500
        rationale = "Bluff body — 500 iterations typically sufficient for SIMPLE."
    else:
        end_time = 1000
        rationale = "Complex geometry — extra iterations for safety."

    return SolverSuggestion(
        solver_name="simpleFoam",
        end_time=end_time,
        write_interval=max(end_time // 5, 50),
        convergence_target=1e-4,
        rationale=rationale,
    )


def _predict_convergence(
    analysis: GeometryAnalysis,
    re: float,
    mesh: MeshSuggestion,
) -> ConvergencePrediction:
    risks: list[str] = []
    confidence = "medium"

    if re > 5e6:
        risks.append(f"High Re ({re:.1e}) — convergence may be slow")
    if analysis.geometry_class == GeometryClass.complex:
        risks.append("Complex geometry — higher divergence risk")
        confidence = "low"
    if mesh.estimated_cells > 5_000_000:
        risks.append(f"Large mesh ({mesh.estimated_cells / 1e6:.1f}M cells) — longer per-iteration time")
    if analysis.warning:
        risks.append(f"Geometry warning: {analysis.warning}")
        confidence = "low"

    if analysis.geometry_class == GeometryClass.streamlined and re < 2e6:
        confidence = "high"

    expected = 300 if confidence == "high" else 500 if confidence == "medium" else 800

    return ConvergencePrediction(
        expected_iterations=expected,
        confidence=confidence,
        risk_factors=risks,
    )
