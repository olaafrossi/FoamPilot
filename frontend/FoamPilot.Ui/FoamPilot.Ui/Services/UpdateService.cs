using Microsoft.Extensions.Logging;
using Velopack;
using Velopack.Sources;

namespace FoamPilot.Ui.Services;

public sealed class UpdateService : IUpdateService
{
    private readonly UpdateManager _manager;
    private readonly ILogger<UpdateService> _logger;
    private UpdateInfo? _pending;

    public UpdateService(ILogger<UpdateService> logger)
    {
        _logger = logger;
        _manager = new UpdateManager(
            new GithubSource("https://github.com/olaafrossi/FoamPilot", null, false));
    }

    public string CurrentVersion
    {
        get
        {
            var ver = _manager.CurrentVersion;
            return ver?.ToString() ?? "dev";
        }
    }

    public async Task<UpdateInfo?> CheckForUpdateAsync(CancellationToken ct)
    {
        try
        {
            if (!_manager.IsInstalled)
            {
                _logger.LogDebug("Not a Velopack install — skipping update check");
                return null;
            }

            var update = await _manager.CheckForUpdatesAsync();
            if (update is null)
            {
                _logger.LogDebug("No updates available");
                return null;
            }

            _pending = new UpdateInfo(update.TargetFullRelease.Version.ToString(), false);
            _logger.LogInformation("Update available: {Version}", _pending.TargetVersion);
            return _pending;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Update check failed");
            return null;
        }
    }

    public async Task DownloadUpdateAsync(Action<int>? progress, CancellationToken ct)
    {
        if (_pending is null)
            throw new InvalidOperationException("No update available to download. Call CheckForUpdateAsync first.");

        try
        {
            var update = await _manager.CheckForUpdatesAsync();
            if (update is null)
                throw new InvalidOperationException("Update is no longer available");

            await _manager.DownloadUpdatesAsync(update, progress);
            _pending = _pending with { IsDownloaded = true };
            _logger.LogInformation("Update downloaded: {Version}", _pending.TargetVersion);
        }
        catch (Exception ex) when (ex is not InvalidOperationException)
        {
            _logger.LogError(ex, "Update download failed");
            throw;
        }
    }

    public void ApplyUpdateAndRestart()
    {
        if (_pending is not { IsDownloaded: true })
            throw new InvalidOperationException("No downloaded update to apply. Call DownloadUpdateAsync first.");

        _logger.LogInformation("Applying update {Version} and restarting", _pending.TargetVersion);
        _manager.ApplyUpdatesAndRestart(null);
    }
}
