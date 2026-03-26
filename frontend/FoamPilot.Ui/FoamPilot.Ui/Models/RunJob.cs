namespace FoamPilot.Ui.Models;

public partial record RunJob(
    string Id,
    string CaseName,
    string Command,
    JobStatus Status,
    DateTime StartTime,
    DateTime? EndTime,
    int? ExitCode)
{
    public string Elapsed
    {
        get
        {
            var end = EndTime ?? DateTime.UtcNow;
            var span = end - StartTime;
            return span.TotalHours >= 1
                ? span.ToString(@"h\:mm\:ss")
                : span.ToString(@"m\:ss");
        }
    }

    public bool CanCancel => Status is JobStatus.Running or JobStatus.Queued;
}

public enum JobStatus
{
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled
}
