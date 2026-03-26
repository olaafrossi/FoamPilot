"""Tests for the pipeline state machine and validation rules."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.pipeline_service import (
    Pipeline,
    PipelineState,
    ValidationResult,
    _brace_balance,
    _extract_keyword_value,
    _file_exists,
    _time_range_valid,
    delete_pipeline,
    load_pipeline,
    save_pipeline,
    validate_for_state,
)


# ── State Machine Transitions ───────────────────────────────────────


class TestPipelineTransitions:
    """Test valid and invalid state transitions."""

    def test_draft_to_meshed(self):
        p = Pipeline(case_name="test")
        assert p.state == PipelineState.DRAFT
        p.advance(PipelineState.MESHED)
        assert p.state == PipelineState.MESHED

    def test_meshed_to_configured(self):
        p = Pipeline(case_name="test", state=PipelineState.MESHED)
        p.advance(PipelineState.CONFIGURED)
        assert p.state == PipelineState.CONFIGURED

    def test_configured_to_complete(self):
        p = Pipeline(case_name="test", state=PipelineState.CONFIGURED)
        p.advance(PipelineState.COMPLETE)
        assert p.state == PipelineState.COMPLETE

    def test_any_to_failed(self):
        for state in (PipelineState.DRAFT, PipelineState.MESHED, PipelineState.CONFIGURED):
            p = Pipeline(case_name="test", state=state)
            p.advance(PipelineState.FAILED)
            assert p.state == PipelineState.FAILED

    def test_cannot_skip_states(self):
        p = Pipeline(case_name="test")
        with pytest.raises(ValueError, match="Cannot transition"):
            p.advance(PipelineState.CONFIGURED)  # skips MESHED

    def test_cannot_transition_from_complete(self):
        p = Pipeline(case_name="test", state=PipelineState.COMPLETE)
        with pytest.raises(ValueError, match="Cannot transition"):
            p.advance(PipelineState.DRAFT)

    def test_cannot_go_backward(self):
        p = Pipeline(case_name="test", state=PipelineState.MESHED)
        with pytest.raises(ValueError, match="Cannot transition"):
            p.advance(PipelineState.DRAFT)

    def test_draft_to_complete_invalid(self):
        p = Pipeline(case_name="test")
        with pytest.raises(ValueError):
            p.advance(PipelineState.COMPLETE)

    def test_can_transition_to(self):
        p = Pipeline(case_name="test")
        assert p.can_transition_to(PipelineState.MESHED)
        assert p.can_transition_to(PipelineState.FAILED)
        assert not p.can_transition_to(PipelineState.COMPLETE)
        assert not p.can_transition_to(PipelineState.CONFIGURED)


# ── Reset from FAILED ───────────────────────────────────────────────


class TestPipelineReset:
    def test_reset_from_failed_to_draft(self):
        p = Pipeline(case_name="test", state=PipelineState.FAILED)
        p.reset_to(PipelineState.DRAFT)
        assert p.state == PipelineState.DRAFT

    def test_reset_from_failed_to_meshed(self):
        p = Pipeline(case_name="test", state=PipelineState.FAILED)
        p.reset_to(PipelineState.MESHED)
        assert p.state == PipelineState.MESHED

    def test_reset_from_failed_to_configured(self):
        p = Pipeline(case_name="test", state=PipelineState.FAILED)
        p.reset_to(PipelineState.CONFIGURED)
        assert p.state == PipelineState.CONFIGURED

    def test_reset_clears_errors(self):
        p = Pipeline(case_name="test", state=PipelineState.FAILED)
        p.validation_errors = [{"rule": "test", "passed": False}]
        p.active_job_id = "abc123"
        p.reset_to(PipelineState.DRAFT)
        assert p.validation_errors == []
        assert p.active_job_id is None

    def test_cannot_reset_from_non_failed(self):
        p = Pipeline(case_name="test", state=PipelineState.MESHED)
        with pytest.raises(ValueError, match="only reset from FAILED"):
            p.reset_to(PipelineState.DRAFT)

    def test_cannot_reset_to_complete(self):
        p = Pipeline(case_name="test", state=PipelineState.FAILED)
        with pytest.raises(ValueError, match="Cannot reset to"):
            p.reset_to(PipelineState.COMPLETE)

    def test_cannot_reset_to_failed(self):
        p = Pipeline(case_name="test", state=PipelineState.FAILED)
        with pytest.raises(ValueError, match="Cannot reset to"):
            p.reset_to(PipelineState.FAILED)


# ── Step Tracking ───────────────────────────────────────────────────


class TestStepTracking:
    def test_mark_step(self):
        p = Pipeline(case_name="test")
        p.mark_step("mesh", "complete", exit_code=0)
        assert p.steps["mesh"]["status"] == "complete"
        assert p.steps["mesh"]["exit_code"] == 0

    def test_mark_step_preserves_other_fields(self):
        p = Pipeline(case_name="test")
        p.mark_step("mesh", "running", command="blockMesh")
        p.mark_step("mesh", "complete", exit_code=0)
        assert p.steps["mesh"]["command"] == "blockMesh"
        assert p.steps["mesh"]["exit_code"] == 0

    def test_mark_unknown_step_noop(self):
        p = Pipeline(case_name="test")
        p.mark_step("nonexistent", "complete")
        assert "nonexistent" not in p.steps


# ── Serialization ───────────────────────────────────────────────────


class TestSerialization:
    def test_to_dict_roundtrip(self):
        p = Pipeline(case_name="cavity", template="lid-driven-cavity")
        p.mark_step("mesh", "complete", exit_code=0)
        d = p.to_dict()
        p2 = Pipeline.from_dict(d)
        assert p2.id == p.id
        assert p2.case_name == "cavity"
        assert p2.template == "lid-driven-cavity"
        assert p2.state == PipelineState.DRAFT
        assert p2.steps["mesh"]["status"] == "complete"

    def test_to_dict_includes_all_fields(self):
        p = Pipeline(case_name="test")
        d = p.to_dict()
        assert "id" in d
        assert "case_name" in d
        assert "template" in d
        assert "state" in d
        assert "created_at" in d
        assert "steps" in d
        assert "active_job_id" in d
        assert "validation_errors" in d

    def test_from_dict_with_state(self):
        p = Pipeline(case_name="test", state=PipelineState.MESHED)
        d = p.to_dict()
        p2 = Pipeline.from_dict(d)
        assert p2.state == PipelineState.MESHED


# ── Persistence ─────────────────────────────────────────────────────


class TestPersistence:
    def test_save_and_load(self, sample_case, tmp_foam_run):
        p = Pipeline(case_name="cavity", template="lid-driven-cavity")
        p.mark_step("mesh", "complete")
        save_pipeline(p)

        loaded = load_pipeline("cavity")
        assert loaded is not None
        assert loaded.id == p.id
        assert loaded.case_name == "cavity"
        assert loaded.steps["mesh"]["status"] == "complete"

    def test_load_nonexistent(self, tmp_foam_run):
        assert load_pipeline("nonexistent") is None

    def test_load_corrupted_json(self, sample_case, tmp_foam_run):
        pipeline_dir = sample_case / ".foampilot"
        pipeline_dir.mkdir()
        (pipeline_dir / "pipeline.json").write_text("not valid json{{{")
        assert load_pipeline("cavity") is None

    def test_load_missing_keys(self, sample_case, tmp_foam_run):
        pipeline_dir = sample_case / ".foampilot"
        pipeline_dir.mkdir()
        (pipeline_dir / "pipeline.json").write_text('{"some": "data"}')
        assert load_pipeline("cavity") is None

    def test_delete_pipeline(self, sample_case, tmp_foam_run):
        p = Pipeline(case_name="cavity")
        save_pipeline(p)
        assert load_pipeline("cavity") is not None
        assert delete_pipeline("cavity") is True
        assert load_pipeline("cavity") is None

    def test_delete_nonexistent(self, tmp_foam_run):
        assert delete_pipeline("nonexistent") is False

    def test_pipeline_file_location(self, sample_case, tmp_foam_run):
        p = Pipeline(case_name="cavity")
        save_pipeline(p)
        expected = sample_case / ".foampilot" / "pipeline.json"
        assert expected.is_file()
        data = json.loads(expected.read_text())
        assert data["case_name"] == "cavity"


# ── Tier 1 Validation Rules ────────────────────────────────────────


class TestFileExistsValidation:
    def test_file_exists(self, sample_case):
        r = _file_exists(str(sample_case), "system/blockMeshDict")
        assert r.passed is True

    def test_file_missing(self, sample_case):
        r = _file_exists(str(sample_case), "system/nonexistent")
        assert r.passed is False
        assert "not found" in r.message.lower()


class TestBraceBalanceValidation:
    def test_balanced(self, sample_case):
        r = _brace_balance(str(sample_case), "system/blockMeshDict")
        assert r.passed is True

    def test_unbalanced(self, sample_case):
        bad_file = sample_case / "system" / "bad.dict"
        bad_file.write_text("FoamFile { version 2.0; {\n")
        r = _brace_balance(str(sample_case), "system/bad.dict")
        assert r.passed is False
        assert "unbalanced" in r.message.lower()

    def test_missing_file(self, sample_case):
        r = _brace_balance(str(sample_case), "system/nope")
        assert r.passed is False


class TestTimeRangeValidation:
    def test_valid_range(self, sample_case):
        r = _time_range_valid(str(sample_case))
        assert r.passed is True

    def test_invalid_range(self, sample_case):
        cd = sample_case / "system" / "controlDict"
        text = cd.read_text().replace("endTime         0.5", "endTime         0")
        cd.write_text(text)
        r = _time_range_valid(str(sample_case))
        assert r.passed is False
        assert "must be less than" in r.message

    def test_missing_controldict(self, tmp_path):
        r = _time_range_valid(str(tmp_path))
        assert r.passed is False

    def test_non_numeric_times(self, sample_case):
        cd = sample_case / "system" / "controlDict"
        text = cd.read_text().replace("startTime       0", "startTime       latestTime")
        cd.write_text(text)
        r = _time_range_valid(str(sample_case))
        assert r.passed is False
        assert "non-numeric" in r.message.lower()


class TestExtractKeywordValue:
    def test_simple(self):
        text = "application     icoFoam;\nstartTime       0;\n"
        assert _extract_keyword_value(text, "application") == "icoFoam"
        assert _extract_keyword_value(text, "startTime") == "0"

    def test_not_found(self):
        assert _extract_keyword_value("foo bar;", "baz") is None

    def test_with_tabs(self):
        text = "endTime\t\t0.5;"
        assert _extract_keyword_value(text, "endTime") == "0.5"


class TestValidateForState:
    def test_mesh_validation(self, sample_case):
        results = validate_for_state(str(sample_case), PipelineState.MESHED)
        assert len(results) == 2  # file_exists + brace_balance
        assert all(r.passed for r in results)

    def test_configured_validation(self, sample_case):
        results = validate_for_state(str(sample_case), PipelineState.CONFIGURED)
        assert len(results) == 7  # 3 file_exists + 3 brace_balance + time_range
        assert all(r.passed for r in results)

    def test_complete_validation(self, sample_case):
        results = validate_for_state(str(sample_case), PipelineState.COMPLETE)
        assert len(results) == 2  # file_exists + time_range
        assert all(r.passed for r in results)

    def test_mesh_validation_fails_missing_file(self, tmp_path):
        case = tmp_path / "empty_case"
        case.mkdir()
        (case / "system").mkdir()
        results = validate_for_state(str(case), PipelineState.MESHED)
        assert not all(r.passed for r in results)
