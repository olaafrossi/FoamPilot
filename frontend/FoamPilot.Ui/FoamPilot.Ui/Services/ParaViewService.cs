using System.Diagnostics;

namespace FoamPilot.Ui.Services;

public sealed class ParaViewService : IParaViewService
{
    public string ParaViewPath { get; set; } =
        OperatingSystem.IsWindows()
            ? @"C:\Program Files\ParaView 5.13.0\bin\paraview.exe"
            : OperatingSystem.IsMacOS()
                ? "/Applications/ParaView-5.13.0.app/Contents/MacOS/paraview"
                : "paraview";

    public bool AutoStartContainer { get; set; }

    public async Task LaunchAsync(string caseName, IOpenFoamApiClient api, CancellationToken ct)
    {
        var foamFilePath = await api.EnsureFoamFileAsync(caseName, ct);

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = ParaViewPath,
                Arguments = $"\"{foamFilePath}\"",
                UseShellExecute = true
            });
        }
        catch
        {
            // Swallow process start failures (e.g. ParaView not installed)
        }
    }
}
