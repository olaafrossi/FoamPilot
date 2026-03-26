using System.Runtime.CompilerServices;
using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public partial record RunControlModel
{
    private readonly IOpenFoamApiClient _api;

    public RunControlModel(IOpenFoamApiClient api)
    {
        _api = api;
    }

    // ── Feeds & States ───────────────────────────────────────────────

    public IListFeed<FoamCase> Cases => ListFeed.Async(async ct =>
        await _api.GetCasesAsync(ct));

    public IState<FoamCase> SelectedCase => State<FoamCase>.Empty(this);

    public IFeed<string> SolverName => SelectedCase.SelectAsync(async (c, ct) =>
        c is null ? "(solver)" : await _api.GetSolverAsync(c.Name, ct));

    public IListFeed<RunJob> Jobs => ListFeed.AsyncEnumerable(PollJobs);

    public IState<string> CustomCommand => State<string>.Empty(this);

    // ── Job polling ─────────────────────────────────────────────────

    private async IAsyncEnumerable<IImmutableList<RunJob>> PollJobs(
        [EnumeratorCancellation] CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            IImmutableList<RunJob> jobs;
            try
            {
                jobs = await _api.GetJobsAsync(ct);
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                jobs = ImmutableList<RunJob>.Empty;
            }

            yield return jobs;

            try
            {
                await Task.Delay(2000, ct);
            }
            catch (OperationCanceledException)
            {
                yield break;
            }
        }
    }

    // ── Commands ─────────────────────────────────────────────────────

    public async ValueTask RunBlockMesh(CancellationToken ct) =>
        await RunCommand("blockMesh", ct);

    public async ValueTask RunCheckMesh(CancellationToken ct) =>
        await RunCommand("checkMesh", ct);

    public async ValueTask RunSnappyHexMesh(CancellationToken ct) =>
        await RunCommand("snappyHexMesh", ct);

    public async ValueTask RunDecomposePar(CancellationToken ct) =>
        await RunCommand("decomposePar", ct);

    public async ValueTask RunSolver(CancellationToken ct)
    {
        var solver = await SolverName;
        if (string.IsNullOrEmpty(solver) || solver == "(solver)")
            return;
        await RunCommand(solver, ct);
    }

    public async ValueTask RunReconstructPar(CancellationToken ct) =>
        await RunCommand("reconstructPar", ct);

    public async ValueTask RunCustom(CancellationToken ct)
    {
        var cmd = await CustomCommand;
        if (string.IsNullOrWhiteSpace(cmd))
            return;
        await RunCommand(cmd, ct);
    }

    public async ValueTask CancelJob(RunJob job, CancellationToken ct) =>
        await _api.CancelJobAsync(job.Id, ct);

    // ── Helpers ──────────────────────────────────────────────────────

    private async ValueTask RunCommand(string command, CancellationToken ct)
    {
        var selectedCase = await SelectedCase;
        if (selectedCase is null)
            return;
        await _api.RunCommandAsync(selectedCase.Name, command, ct);
    }
}
