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
        // The backend doesn't have a list-all endpoint yet; return empty for now.
        return ImmutableList<RunJob>.Empty;
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

    public async Task<IImmutableList<FileNode>> GetFileTreeAsync(string caseName, CancellationToken ct)
    {
        var nodes = await _http.GetFromJsonAsync<List<FileNodeDto>>(
            $"cases/{Uri.EscapeDataString(caseName)}/files", JsonOptions, ct)
            ?? [];
        return nodes.Select(n => n.ToModel()).ToImmutableList();
    }

    public async Task<string> GetFileContentAsync(string caseName, string relativePath, CancellationToken ct)
    {
        var url = $"cases/{Uri.EscapeDataString(caseName)}/file?path={Uri.EscapeDataString(relativePath)}";
        var result = await _http.GetFromJsonAsync<FileContentDto>(url, JsonOptions, ct);
        return result?.Content ?? string.Empty;
    }

    public async Task SaveFileContentAsync(string caseName, string relativePath, string content, CancellationToken ct)
    {
        var url = $"cases/{Uri.EscapeDataString(caseName)}/file?path={Uri.EscapeDataString(relativePath)}";
        var httpContent = new StringContent(content, System.Text.Encoding.UTF8, "text/plain");
        var response = await _http.PutAsync(url, httpContent, ct);
        response.EnsureSuccessStatusCode();
    }

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

    private sealed record FileNodeDto(
        string Name,
        string Path,
        string Type,
        List<FileNodeDto>? Children)
    {
        public FileNode ToModel() => new(
            Name,
            Path,
            Type,
            Children?.Select(c => c.ToModel()).ToImmutableList());
    }

    private sealed record FileContentDto(string Content);
}
