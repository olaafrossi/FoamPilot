using System.Runtime.CompilerServices;

namespace FoamPilot.Ui.Services;

public interface ILogStreamService
{
    IAsyncEnumerable<LogLine> StreamAsync(
        string jobId,
        [EnumeratorCancellation] CancellationToken ct = default);
}
