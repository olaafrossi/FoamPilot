using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace FoamPilot.Ui.Presentation;

public sealed partial class LogsPage : Page
{
    private readonly HttpClient _http;
    private readonly string _backendUrl;
    private CancellationTokenSource? _streamCts;

    public LogsPage()
    {
        this.InitializeComponent();

        var config = App.Services?.GetService<IOptions<AppConfig>>()?.Value ?? new AppConfig();
        _http = new HttpClient { BaseAddress = new Uri(config.BackendUrl) };
        _backendUrl = config.BackendUrl;

        this.Loaded += async (_, _) => await LoadJobs();
        this.Unloaded += (_, _) => _streamCts?.Cancel();
    }

    private async Task LoadJobs()
    {
        try
        {
            var resp = await _http.GetAsync("/jobs");
            if (!resp.IsSuccessStatusCode) return;
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var items = doc.RootElement.EnumerateArray()
                .OrderByDescending(j => j.TryGetProperty("start_time", out var st) && st.ValueKind != JsonValueKind.Null ? st.GetString() : "")
                .Select(j =>
                {
                    var id = j.GetProperty("job_id").GetString() ?? "";
                    var cmds = string.Join(", ", j.GetProperty("commands").EnumerateArray().Select(c => c.GetString()));
                    var caseName = j.GetProperty("case_name").GetString() ?? "";
                    var status = j.GetProperty("status").GetString() ?? "";
                    return new JobItem { Id = id, Display = $"{caseName} — {cmds} ({status})", Status = status };
                }).ToList();

            JobCombo.ItemsSource = items;
            JobCombo.DisplayMemberPath = "Display";
            if (items.Count > 0) JobCombo.SelectedIndex = 0;
        }
        catch (Exception ex) { StatusText.Text = $"Error: {ex.Message}"; }
    }

    private async void JobCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (JobCombo.SelectedItem is not JobItem job) return;

        // Cancel previous stream
        _streamCts?.Cancel();
        _streamCts = new CancellationTokenSource();
        LogOutput.Text = "";

        if (job.Status is "running" or "queued")
        {
            StatusText.Text = "Streaming live...";
            await StreamLogs(job.Id, _streamCts.Token);
        }
        else
        {
            StatusText.Text = "Loading completed log...";
            await LoadFullLog(job.Id);
        }
    }

    private async Task LoadFullLog(string jobId)
    {
        try
        {
            var resp = await _http.GetAsync($"/jobs/{jobId}/log");
            var text = await resp.Content.ReadAsStringAsync();
            DispatcherQueue.TryEnqueue(() =>
            {
                LogOutput.Text = text;
                StatusText.Text = $"Log loaded ({text.Split('\n').Length} lines).";
                if (AutoScrollToggle.IsOn)
                    LogScroll.ChangeView(null, LogScroll.ScrollableHeight, null);
            });
        }
        catch (Exception ex) { DispatcherQueue.TryEnqueue(() => StatusText.Text = $"Error: {ex.Message}"); }
    }

    private async Task StreamLogs(string jobId, CancellationToken ct)
    {
        var wsScheme = _backendUrl.StartsWith("https") ? "wss" : "ws";
        var wsHost = _backendUrl.Replace("http://", "").Replace("https://", "");
        var wsUrl = $"{wsScheme}://{wsHost}/logs/{jobId}";

        using var ws = new ClientWebSocket();
        try
        {
            await ws.ConnectAsync(new Uri(wsUrl), ct);
            var buffer = new byte[4096];
            var sb = new StringBuilder();

            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await ws.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close) break;

                var msg = Encoding.UTF8.GetString(buffer, 0, result.Count);
                try
                {
                    using var msgDoc = JsonDocument.Parse(msg);
                    var line = msgDoc.RootElement.GetProperty("line").GetString() ?? "";
                    var stream = msgDoc.RootElement.GetProperty("stream").GetString() ?? "";
                    if (stream == "eof") break;
                    sb.AppendLine(line);

                    // Batch UI updates
                    if (sb.Length > 500 || result.Count < 100)
                    {
                        var batch = sb.ToString();
                        sb.Clear();
                        DispatcherQueue.TryEnqueue(() =>
                        {
                            LogOutput.Text += batch;
                            if (AutoScrollToggle.IsOn)
                                LogScroll.ChangeView(null, LogScroll.ScrollableHeight, null);
                        });
                    }
                }
                catch { sb.AppendLine(msg); }
            }

            // Flush remaining
            if (sb.Length > 0)
            {
                var remaining = sb.ToString();
                DispatcherQueue.TryEnqueue(() => LogOutput.Text += remaining);
            }

            DispatcherQueue.TryEnqueue(() => StatusText.Text = "Stream ended.");
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            DispatcherQueue.TryEnqueue(() => StatusText.Text = $"WebSocket error: {ex.Message}");
            // Fallback to HTTP
            await LoadFullLog(jobId);
        }
    }

    private async void RefreshJobs_Click(object sender, RoutedEventArgs e) => await LoadJobs();

    private class JobItem
    {
        public string Id { get; init; } = "";
        public string Display { get; init; } = "";
        public string Status { get; init; } = "";
    }
}
