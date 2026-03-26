namespace FoamPilot.Ui.Models;

public record FileNode(
    string Name,
    string Path,
    string Type,
    IImmutableList<FileNode>? Children);
