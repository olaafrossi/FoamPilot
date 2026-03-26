using System.Runtime.CompilerServices;
using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

/// <summary>
/// MVUX model for the guided simulation wizard.
///
/// Wizard Steps ↔ Pipeline States:
///   Step 0: Template Picker  →  creates pipeline in DRAFT
///   Step 1: Mesh             →  advances to MESHED
///   Step 2: Boundaries       →  advances to CONFIGURED (same as step 3)
///   Step 3: Solver           →  advances to CONFIGURED
///   Step 4: Run              →  advances to COMPLETE
///   Step 5: Results          →  pipeline is COMPLETE
/// </summary>
public partial record WizardModel
{
    private readonly IOpenFoamApiClient _api;
    private readonly ILogStreamService _logStream;

    public WizardModel(IOpenFoamApiClient api, ILogStreamService logStream)
    {
        _api = api;
        _logStream = logStream;
    }

    // ── Template Selection ────────────────────────────────────────────

    public IListFeed<TemplateMetadata> Templates => ListFeed.Async(async ct =>
        await _api.GetTemplatesWithMetadataAsync(ct));

    public IState<TemplateMetadata> SelectedTemplate => State<TemplateMetadata>.Empty(this);

    // ── Pipeline State ────────────────────────────────────────────────

    public IState<PipelineInfo> Pipeline => State<PipelineInfo>.Empty(this);

    public IState<int> CurrentStep => State.Value(this, () => 0);

    public IState<string> StatusMessage => State.Value(this, () => "Select a template to begin.");

    public IState<bool> IsLoading => State.Value(this, () => false);

    // ── Validation ────────────────────────────────────────────────────

    public IState<IImmutableList<ValidationResult>> ValidationResults =>
        State.Value(this, () => (IImmutableList<ValidationResult>)ImmutableList<ValidationResult>.Empty);

    // ── File Editing (simplified wizard editor) ───────────────────────

    public IState<string> CurrentFilePath => State<string>.Empty(this);

    public IState<string> FileContent => State<string>.Empty(this);

    public IState<string> OriginalFileContent => State<string>.Empty(this);

    public IState<bool> IsFileDirty => State.Value(this, () => false);

    // ── Log Streaming (for Run step) ──────────────────────────────────

    public IState<IImmutableList<LogLine>> LogLines =>
        State.Value(this, () => (IImmutableList<LogLine>)ImmutableList<LogLine>.Empty);

    // ── Commands ──────────────────────────────────────────────────────

    /// <summary>Create a pipeline from the selected template and advance to step 1.</summary>
    public async ValueTask StartWizard(CancellationToken ct)
    {
        var template = await SelectedTemplate;
        if (template is null) return;

        await IsLoading.UpdateAsync(_ => true, ct);
        await StatusMessage.UpdateAsync(_ => $"Creating case from '{template.Name}'...", ct);

        try
        {
            // Use template path as case name (sanitized)
            var caseName = template.Path.Replace("/", "_").Replace("\\", "_");
            var pipeline = await _api.CreatePipelineAsync(caseName, template.Path, ct);
            await Pipeline.UpdateAsync(_ => pipeline, ct);
            await CurrentStep.UpdateAsync(_ => 1, ct);
            await StatusMessage.UpdateAsync(_ => "Step 1: Generate Mesh", ct);
        }
        catch (Exception ex)
        {
            await StatusMessage.UpdateAsync(_ => $"Error: {ex.Message}", ct);
        }
        finally
        {
            await IsLoading.UpdateAsync(_ => false, ct);
        }
    }

    /// <summary>Run validation for the current step's target state.</summary>
    public async ValueTask ValidateCurrentStep(CancellationToken ct)
    {
        var pipeline = await Pipeline;
        if (pipeline is null) return;

        var targetState = GetTargetState(await CurrentStep);
        if (targetState is null) return;

        try
        {
            var results = await _api.ValidatePipelineAsync(pipeline.CaseName, targetState, ct);
            await ValidationResults.UpdateAsync(_ => results, ct);
        }
        catch (Exception ex)
        {
            await StatusMessage.UpdateAsync(_ => $"Validation error: {ex.Message}", ct);
        }
    }

    /// <summary>Advance the pipeline to the next state after validation passes.</summary>
    public async ValueTask AdvanceStep(CancellationToken ct)
    {
        var pipeline = await Pipeline;
        if (pipeline is null) return;

        var step = await CurrentStep;
        var targetState = GetTargetState(step);
        if (targetState is null) return;

        await IsLoading.UpdateAsync(_ => true, ct);

        try
        {
            // For mesh and run steps, execute the command first via existing runner
            if (step == 1) // Mesh step
            {
                await StatusMessage.UpdateAsync(_ => "Running blockMesh...", ct);
                await _api.RunCommandAsync(pipeline.CaseName, "blockMesh", ct);
                // TODO: poll job status until complete, then advance
            }
            else if (step == 4) // Run step
            {
                var solver = await _api.GetSolverAsync(pipeline.CaseName, ct);
                await StatusMessage.UpdateAsync(_ => $"Running {solver}...", ct);
                await _api.RunCommandAsync(pipeline.CaseName, solver, ct);
                // TODO: poll job status until complete, then advance
            }

            // Advance the pipeline state
            var updated = await _api.AdvancePipelineAsync(pipeline.CaseName, targetState, ct);
            await Pipeline.UpdateAsync(_ => updated, ct);
            await ValidationResults.UpdateAsync(_ => ImmutableList<ValidationResult>.Empty, ct);

            // Move to next step
            var nextStep = step + 1;
            await CurrentStep.UpdateAsync(_ => nextStep, ct);
            await StatusMessage.UpdateAsync(_ => GetStepTitle(nextStep), ct);
        }
        catch (HttpRequestException ex)
        {
            await StatusMessage.UpdateAsync(_ => $"Failed: {ex.Message}", ct);
        }
        finally
        {
            await IsLoading.UpdateAsync(_ => false, ct);
        }
    }

    /// <summary>Load a file for editing in the current wizard step.</summary>
    public async ValueTask LoadFile(string filePath, CancellationToken ct)
    {
        var pipeline = await Pipeline;
        if (pipeline is null) return;

        try
        {
            var content = await _api.GetFileContentAsync(pipeline.CaseName, filePath, ct);
            await CurrentFilePath.UpdateAsync(_ => filePath, ct);
            await FileContent.UpdateAsync(_ => content, ct);
            await OriginalFileContent.UpdateAsync(_ => content, ct);
            await IsFileDirty.UpdateAsync(_ => false, ct);
        }
        catch (Exception ex)
        {
            await StatusMessage.UpdateAsync(_ => $"Error loading file: {ex.Message}", ct);
        }
    }

    /// <summary>Save the current file being edited.</summary>
    public async ValueTask SaveFile(CancellationToken ct)
    {
        var pipeline = await Pipeline;
        var path = await CurrentFilePath;
        var content = await FileContent;
        if (pipeline is null || string.IsNullOrEmpty(path) || content is null) return;

        try
        {
            await _api.SaveFileContentAsync(pipeline.CaseName, path, content, ct);
            await OriginalFileContent.UpdateAsync(_ => content, ct);
            await IsFileDirty.UpdateAsync(_ => false, ct);
            await StatusMessage.UpdateAsync(_ => $"Saved {path}", ct);
        }
        catch (Exception ex)
        {
            await StatusMessage.UpdateAsync(_ => $"Error saving: {ex.Message}", ct);
        }
    }

    /// <summary>Revert the file to its original content.</summary>
    public async ValueTask RevertFile(CancellationToken ct)
    {
        var original = await OriginalFileContent;
        if (original is null) return;
        await FileContent.UpdateAsync(_ => original, ct);
        await IsFileDirty.UpdateAsync(_ => false, ct);
    }

    // ── Helpers ────────────────────────────────────────────────────────

    private static string? GetTargetState(int step) => step switch
    {
        1 => "meshed",
        2 => "configured",
        3 => "configured",
        4 => "complete",
        _ => null,
    };

    private static string GetStepTitle(int step) => step switch
    {
        0 => "Select a template to begin.",
        1 => "Step 1: Generate Mesh",
        2 => "Step 2: Set Boundary Conditions",
        3 => "Step 3: Configure Solver",
        4 => "Step 4: Run Simulation",
        5 => "Simulation Complete!",
        _ => "",
    };
}
