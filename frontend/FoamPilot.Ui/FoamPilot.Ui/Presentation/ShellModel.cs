using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public partial record ShellModel
{
    private readonly INavigator _navigator;
    private readonly IDockerManager _docker;
    private readonly IOpenFoamApiClient _api;
    private readonly IUpdateService _update;

    public ShellModel(
        INavigator navigator,
        IDockerManager docker,
        IOpenFoamApiClient api,
        IUpdateService update)
    {
        _navigator = navigator;
        _docker = docker;
        _api = api;
        _update = update;
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

    /// <summary>
    /// Checks for app updates on startup and every 24 hours.
    /// Returns the available version string, or null if up-to-date.
    /// </summary>
    public IFeed<string> AvailableUpdate => Feed.Async(async ct =>
    {
        var info = await _update.CheckForUpdateAsync(ct);
        return info?.TargetVersion ?? string.Empty;
    });

    /// <summary>
    /// Downloads the pending update, applies it, and restarts the app.
    /// </summary>
    public async ValueTask UpdateNow(CancellationToken ct)
    {
        await _update.DownloadUpdateAsync(null, ct);
        _update.ApplyUpdateAndRestart();
    }
}
