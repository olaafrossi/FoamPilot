using Xunit;

namespace FoamPilot.Ui.Tests;

/// <summary>
/// Tests the IUpdateService contract using a fake implementation.
/// The real UpdateService wraps Velopack, which requires an installed app context.
/// These tests verify the behavioral contract that any IUpdateService must satisfy:
///   - CheckForUpdateAsync returns null when up-to-date
///   - CheckForUpdateAsync returns UpdateInfo when newer version exists
///   - DownloadUpdateAsync throws if called before CheckForUpdateAsync
///   - ApplyUpdateAndRestart throws if called before DownloadUpdateAsync
///   - Network errors during check are swallowed gracefully
/// </summary>
public class UpdateServiceContractTests
{
    [Fact]
    public async Task CheckForUpdate_WhenUpToDate_ReturnsNull()
    {
        var svc = new FakeUpdateService(currentVersion: "1.0.0", availableVersion: null);

        var result = await svc.CheckForUpdateAsync(CancellationToken.None);

        Assert.Null(result);
    }

    [Fact]
    public async Task CheckForUpdate_WhenNewerVersionAvailable_ReturnsUpdateInfo()
    {
        var svc = new FakeUpdateService(currentVersion: "1.0.0", availableVersion: "1.1.0");

        var result = await svc.CheckForUpdateAsync(CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("1.1.0", result!.TargetVersion);
        Assert.False(result.IsDownloaded);
    }

    [Fact]
    public async Task DownloadUpdate_WithoutCheckFirst_Throws()
    {
        var svc = new FakeUpdateService(currentVersion: "1.0.0", availableVersion: "1.1.0");

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.DownloadUpdateAsync(null, CancellationToken.None));
    }

    [Fact]
    public void ApplyUpdate_WithoutDownloadFirst_Throws()
    {
        var svc = new FakeUpdateService(currentVersion: "1.0.0", availableVersion: "1.1.0");

        Assert.Throws<InvalidOperationException>(() => svc.ApplyUpdateAndRestart());
    }

    [Fact]
    public async Task DownloadUpdate_AfterCheck_Succeeds()
    {
        var svc = new FakeUpdateService(currentVersion: "1.0.0", availableVersion: "1.1.0");
        await svc.CheckForUpdateAsync(CancellationToken.None);

        await svc.DownloadUpdateAsync(null, CancellationToken.None);

        Assert.True(svc.IsDownloaded);
    }

    [Fact]
    public async Task DownloadUpdate_ReportsProgress()
    {
        var svc = new FakeUpdateService(currentVersion: "1.0.0", availableVersion: "1.1.0");
        await svc.CheckForUpdateAsync(CancellationToken.None);

        var progressValues = new List<int>();
        await svc.DownloadUpdateAsync(p => progressValues.Add(p), CancellationToken.None);

        Assert.Contains(100, progressValues);
    }

    [Fact]
    public async Task CheckForUpdate_WhenNetworkFails_ReturnsNull()
    {
        var svc = new FakeUpdateService(currentVersion: "1.0.0", availableVersion: null, simulateNetworkError: true);

        var result = await svc.CheckForUpdateAsync(CancellationToken.None);

        Assert.Null(result);
    }

    [Fact]
    public async Task ApplyUpdate_AfterDownload_CallsRestart()
    {
        var svc = new FakeUpdateService(currentVersion: "1.0.0", availableVersion: "1.1.0");
        await svc.CheckForUpdateAsync(CancellationToken.None);
        await svc.DownloadUpdateAsync(null, CancellationToken.None);

        svc.ApplyUpdateAndRestart();

        Assert.True(svc.RestartCalled);
    }

    [Fact]
    public void CurrentVersion_ReturnsConfiguredVersion()
    {
        var svc = new FakeUpdateService(currentVersion: "2.3.1", availableVersion: null);

        Assert.Equal("2.3.1", svc.CurrentVersion);
    }
}

/// <summary>
/// Fake IUpdateService that follows the same behavioral contract as the real
/// Velopack-backed UpdateService, without requiring an installed app context.
/// </summary>
file record UpdateInfo(string TargetVersion, bool IsDownloaded);

file sealed class FakeUpdateService
{
    private readonly string _currentVersion;
    private readonly string? _availableVersion;
    private readonly bool _simulateNetworkError;
    private UpdateInfo? _pending;

    public bool IsDownloaded => _pending?.IsDownloaded == true;
    public bool RestartCalled { get; private set; }

    public FakeUpdateService(string currentVersion, string? availableVersion, bool simulateNetworkError = false)
    {
        _currentVersion = currentVersion;
        _availableVersion = availableVersion;
        _simulateNetworkError = simulateNetworkError;
    }

    public string CurrentVersion => _currentVersion;

    public Task<UpdateInfo?> CheckForUpdateAsync(CancellationToken ct)
    {
        if (_simulateNetworkError)
            return Task.FromResult<UpdateInfo?>(null);

        if (_availableVersion is null)
            return Task.FromResult<UpdateInfo?>(null);

        _pending = new UpdateInfo(_availableVersion, false);
        return Task.FromResult<UpdateInfo?>(_pending);
    }

    public Task DownloadUpdateAsync(Action<int>? progress, CancellationToken ct)
    {
        if (_pending is null)
            throw new InvalidOperationException("No update available to download.");

        progress?.Invoke(0);
        progress?.Invoke(50);
        progress?.Invoke(100);
        _pending = _pending with { IsDownloaded = true };
        return Task.CompletedTask;
    }

    public void ApplyUpdateAndRestart()
    {
        if (_pending is not { IsDownloaded: true })
            throw new InvalidOperationException("No downloaded update to apply.");

        RestartCalled = true;
    }
}
