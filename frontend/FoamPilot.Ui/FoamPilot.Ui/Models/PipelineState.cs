namespace FoamPilot.Ui.Models;

/// <summary>Pipeline state from the backend.</summary>
public partial record PipelineInfo(
    string Id,
    string CaseName,
    string Template,
    string State,
    string CreatedAt,
    Dictionary<string, StepInfo> Steps,
    string? ActiveJobId,
    IImmutableList<ValidationError> ValidationErrors);

public record StepInfo(string Status);

public record ValidationError(string Rule, bool Passed, string Message);

public record ValidationResult(string Rule, bool Passed, string Message = "");

/// <summary>Template metadata from the backend.</summary>
public record TemplateMetadata(
    string Name,
    string Path,
    string Description,
    string Difficulty,
    string Solver,
    string EstimatedRuntime,
    IImmutableList<string> LearningObjectives,
    IImmutableList<string> Fields);
