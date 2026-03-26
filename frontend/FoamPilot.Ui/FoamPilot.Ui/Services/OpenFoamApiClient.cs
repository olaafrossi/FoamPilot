using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FoamPilot.Ui.Services;

public sealed class OpenFoamApiClient : IOpenFoamApiClient
{
    private readonly HttpClient _http;
    private static readonly int[] RetryDelaysMs = [1000, 2000, 4000];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public OpenFoamApiClient(HttpClient http)
    {
        _http = http;
    }

    // ── Retry helper ─────────────────────────────────────────────────

    private static async Task<T> WithRetryAsync<T>(Func<Task<T>> action, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await action();
            }
            catch (Exception ex) when (attempt < RetryDelaysMs.Length
                && (ex is HttpRequestException or TaskCanceledException { InnerException: TimeoutException })
                && !ct.IsCancellationRequested)
            {
                await Task.Delay(RetryDelaysMs[attempt], ct);
            }
        }
    }

    private static async Task WithRetryAsync(Func<Task> action, CancellationToken ct)
    {
        await WithRetryAsync(async () => { await action(); return 0; }, ct);
    }

    // ── Cases ────────────────────────────────────────────────────────

    public async Task<IImmutableList<FoamCase>> GetCasesAsync(CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var cases = await _http.GetFromJsonAsync<List<CaseDto>>("cases", JsonOptions, ct)
                ?? [];
            return cases.Select(c => c.ToModel()).ToImmutableList();
        }, ct);

    public async Task<IImmutableList<string>> GetTemplatesAsync(CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var templates = await _http.GetFromJsonAsync<List<string>>("cases/templates", JsonOptions, ct)
                ?? [];
            return templates.ToImmutableList();
        }, ct);

    public async Task<FoamCase> CreateCaseAsync(string template, string name, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var payload = new { name, template };
            var response = await _http.PostAsJsonAsync("cases", payload, JsonOptions, ct);
            response.EnsureSuccessStatusCode();
            var dto = await response.Content.ReadFromJsonAsync<CaseDto>(JsonOptions, ct);
            return dto!.ToModel();
        }, ct);

    public async Task<FoamCase> CloneCaseAsync(string caseName, string newName, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var payload = new { new_name = newName };
            var response = await _http.PostAsJsonAsync($"cases/{Uri.EscapeDataString(caseName)}/clone", payload, JsonOptions, ct);
            response.EnsureSuccessStatusCode();
            var dto = await response.Content.ReadFromJsonAsync<CaseDto>(JsonOptions, ct);
            return dto!.ToModel();
        }, ct);

    public async Task DeleteCaseAsync(string caseName, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var response = await _http.DeleteAsync($"cases/{Uri.EscapeDataString(caseName)}", ct);
            response.EnsureSuccessStatusCode();
        }, ct);

    // ── Jobs ─────────────────────────────────────────────────────────

    public async Task<string> RunCommandAsync(string caseName, string command, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var payload = new { case_name = caseName, commands = new[] { command } };
            var response = await _http.PostAsJsonAsync("run", payload, JsonOptions, ct);
            response.EnsureSuccessStatusCode();
            var dto = await response.Content.ReadFromJsonAsync<JobDto>(JsonOptions, ct);
            return dto!.JobId;
        }, ct);

    public async Task<IImmutableList<RunJob>> GetJobsAsync(CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var dtos = await _http.GetFromJsonAsync<List<JobDto>>("jobs", JsonOptions, ct)
                ?? [];
            return dtos.Select(d => d.ToModel()).ToImmutableList();
        }, ct);

    public async Task<RunJob> GetJobAsync(string jobId, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var dto = await _http.GetFromJsonAsync<JobDto>($"jobs/{Uri.EscapeDataString(jobId)}", JsonOptions, ct);
            return dto!.ToModel();
        }, ct);

    public async Task CancelJobAsync(string jobId, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var response = await _http.DeleteAsync($"jobs/{Uri.EscapeDataString(jobId)}", ct);
            response.EnsureSuccessStatusCode();
        }, ct);

    public async Task<string> GetSolverAsync(string caseName, CancellationToken ct)
    {
        try
        {
            return await WithRetryAsync(async () =>
            {
                var dto = await _http.GetFromJsonAsync<SolverResponse>(
                    $"cases/{Uri.EscapeDataString(caseName)}/solver", JsonOptions, ct);
                return dto?.Solver ?? "unknown";
            }, ct);
        }
        catch (HttpRequestException)
        {
            return "unknown";
        }
    }

    private sealed record SolverResponse(string Solver);

    // ── Logs & Residuals ─────────────────────────────────────────────

    public async Task<string> GetJobLogAsync(string jobId, CancellationToken ct) =>
        await WithRetryAsync(async () =>
            await _http.GetStringAsync($"jobs/{Uri.EscapeDataString(jobId)}/log", ct), ct);

    public async Task<Dictionary<string, List<ResidualPoint>>> GetJobResidualsAsync(string jobId, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var response = await _http.GetFromJsonAsync<ResidualsResponse>(
                $"jobs/{Uri.EscapeDataString(jobId)}/residuals", JsonOptions, ct);
            if (response?.Fields is null)
                return new Dictionary<string, List<ResidualPoint>>();

            return response.Fields.ToDictionary(
                kvp => kvp.Key,
                kvp => kvp.Value.Select(r => new ResidualPoint(
                    r.Iteration, kvp.Key, r.Initial, r.Final)).ToList());
        }, ct);

    private sealed record ResidualsResponse(Dictionary<string, List<ResidualEntryDto>>? Fields);
    private sealed record ResidualEntryDto(int Iteration, double Initial, double Final, int NoIterations);

    // ── Files ────────────────────────────────────────────────────────

    public async Task<IImmutableList<FileNode>> GetFileTreeAsync(string caseName, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var dtos = await _http.GetFromJsonAsync<List<FileNodeDto>>(
                $"cases/{Uri.EscapeDataString(caseName)}/files", JsonOptions, ct) ?? [];
            return dtos.Select(d => d.ToModel()).ToImmutableList();
        }, ct);

    public async Task<string> GetFileContentAsync(string caseName, string filePath, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var dto = await _http.GetFromJsonAsync<FileContentDto>(
                $"cases/{Uri.EscapeDataString(caseName)}/file?path={Uri.EscapeDataString(filePath)}", JsonOptions, ct);
            return dto?.Content ?? string.Empty;
        }, ct);

    public async Task SaveFileContentAsync(string caseName, string filePath, string content, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var httpContent = new StringContent(content, System.Text.Encoding.UTF8, "text/plain");
            var response = await _http.PutAsync(
                $"cases/{Uri.EscapeDataString(caseName)}/file?path={Uri.EscapeDataString(filePath)}", httpContent, ct);
            response.EnsureSuccessStatusCode();
        }, ct);

    // ── ParaView ─────────────────────────────────────────────────────

    public async Task<string> EnsureFoamFileAsync(string caseName, CancellationToken ct) =>
        await WithRetryAsync(async () =>
        {
            var response = await _http.PostAsync(
                $"cases/{Uri.EscapeDataString(caseName)}/ensure-foam", null, ct);
            response.EnsureSuccessStatusCode();
            var dto = await response.Content.ReadFromJsonAsync<FoamFileResponse>(JsonOptions, ct);
            return dto!.Path;
        }, ct);

    private sealed record FoamFileResponse(string Path);

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
