namespace FoamPilot.Ui.Services;

public interface IDockerManager
{
    Task<ContainerStatus> GetStatusAsync(CancellationToken ct);
    Task StartAsync(CancellationToken ct);
    Task StopAsync(CancellationToken ct);
}
