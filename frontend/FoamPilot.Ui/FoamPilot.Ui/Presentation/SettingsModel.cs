using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public partial record SettingsModel
{
    private readonly IDockerManager _docker;
    private readonly IParaViewService _paraView;

    public SettingsModel(IDockerManager docker, IParaViewService paraView)
    {
        _docker = docker;
        _paraView = paraView;
    }

    public IState<string> BackendUrl => State<string>.Value(this, () => "http://localhost:8000");

    public IState<string> DockerComposePath => State<string>.Value(this, () => "./docker");

    public IState<string> ParaViewPath => State<string>.Value(this, () => _paraView.ParaViewPath);

    public IState<bool> AutoStartContainer => State<bool>.Value(this, () => _paraView.AutoStartContainer);

    public IState<string> Theme => State<string>.Value(this, () => "System");

    public async ValueTask StartContainer(CancellationToken ct)
    {
        await _docker.StartAsync(ct);
    }

    public async ValueTask StopContainer(CancellationToken ct)
    {
        await _docker.StopAsync(ct);
    }

    public async ValueTask SaveParaViewPath(string path, CancellationToken ct)
    {
        _paraView.ParaViewPath = path;
        await ParaViewPath.UpdateAsync(_ => path, ct);
    }

    public ValueTask SaveAutoStart(bool value)
    {
        _paraView.AutoStartContainer = value;
        return ValueTask.CompletedTask;
    }
}
