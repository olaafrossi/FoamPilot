using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public sealed partial class DashboardPage : Page
{
    private readonly HttpClient _http;
    private readonly IDockerManager? _docker;
    private DispatcherTimer? _timer;

    public DashboardPage()
    {
        this.InitializeComponent();

        var config = App.Services?.GetService<IOptions<AppConfig>>()?.Value ?? new AppConfig();
        _http = new HttpClient { BaseAddress = new Uri(config.BackendUrl) };
        _docker = App.Services?.GetService<IDockerManager>();

        this.Loaded += (_, _) => StartPolling();
        this.Unloaded += (_, _) => StopPolling();
    }

    private void StartPolling()
    {
        _ = RefreshAll();
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _timer.Tick += async (_, _) => await RefreshAll();
        _timer.Start();
    }

    private void StopPolling()
    {
        _timer?.Stop();
        _timer = null;
    }

    private async Task RefreshAll()
    {
        await Task.WhenAll(
            RefreshCases(),
            RefreshJobs(),
            RefreshBackend(),
            RefreshContainer()
        );
    }

    private async Task RefreshCases()
    {
        try
        {
            var resp = await _http.GetAsync("/cases");
            if (resp.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
                var count = doc.RootElement.GetArrayLength();
                DispatcherQueue.TryEnqueue(() => CaseCountText.Text = count.ToString());
            }
        }
        catch
        {
            DispatcherQueue.TryEnqueue(() => CaseCountText.Text = "--");
        }
    }

    private async Task RefreshJobs()
    {
        try
        {
            var resp = await _http.GetAsync("/jobs");
            if (!resp.IsSuccessStatusCode) return;

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var jobs = doc.RootElement.EnumerateArray().ToArray();

            var active = jobs.Count(j =>
            {
                var s = j.GetProperty("status").GetString();
                return s == "running" || s == "queued";
            });

            // Take last 10 for the list
            var recent = jobs.OrderByDescending(j =>
                j.TryGetProperty("start_time", out var st) && st.ValueKind != JsonValueKind.Null
                    ? st.GetString() : "")
                .Take(10)
                .Select(j => new JobRow
                {
                    CaseName = j.GetProperty("case_name").GetString() ?? "",
                    Command = string.Join(", ", j.GetProperty("commands").EnumerateArray().Select(c => c.GetString())),
                    Status = j.GetProperty("status").GetString() ?? "",
                    Elapsed = FormatElapsed(j),
                })
                .ToList();

            DispatcherQueue.TryEnqueue(() =>
            {
                ActiveJobsText.Text = active.ToString();
                JobsList.ItemsSource = recent;
                NoJobsText.Visibility = recent.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            });
        }
        catch
        {
            DispatcherQueue.TryEnqueue(() => ActiveJobsText.Text = "--");
        }
    }

    private async Task RefreshBackend()
    {
        try
        {
            var resp = await _http.GetAsync("/health");
            var ok = resp.IsSuccessStatusCode;
            DispatcherQueue.TryEnqueue(() =>
            {
                BackendStatusText.Text = ok ? "Connected" : "Error";
                BackendDot.Fill = new Microsoft.UI.Xaml.Media.SolidColorBrush(
                    ok ? Microsoft.UI.Colors.LimeGreen : Microsoft.UI.Colors.Red);
            });
        }
        catch
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                BackendStatusText.Text = "Offline";
                BackendDot.Fill = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Red);
            });
        }
    }

    private async Task RefreshContainer()
    {
        if (_docker is null) return;
        try
        {
            var status = await _docker.GetStatusAsync(CancellationToken.None);
            DispatcherQueue.TryEnqueue(() =>
            {
                ContainerStatusText.Text = status.ToString();
                ContainerDot.Fill = new Microsoft.UI.Xaml.Media.SolidColorBrush(
                    status == ContainerStatus.Running ? Microsoft.UI.Colors.LimeGreen
                    : status == ContainerStatus.Stopped ? Microsoft.UI.Colors.Orange
                    : Microsoft.UI.Colors.Gray);
            });
        }
        catch
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                ContainerStatusText.Text = "Unknown";
                ContainerDot.Fill = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Gray);
            });
        }
    }

    private static string FormatElapsed(JsonElement job)
    {
        if (!job.TryGetProperty("start_time", out var st) || st.ValueKind == JsonValueKind.Null)
            return "";
        if (!job.TryGetProperty("end_time", out var et) || et.ValueKind == JsonValueKind.Null)
            return "running...";
        try
        {
            var start = DateTimeOffset.Parse(st.GetString()!);
            var end = DateTimeOffset.Parse(et.GetString()!);
            var elapsed = end - start;
            return elapsed.TotalSeconds < 60
                ? $"{elapsed.TotalSeconds:F1}s"
                : $"{elapsed.TotalMinutes:F1}m";
        }
        catch { return ""; }
    }

    private class JobRow
    {
        public string CaseName { get; init; } = "";
        public string Command { get; init; } = "";
        public string Status { get; init; } = "";
        public string Elapsed { get; init; } = "";
    }
}
