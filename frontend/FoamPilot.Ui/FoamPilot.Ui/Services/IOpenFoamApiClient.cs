namespace FoamPilot.Ui.Services;

public interface IOpenFoamApiClient
{
    Task<IImmutableList<FoamCase>> GetCasesAsync(CancellationToken ct);
    Task<IImmutableList<string>> GetTemplatesAsync(CancellationToken ct);
    Task<FoamCase> CreateCaseAsync(string template, string name, CancellationToken ct);
    Task<FoamCase> CloneCaseAsync(string caseName, string newName, CancellationToken ct);
    Task DeleteCaseAsync(string caseName, CancellationToken ct);
    Task<string> RunCommandAsync(string casePath, string command, CancellationToken ct);
    Task<IImmutableList<RunJob>> GetJobsAsync(CancellationToken ct);
    Task<RunJob> GetJobAsync(string jobId, CancellationToken ct);
    Task CancelJobAsync(string jobId, CancellationToken ct);
    Task<string> GetSolverAsync(string caseName, CancellationToken ct);
    Task<string> GetJobLogAsync(string jobId, CancellationToken ct);
    Task<Dictionary<string, List<ResidualPoint>>> GetJobResidualsAsync(string jobId, CancellationToken ct);
    Task<IImmutableList<FileNode>> GetFileTreeAsync(string caseName, CancellationToken ct);
    Task<string> GetFileContentAsync(string caseName, string filePath, CancellationToken ct);
    Task SaveFileContentAsync(string caseName, string filePath, string content, CancellationToken ct);
    Task<string> EnsureFoamFileAsync(string caseName, CancellationToken ct);
}
