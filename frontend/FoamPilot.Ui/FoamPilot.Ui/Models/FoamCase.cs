namespace FoamPilot.Ui.Models;

public record FoamCase(
    string Name,
    string Path,
    DateTime LastModified,
    bool HasMesh,
    bool HasResults);
