/*
 * Wizard Step Lifecycle:
 *
 *   CreateUI()          BuildUI()           OnEnter()
 *   ──────────▶ Panel ──────────▶ Ready ──────────▶ Active
 *                                                     │
 *                          ┌──────────────────────────┤
 *                          │                          │
 *                     Validate()                 Execute()
 *                      (sync)                    (async)
 *                          │                          │
 *                          ▼                          ▼
 *                     CanAdvance?               OnComplete()
 *                     true/false                      │
 *                                                     ▼
 *                                                 OnLeave()
 */

using System.Net.Http.Json;
using Microsoft.UI.Xaml.Controls;

namespace FoamPilot.Ui.Presentation.WizardSteps;

/// <summary>
/// Interface for wizard step services. Each step owns its UI panel,
/// validation logic, and execution behavior.
/// </summary>
public interface IWizardStep
{
    /// <summary>Step display name shown in the stepper bar.</summary>
    string Title { get; }

    /// <summary>Step index (0-based).</summary>
    int Index { get; }

    /// <summary>Build and return the UI panel for this step.</summary>
    Panel CreateUI();

    /// <summary>Called when the user navigates to this step.</summary>
    Task OnEnterAsync();

    /// <summary>Called when the user navigates away from this step.</summary>
    Task OnLeaveAsync();

    /// <summary>Validate the current state. Returns null if valid, or an error message.</summary>
    string? Validate();

    /// <summary>
    /// Execute the step's primary action (e.g., run mesh commands, run solver).
    /// Returns true if successful. Steps without an action (e.g., Physics editing) return true immediately.
    /// </summary>
    Task<bool> ExecuteAsync(Action<string> log, Action<string> setStatus, CancellationToken ct);

    /// <summary>Whether this step has a long-running execution (mesh, solver).</summary>
    bool HasExecution { get; }

    /// <summary>Whether this step's execution completed successfully.</summary>
    bool IsComplete { get; }
}

/// <summary>
/// Base class providing shared utilities for wizard steps:
/// HTTP client, config, case name access.
/// </summary>
public abstract class WizardStepBase : IWizardStep
{
    protected readonly HttpClient Http;
    protected readonly AppConfig Config;
    protected string? CaseName;

    protected WizardStepBase(HttpClient http, AppConfig config)
    {
        Http = http;
        Config = config;
    }

    public abstract string Title { get; }
    public abstract int Index { get; }
    public abstract Panel CreateUI();
    public virtual Task OnEnterAsync() => Task.CompletedTask;
    public virtual Task OnLeaveAsync() => Task.CompletedTask;
    public virtual string? Validate() => null;
    public virtual Task<bool> ExecuteAsync(Action<string> log, Action<string> setStatus, CancellationToken ct)
        => Task.FromResult(true);
    public virtual bool HasExecution => false;
    public bool IsComplete { get; protected set; }

    /// <summary>Set the active case name. Called by the wizard page when a case is created.</summary>
    public void SetCaseName(string caseName) => CaseName = caseName;

    /// <summary>Load a file from the current case via the backend API.</summary>
    protected async Task<string?> LoadFileAsync(string relativePath)
    {
        if (CaseName is null) return null;
        try
        {
            var encoded = Uri.EscapeDataString(relativePath);
            var resp = await Http.GetAsync($"/cases/{CaseName}/file?path={encoded}");
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync();
            // API returns {"content": "..."} wrapper
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            return doc.RootElement.GetProperty("content").GetString();
        }
        catch { return null; }
    }

    /// <summary>Save a file to the current case via the backend API.</summary>
    protected async Task<bool> SaveFileAsync(string relativePath, string content)
    {
        if (CaseName is null) return false;
        try
        {
            // Normalize line endings for OpenFOAM (Unix LF)
            content = content.Replace("\r\n", "\n").Replace("\r", "\n");
            var encoded = Uri.EscapeDataString(relativePath);
            var resp = await Http.PutAsync(
                $"/cases/{CaseName}/file?path={encoded}",
                new StringContent(content, System.Text.Encoding.UTF8, "text/plain"));
            return resp.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    /// <summary>Run a command via POST /run and poll until complete.</summary>
    protected async Task<(bool success, string jobId)> RunCommandAsync(
        string command, Action<string> log, Action<string> setStatus, CancellationToken ct)
    {
        if (CaseName is null) return (false, "");
        setStatus($"Running {command}...");
        log($">>> {command}");

        try
        {
            var resp = await Http.PostAsJsonAsync("/run",
                new { case_name = CaseName, commands = new[] { command } }, ct);
            if (!resp.IsSuccessStatusCode)
            {
                log($"<<< Failed: {resp.StatusCode}");
                return (false, "");
            }

            using var doc = System.Text.Json.JsonDocument.Parse(
                await resp.Content.ReadAsStringAsync(ct));
            var jobId = doc.RootElement.GetProperty("job_id").GetString()!;

            // Poll until complete
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(1000, ct);
                var statusResp = await Http.GetAsync($"/jobs/{jobId}", ct);
                using var statusDoc = System.Text.Json.JsonDocument.Parse(
                    await statusResp.Content.ReadAsStringAsync(ct));
                var status = statusDoc.RootElement.GetProperty("status").GetString();

                if (status == "completed")
                {
                    log($"<<< {command} completed");
                    return (true, jobId);
                }
                if (status == "failed")
                {
                    // Fetch log for error details
                    try
                    {
                        var logResp = await Http.GetAsync($"/jobs/{jobId}/log", ct);
                        var logText = await logResp.Content.ReadAsStringAsync(ct);
                        var lines = logText.Split('\n');
                        // Show last 20 lines
                        foreach (var line in lines.TakeLast(20))
                            log(line);
                    }
                    catch { }
                    log($"<<< {command} FAILED");
                    return (false, jobId);
                }
            }
            return (false, jobId);
        }
        catch (OperationCanceledException) { return (false, ""); }
        catch (Exception ex)
        {
            log($"Error: {ex.Message}");
            return (false, "");
        }
    }
}
