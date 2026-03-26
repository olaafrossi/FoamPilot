namespace FoamPilot.Ui.Models;

public record LogLine(
    string Text,
    string Stream,
    DateTime Timestamp);
