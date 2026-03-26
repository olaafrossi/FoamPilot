using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FoamPilot.Ui.Services;

public sealed class OpenFoamApiClient : IOpenFoamApiClient
{
    private readonly HttpClient _http;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public OpenFoamApiClient(HttpClient http)
    {
        _http = http;
    }

    public async Task<IImmutableList<FoamCase>> GetCasesAsync(CancellationToken ct)
    {
        var cases = await _http.GetFromJsonAsync<List<CaseDto>>("cases", JsonOptions, ct)
            ?? [];
        return cases.Select(c => c.ToModel()).ToImmutableList();
    }

    public async Task<IImmutableList<string>> GetTemplatesAsync(CancellationToken ct)
    {
        var templates = await _http.GetFromJsonAsync<List<string>>("cases/templates", JsonOptions, ct)
            ?? [];
        return templates.ToImmutableList();
    }

    public async Task<FoamCase> CreateCaseAsync(string template, string name, CancellationToken ct)
    {
        var payload = new { name, template };
        var response = await _http.PostAsJsonAsync("cases", payload, JsonOptions, ct);
        response.EnsureSuccessStatusCode();
        var dto = await response.Content.ReadFromJsonAsync<CaseDto>(JsonOptions, ct);
        return dto!.ToModel();
    }

    public async Task<FoamCase> CloneCaseAsync(string caseName, string newName, CancellationToken ct)
    {
        var payload = new { new_name = newName };
        var response = await _http.PostAsJsonAsync($"cases/{Uri.EscapeDataString(caseName)}/clone", payload, JsonOptions, ct);
        response.EnsureSuccessStatusCode();
        var dto = await response.Content.ReadFromJsonAsync<CaseDto>(JsonOptions, ct);
        return dto!.ToModel();
    }

    public async Task DeleteCaseAsync(string caseName, CancellationToken ct)
    {
        var response = await _http.DeleteAsync($"cases/{Uri.EscapeDataString(caseName)}", ct);
        response.EnsureSuccessStatusCode();
    }

    public async Task<string> RunCommandAsync(string caseName, string command, CancellationToken ct)
    {
        var payload = new { case_name = caseName, commands = new[] { command } };
        var response = await _http.PostAsJsonAsync("run", payload, JsonOptions, ct);
        response.EnsureSuccessStatusCode();
        var dto = await response.Content.ReadFromJsonAsync<JobDto>(JsonOptions, ct);
        return dto!.JobId;
    }

    public async Task<IImmutableList<RunJob>> GetJobsAsync(CancellationToken ct)
    {
        var dtos = await _http.GetFromJsonAsync<List<JobDto>>("jobs", JsonOptions, ct)
            ?? [];
        return dtos.Select(d => d.ToModel()).ToImmutableList();
    }

    public async Task<RunJob> GetJobAsync(string jobId, CancellationToken ct)
    {
        var dto = await _http.GetFromJsonAsync<JobDto>($"jobs/{Uri.EscapeDataString(jobId)}", JsonOptions, ct);
        return dto!.ToModel();
    }

    public async Task CancelJobAsync(string jobId, CancellationToken ct)
    {
        var response = await _http.DeleteAsync($"jobs/{Uri.EscapeDataString(jobId)}", ct);
        response.EnsureSuccessStatusCode();
    }

    public async Task<string> GetSolverAsync(string caseName, CancellationToken ct)
    {
        // Phase 6 — placeholder: read controlDict from files endpoint
        return "unknown";
    }

    public async Task<string> GetJobLogAsync(string jobId, CancellationToken ct)
    {
        return await _http.GetStringAsync($"jobs/{Uri.EscapeDataString(jobId)}/log", ct);
    }

    public async Task<Dictionary<string, List<ResidualPoint>>> GetJobResidualsAsync(string jobId, CancellationToken ct)
    {
        var response = await _http.GetFromJsonAsync<ResidualsResponse>(
            $"jobs/{Uri.EscapeDataString(jobId)}/residuals", JsonOptions, ct);
        if (response?.Fields is null)
            return new Dictionary<string, List<ResidualPoint>>();

        return response.Fields.ToDictionary(
            kvp => kvp.Key,
            kvp => kvp.Value.Select(r => new ResidualPoint(
                r.Iteration, kvp.Key, r.Initial, r.Final)).ToList());
    }

    private sealed record ResidualsResponse(Dictionary<string, List<ResidualEntryDto>>? Fields);
    private sealed record ResidualEntryDto(int Iteration, double Initial, double Final, int NoIterations);

    // ── DTOs for JSON deserialization ────────────────────────────────

    private sealed record CaseDto(string Name, string Path, DateTime? Modified)
    {
        public FoamCase ToModel() => new(
            Name,
            Path,
            Modified ?? DateTime.MinValue,
            HasMesh: false,
            HasResults: false);
    }

    private sealed record JobDto(
        string JobId,
        string CaseName,
        List<string> Commands,
        string Status,
        DateTime? StartTime,
        DateTime? EndTime,
        int? ExitCode)
    {
        public RunJob ToModel() => new(
            JobId,
            CaseName,
            string.Join(" && ", Commands),
            Enum.TryParse<JobStatus>(Status, true, out var s) ? s : JobStatus.Queued,
            StartTime ?? DateTime.UtcNow,
            EndTime,
            ExitCode);
    }
}
