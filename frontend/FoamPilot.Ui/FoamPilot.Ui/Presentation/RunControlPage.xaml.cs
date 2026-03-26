using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace FoamPilot.Ui.Presentation;

public sealed partial class RunControlPage : Page
{
    private readonly HttpClient _http;
    private DispatcherTimer? _timer;

    public RunControlPage()
    {
        this.InitializeComponent();

        var config = App.Services?.GetService<IOptions<AppConfig>>()?.Value ?? new AppConfig();
        _http = new HttpClient { BaseAddress = new Uri(config.BackendUrl) };

        this.Loaded += async (_, _) =>
        {
            await LoadCases();
            await LoadJobs();
            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _timer.Tick += async (_, _) => await LoadJobs();
            _timer.Start();
        };
        this.Unloaded += (_, _) => { _timer?.Stop(); _timer = null; };
    }

    private async Task LoadCases()
    {
        try
        {
            var resp = await _http.GetAsync("/cases");
            if (!resp.IsSuccessStatusCode) return;
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var names = doc.RootElement.EnumerateArray()
                .Select(c => c.GetProperty("name").GetString() ?? "").ToList();
            CaseCombo.ItemsSource = names;
            if (names.Count > 0) CaseCombo.SelectedIndex = 0;
        }
        catch { }
    }

    private async Task LoadJobs()
    {
        try
        {
            var resp = await _http.GetAsync("/jobs");
            if (!resp.IsSuccessStatusCode) return;
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var jobs = doc.RootElement.EnumerateArray()
                .OrderByDescending(j => j.TryGetProperty("start_time", out var st) && st.ValueKind != JsonValueKind.Null ? st.GetString() : "")
                .Take(20)
                .Select(j =>
                {
                    var status = j.GetProperty("status").GetString() ?? "";
                    return new JobRow
                    {
                        JobId = j.GetProperty("job_id").GetString() ?? "",
                        Command = string.Join(", ", j.GetProperty("commands").EnumerateArray().Select(c => c.GetString())),
                        Status = status,
                        Elapsed = FormatElapsed(j),
                        CanCancel = status is "running" or "queued" ? Visibility.Visible : Visibility.Collapsed,
                    };
                }).ToList();

            DispatcherQueue.TryEnqueue(() => JobsList.ItemsSource = jobs);
        }
        catch { }
    }

    private async void RunCmd_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string cmd)
            await RunCommand(cmd);
    }

    private async void RunSolver_Click(object sender, RoutedEventArgs e)
    {
        var caseName = CaseCombo.SelectedItem as string;
        if (string.IsNullOrEmpty(caseName)) { StatusText.Text = "Select a case."; return; }

        try
        {
            var resp = await _http.GetAsync($"/cases/{caseName}/solver");
            if (!resp.IsSuccessStatusCode) { StatusText.Text = "Could not detect solver."; return; }
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var solver = doc.RootElement.GetProperty("solver").GetString() ?? "icoFoam";
            await RunCommand(solver);
        }
        catch (Exception ex) { StatusText.Text = $"Error: {ex.Message}"; }
    }

    private async void RunCustom_Click(object sender, RoutedEventArgs e)
    {
        var cmd = CustomCmdBox.Text.Trim();
        if (!string.IsNullOrEmpty(cmd)) await RunCommand(cmd);
    }

    private async Task RunCommand(string command)
    {
        var caseName = CaseCombo.SelectedItem as string;
        if (string.IsNullOrEmpty(caseName)) { StatusText.Text = "Select a case first."; return; }

        StatusText.Text = $"Starting {command}...";
        try
        {
            var resp = await _http.PostAsJsonAsync("/run", new { case_name = caseName, commands = new[] { command } });
            var body = await resp.Content.ReadAsStringAsync();
            if (resp.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(body);
                var jobId = doc.RootElement.GetProperty("job_id").GetString();
                StatusText.Text = $"Job {jobId} started.";
                await LoadJobs();
            }
            else
            {
                StatusText.Text = $"Failed: {body}";
            }
        }
        catch (Exception ex) { StatusText.Text = $"Error: {ex.Message}"; }
    }

    private async void CancelJob_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string jobId)
        {
            await _http.DeleteAsync($"/jobs/{jobId}");
            await LoadJobs();
        }
    }

    private async void RefreshJobs_Click(object sender, RoutedEventArgs e) => await LoadJobs();

    private static string FormatElapsed(JsonElement j)
    {
        if (!j.TryGetProperty("start_time", out var st) || st.ValueKind == JsonValueKind.Null) return "";
        if (!j.TryGetProperty("end_time", out var et) || et.ValueKind == JsonValueKind.Null) return "running...";
        try
        {
            var elapsed = DateTimeOffset.Parse(et.GetString()!) - DateTimeOffset.Parse(st.GetString()!);
            return elapsed.TotalSeconds < 60 ? $"{elapsed.TotalSeconds:F1}s" : $"{elapsed.TotalMinutes:F1}m";
        }
        catch { return ""; }
    }

    private class JobRow
    {
        public string JobId { get; init; } = "";
        public string Command { get; init; } = "";
        public string Status { get; init; } = "";
        public string Elapsed { get; init; } = "";
        public Visibility CanCancel { get; init; }
    }
}
