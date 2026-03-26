namespace FoamPilot.Ui.Models;

public record AppConfig
{
    public string? Environment { get; init; }
    public string ParaViewPath { get; init; } = @"C:\Program Files\ParaView 6.0.1\bin\paraview.exe";
    public string LocalCasesPath { get; init; } = @"C:\Dev\FoamPilot\cases";
    public string BackendUrl { get; init; } = "http://localhost:8000";
    public string DockerComposePath { get; init; } = "./docker";
    public bool AutoStartContainer { get; init; }
}
