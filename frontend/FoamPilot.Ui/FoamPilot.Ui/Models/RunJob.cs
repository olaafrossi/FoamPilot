namespace FoamPilot.Ui.Models;

public partial record RunJob(
    string Id,
    string CaseName,
    string Command,
    JobStatus Status,
    DateTime StartTime,
    DateTime? EndTime,
    int? ExitCode);

public enum JobStatus
{
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled
}
