namespace FoamPilot.Ui.Services;

public interface IParaViewService
{
    string ParaViewPath { get; set; }
    bool AutoStartContainer { get; set; }
    Task LaunchAsync(string caseName, IOpenFoamApiClient api, CancellationToken ct);
}
