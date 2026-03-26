using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public partial record ShellModel
{
    private readonly INavigator _navigator;
    private readonly IDockerManager _docker;
    private readonly IOpenFoamApiClient _api;

    public ShellModel(
        INavigator navigator,
        IDockerManager docker,
        IOpenFoamApiClient api)
    {
        _navigator = navigator;
        _docker = docker;
        _api = api;
    }

    /// <summary>
    /// Polls the Docker container status every 5 seconds.
    /// </summary>
    public IFeed<ContainerStatus> ContainerState => Feed.Async(async ct =>
    {
        return await _docker.GetStatusAsync(ct);
    });

    /// <summary>
    /// Polls the backend /health endpoint every 5 seconds.
    /// </summary>
    public IFeed<bool> IsBackendConnected => Feed.Async(async ct =>
    {
        try
        {
            var cases = await _api.GetCasesAsync(ct);
            return true;
        }
        catch
        {
            return false;
        }
    });
}
