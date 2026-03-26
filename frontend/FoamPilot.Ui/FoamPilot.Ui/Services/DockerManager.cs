using System.Diagnostics;

namespace FoamPilot.Ui.Services;

public sealed class DockerManager : IDockerManager
{
    private readonly Func<string> _composePathFactory;

    public DockerManager(Func<string> composePathFactory)
    {
        _composePathFactory = composePathFactory;
    }

    public async Task<ContainerStatus> GetStatusAsync(CancellationToken ct)
    {
        try
        {
            var (exitCode, output) = await RunComposeAsync("ps --format json", ct);
            if (exitCode != 0)
                return ContainerStatus.Error;

            if (string.IsNullOrWhiteSpace(output))
                return ContainerStatus.Stopped;

            return output.Contains("running", StringComparison.OrdinalIgnoreCase)
                ? ContainerStatus.Running
                : ContainerStatus.Stopped;
        }
        catch
        {
            return ContainerStatus.Unknown;
        }
    }

    public async Task StartAsync(CancellationToken ct)
    {
        var (exitCode, output) = await RunComposeAsync("up -d --build", ct);
        if (exitCode != 0)
            throw new InvalidOperationException($"docker compose up failed: {output}");
    }

    public async Task StopAsync(CancellationToken ct)
    {
        var (exitCode, output) = await RunComposeAsync("down", ct);
        if (exitCode != 0)
            throw new InvalidOperationException($"docker compose down failed: {output}");
    }

    private async Task<(int ExitCode, string Output)> RunComposeAsync(string args, CancellationToken ct)
    {
        var composePath = _composePathFactory();
        var psi = new ProcessStartInfo
        {
            FileName = "docker",
            Arguments = $"compose -f \"{composePath}/docker-compose.yml\" {args}",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start docker compose");

        var stdout = await process.StandardOutput.ReadToEndAsync(ct);
        var stderr = await process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);

        return (process.ExitCode, string.IsNullOrWhiteSpace(stdout) ? stderr : stdout);
    }
}
