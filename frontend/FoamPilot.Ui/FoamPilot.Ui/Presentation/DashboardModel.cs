using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public partial record DashboardModel
{
    private readonly IOpenFoamApiClient _api;
    private readonly IDockerManager _docker;

    public DashboardModel(IOpenFoamApiClient api, IDockerManager docker)
    {
        _api = api;
        _docker = docker;
    }

    public IFeed<int> CaseCount => Feed.Async(async ct =>
        (await _api.GetCasesAsync(ct)).Count);

    public IFeed<int> ActiveJobCount => Feed.Async(async ct =>
        (await _api.GetJobsAsync(ct)).Count(j =>
            j.Status is JobStatus.Running or JobStatus.Queued));

    public IFeed<ContainerStatus> ContainerState => Feed.Async(async ct =>
        await _docker.GetStatusAsync(ct));

    public IListFeed<RunJob> RecentJobs => ListFeed.Async(async ct =>
        (await _api.GetJobsAsync(ct))
            .OrderByDescending(j => j.StartTime)
            .Take(10)
            .ToImmutableList());
}
