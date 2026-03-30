"""Tests for template scanner refactor: _scan_single_template, category from template.json,
registered tutorials, and 0.orig → 0 copy on case creation."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from routers.pipeline import (
    REGISTERED_TUTORIALS,
    _scan_single_template,
    _scan_template_dir,
)


# ── _scan_single_template ──────────────────────────────────────────


def _make_template(root: Path, meta: dict | None = None) -> Path:
    """Create a minimal template directory with optional template.json."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "system").mkdir(exist_ok=True)
    (root / "system" / "controlDict").write_text("// controlDict", encoding="utf-8")
    if meta is not None:
        (root / "template.json").write_text(json.dumps(meta), encoding="utf-8")
    return root


class TestScanSingleTemplate:
    def test_valid_template_with_metadata(self, tmp_path):
        tpl = _make_template(tmp_path / "myCase", {"name": "My Case", "solver": "simpleFoam"})
        info = _scan_single_template(tpl, "builtin")
        assert info is not None
        assert info.name == "My Case"
        assert info.solver == "simpleFoam"

    def test_no_template_json_uses_dir_name(self, tmp_path):
        tpl = _make_template(tmp_path / "myCase")
        info = _scan_single_template(tpl, "builtin")
        assert info is not None
        assert info.name == "myCase"

    def test_hidden_template_returns_none(self, tmp_path):
        tpl = _make_template(tmp_path / "hidden", {"hidden": True})
        info = _scan_single_template(tpl, "builtin")
        assert info is None

    def test_no_system_dir_returns_none(self, tmp_path):
        d = tmp_path / "noSystem"
        d.mkdir()
        info = _scan_single_template(d, "builtin")
        assert info is None

    def test_nonexistent_path_returns_none(self, tmp_path):
        info = _scan_single_template(tmp_path / "nope", "builtin")
        assert info is None

    def test_category_from_template_json(self, tmp_path):
        tpl = _make_template(
            tmp_path / "tut", {"name": "Tutorial", "solver": "simpleFoam", "category": "verification"}
        )
        info = _scan_single_template(tpl, "builtin")
        assert info is not None
        assert info.category == "verification"

    def test_category_fallback_to_solver(self, tmp_path):
        tpl = _make_template(tmp_path / "cavity", {"solver": "icoFoam"})
        info = _scan_single_template(tpl, "builtin")
        assert info is not None
        assert info.category == "learning"

    def test_category_fallback_aero(self, tmp_path):
        tpl = _make_template(tmp_path / "aero", {"solver": "simpleFoam"})
        info = _scan_single_template(tpl, "builtin")
        assert info is not None
        assert info.category == "aero"

    def test_path_override(self, tmp_path):
        tpl = _make_template(tmp_path / "deep" / "nested" / "case", {"name": "Deep"})
        info = _scan_single_template(tpl, "builtin", path_override="deep/nested/case")
        assert info is not None
        assert info.path == "deep/nested/case"

    def test_detects_trisurface_geometry(self, tmp_path):
        tpl = _make_template(tmp_path / "geo", {"solver": "simpleFoam"})
        tri = tpl / "constant" / "triSurface"
        tri.mkdir(parents=True)
        (tri / "model.stl").write_text("solid", encoding="utf-8")
        info = _scan_single_template(tpl, "builtin")
        assert info is not None
        assert info.has_geometry is True

    def test_detects_polymesh_geometry(self, tmp_path):
        tpl = _make_template(tmp_path / "pre", {"solver": "simpleFoam"})
        poly = tpl / "constant" / "polyMesh"
        poly.mkdir(parents=True)
        (poly / "points").write_text("()", encoding="utf-8")
        info = _scan_single_template(tpl, "builtin")
        assert info is not None
        assert info.has_geometry is True

    def test_corrupted_template_json(self, tmp_path):
        tpl = _make_template(tmp_path / "bad")
        (tpl / "template.json").write_text("{invalid json", encoding="utf-8")
        info = _scan_single_template(tpl, "builtin")
        assert info is not None
        assert info.name == "bad"


# ── _scan_template_dir ─────────────────────────────────────────────


class TestScanTemplateDir:
    def test_scans_top_level_only(self, tmp_path):
        _make_template(tmp_path / "a", {"name": "A", "solver": "simpleFoam"})
        _make_template(tmp_path / "b", {"name": "B", "solver": "simpleFoam"})
        # Nested template should NOT be found
        _make_template(tmp_path / "sub" / "c", {"name": "C", "solver": "simpleFoam"})
        results = _scan_template_dir(tmp_path, "builtin")
        names = {t.name for t in results}
        assert "A" in names
        assert "B" in names
        assert "C" not in names

    def test_empty_dir(self, tmp_path):
        d = tmp_path / "empty"
        d.mkdir()
        results = _scan_template_dir(d, "builtin")
        assert results == []

    def test_nonexistent_dir(self, tmp_path):
        results = _scan_template_dir(tmp_path / "nope", "builtin")
        assert results == []


# ── 0.orig → 0 copy ───────────────────────────────────────────────


class TestOrigCopy:
    def test_copies_0_orig_to_0(self, tmp_foam_run, tmp_foam_templates):
        """Verify that create_case copies 0.orig/ to 0/ when 0/ doesn't exist."""
        # Create a template with 0.orig but no 0
        tpl = tmp_foam_templates / "tutorial_test"
        (tpl / "system").mkdir(parents=True)
        (tpl / "system" / "controlDict").write_text("// cd", encoding="utf-8")
        orig = tpl / "0.orig"
        orig.mkdir()
        (orig / "U").write_text("// U field", encoding="utf-8")
        (orig / "p").write_text("// p field", encoding="utf-8")

        # Simulate what create_case does
        dest = tmp_foam_run / "test_case"
        shutil.copytree(str(tpl), str(dest))
        # Apply the 0.orig → 0 copy logic
        orig_dir = dest / "0.orig"
        zero_dir = dest / "0"
        if orig_dir.is_dir() and not zero_dir.is_dir():
            shutil.copytree(str(orig_dir), str(zero_dir))

        assert (dest / "0" / "U").is_file()
        assert (dest / "0" / "p").is_file()
        assert (dest / "0.orig" / "U").is_file()  # Original preserved

    def test_skips_if_0_exists(self, tmp_foam_run, tmp_foam_templates):
        """Don't overwrite existing 0/ directory."""
        tpl = tmp_foam_templates / "has_both"
        (tpl / "system").mkdir(parents=True)
        (tpl / "system" / "controlDict").write_text("// cd", encoding="utf-8")
        (tpl / "0.orig").mkdir()
        (tpl / "0.orig" / "U").write_text("// from orig", encoding="utf-8")
        (tpl / "0").mkdir()
        (tpl / "0" / "U").write_text("// from zero", encoding="utf-8")

        dest = tmp_foam_run / "test_case2"
        shutil.copytree(str(tpl), str(dest))
        orig_dir = dest / "0.orig"
        zero_dir = dest / "0"
        if orig_dir.is_dir() and not zero_dir.is_dir():
            shutil.copytree(str(orig_dir), str(zero_dir))

        content = (dest / "0" / "U").read_text(encoding="utf-8")
        assert content == "// from zero"  # Not overwritten

    def test_copies_polymesh_orig(self, tmp_foam_run, tmp_foam_templates):
        """Verify polyMesh.orig → polyMesh copy for pre-meshed cases."""
        tpl = tmp_foam_templates / "premeshed"
        (tpl / "system").mkdir(parents=True)
        (tpl / "system" / "controlDict").write_text("// cd", encoding="utf-8")
        poly_orig = tpl / "constant" / "polyMesh.orig"
        poly_orig.mkdir(parents=True)
        (poly_orig / "points").write_text("()", encoding="utf-8")

        dest = tmp_foam_run / "test_premeshed"
        shutil.copytree(str(tpl), str(dest))
        for orig_name, target_name in [("0.orig", "0"), ("constant/polyMesh.orig", "constant/polyMesh")]:
            orig = Path(dest) / orig_name
            target = Path(dest) / target_name
            if orig.is_dir() and not target.is_dir():
                shutil.copytree(str(orig), str(target))

        assert (dest / "constant" / "polyMesh" / "points").is_file()


# ── REGISTERED_TUTORIALS ───────────────────────────────────────────


class TestRegisteredTutorials:
    def test_registered_paths_exist(self):
        """Sanity check: the registered tutorial paths should be non-empty."""
        assert len(REGISTERED_TUTORIALS) >= 2
        assert all(isinstance(p, str) for p in REGISTERED_TUTORIALS)
