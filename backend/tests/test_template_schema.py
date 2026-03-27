"""Tests for template.json schema validation across all templates."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# Resolve templates directory relative to test file
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "templates"

_REQUIRED_PHYSICS_FIELDS = {
    "domain_type",
    "velocity",
    "patchGroup",
    "liftDir",
    "dragDir",
    "magUInf",
    "lRef",
    "Aref",
}

_VALID_DOMAIN_TYPES = {"ground_vehicle", "freestream"}

# Learning templates (e.g. cavity, pitzDaily) use different solvers
# and don't need a physics section since they aren't used as scaffolds
_LEARNING_SOLVERS = {"icoFoam"}


def _template_dirs() -> list[Path]:
    """Return all template directories that have a template.json."""
    if not _TEMPLATES_DIR.is_dir():
        return []
    return sorted(
        d for d in _TEMPLATES_DIR.iterdir()
        if d.is_dir() and (d / "template.json").is_file()
    )


@pytest.mark.parametrize("tpl_dir", _template_dirs(), ids=lambda d: d.name)
class TestTemplateSchema:
    def test_template_json_is_valid(self, tpl_dir: Path):
        """template.json must parse as valid JSON."""
        meta_file = tpl_dir / "template.json"
        text = meta_file.read_text(encoding="utf-8")
        data = json.loads(text)
        assert isinstance(data, dict)
        assert "name" in data
        assert "solver" in data

    def test_template_has_physics_section(self, tpl_dir: Path):
        """Templates with a physics section must have all required fields."""
        meta_file = tpl_dir / "template.json"
        data = json.loads(meta_file.read_text(encoding="utf-8"))
        physics = data.get("physics")
        if physics is None:
            pytest.skip(f"{tpl_dir.name}: no physics section (learning/legacy template)")
        for field in _REQUIRED_PHYSICS_FIELDS:
            assert field in physics, f"{tpl_dir.name}: missing physics.{field}"

    def test_template_physics_domain_type_valid(self, tpl_dir: Path):
        """domain_type must be 'ground_vehicle' or 'freestream' when physics is present."""
        data = json.loads((tpl_dir / "template.json").read_text(encoding="utf-8"))
        physics = data.get("physics")
        if physics is None:
            pytest.skip(f"{tpl_dir.name}: no physics section")
        domain_type = physics.get("domain_type", "")
        assert domain_type in _VALID_DOMAIN_TYPES, (
            f"{tpl_dir.name}: domain_type '{domain_type}' not in {_VALID_DOMAIN_TYPES}"
        )

    def test_template_has_system_dir(self, tpl_dir: Path):
        """Every template must have a system/ directory."""
        assert (tpl_dir / "system").is_dir(), f"{tpl_dir.name}: missing system/"

    def test_template_has_boundary_conditions(self, tpl_dir: Path):
        """Every template must have a 0/ directory with boundary conditions."""
        assert (tpl_dir / "0").is_dir(), f"{tpl_dir.name}: missing 0/"

    def test_template_patch_group_in_files(self, tpl_dir: Path):
        """The declared patchGroup must appear in at least one template file."""
        data = json.loads((tpl_dir / "template.json").read_text(encoding="utf-8"))
        patch_group = data.get("physics", {}).get("patchGroup", "")
        if not patch_group:
            pytest.skip("No patchGroup defined")

        found = False
        for search_dir in [tpl_dir / "0", tpl_dir / "system"]:
            if not search_dir.is_dir():
                continue
            for f in search_dir.rglob("*"):
                if not f.is_file():
                    continue
                try:
                    if patch_group in f.read_text(encoding="utf-8"):
                        found = True
                        break
                except (UnicodeDecodeError, OSError):
                    continue
            if found:
                break

        assert found, (
            f"{tpl_dir.name}: patchGroup '{patch_group}' not found in 0/ or system/ files"
        )
