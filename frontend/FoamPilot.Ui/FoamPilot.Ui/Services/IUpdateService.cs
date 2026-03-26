namespace FoamPilot.Ui.Services;

public record UpdateInfo(string TargetVersion, bool IsDownloaded);

public interface IUpdateService
{
    string CurrentVersion { get; }
    Task<UpdateInfo?> CheckForUpdateAsync(CancellationToken ct);
    Task DownloadUpdateAsync(Action<int>? progress, CancellationToken ct);
    void ApplyUpdateAndRestart();
}
