using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public partial record SettingsModel
{
    private readonly IDockerManager _docker;

    public SettingsModel(IDockerManager docker)
    {
        _docker = docker;
    }

    public IState<string> BackendUrl => State<string>.Value(this, () => "http://localhost:8000");

    public IState<string> DockerComposePath => State<string>.Value(this, () => "./docker");

    public async ValueTask StartContainer(CancellationToken ct)
    {
        await _docker.StartAsync(ct);
    }

    public async ValueTask StopContainer(CancellationToken ct)
    {
        await _docker.StopAsync(ct);
    }
}
