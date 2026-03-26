namespace FoamPilot.Ui.Models;

public record ResidualPoint(
    int Iteration,
    string Field,
    double InitialResidual,
    double FinalResidual);
