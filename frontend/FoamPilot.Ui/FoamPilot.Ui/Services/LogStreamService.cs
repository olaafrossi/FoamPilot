using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace FoamPilot.Ui.Services;

public sealed class LogStreamService : ILogStreamService
{
    private readonly Func<Uri> _baseUriFactory;

    public LogStreamService(Func<Uri> baseUriFactory)
    {
        _baseUriFactory = baseUriFactory;
    }

    public async IAsyncEnumerable<LogLine> StreamAsync(
        string jobId,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var baseUri = _baseUriFactory();
        var wsScheme = baseUri.Scheme == "https" ? "wss" : "ws";
        var wsUri = new Uri($"{wsScheme}://{baseUri.Authority}/logs/{Uri.EscapeDataString(jobId)}");

        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(wsUri, ct);

        var buffer = new byte[4096];

        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(buffer, ct);

            if (result.MessageType == WebSocketMessageType.Close)
                break;

            var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
            var msg = JsonSerializer.Deserialize<WsLogMessage>(json, _jsonOptions);
            if (msg is null)
                continue;

            if (msg.Stream == "eof")
                break;

            yield return new LogLine(msg.Line, msg.Stream, DateTime.UtcNow);
        }
    }

    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    private sealed record WsLogMessage(string Line, string Stream);
}
