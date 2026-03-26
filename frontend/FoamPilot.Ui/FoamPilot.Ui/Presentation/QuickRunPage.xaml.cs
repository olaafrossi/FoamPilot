using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace FoamPilot.Ui.Presentation;

public sealed partial class QuickRunPage : Page
{
    private const string BaseUrl = "http://localhost:8000";
    private readonly HttpClient _http = new() { BaseAddress = new Uri(BaseUrl) };
    private readonly AppConfig _config;
    private string? _jobId;

    public QuickRunPage()
    {
        this.InitializeComponent();
        _config = App.Services?.GetService<IOptions<AppConfig>>()?.Value ?? new AppConfig();
    }

    private void Log(string message)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            LogOutput.Text += message + "\n";
            LogScroll.ChangeView(null, LogScroll.ScrollableHeight, null);
        });
    }

    private void SetStatus(string text, bool busy = false)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            StatusText.Text = text;
            Progress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
            Progress.IsIndeterminate = busy;
        });
    }

    // ── Step 1: Create case from cavity template ─────────────────────

    private async void CreateCase_Click(object sender, RoutedEventArgs e)
    {
        BtnCreateCase.IsEnabled = false;
        SetStatus("Creating cavity case...", busy: true);
        Log(">>> POST /cases  {template: cavity, name: cavity}");

        try
        {
            var payload = new { template = "cavity", name = "cavity" };
            var resp = await _http.PostAsJsonAsync("/cases", payload);
            var body = await resp.Content.ReadAsStringAsync();
            Log($"<<< {(int)resp.StatusCode} {body}");

            if (resp.IsSuccessStatusCode)
            {
                SetStatus("Case created. Ready to mesh.");
                BtnMesh.IsEnabled = true;
                Log("--- Case 'cavity' created from template ---");
            }
            else
            {
                // Case might already exist — check if it's a 409 or similar
                if (body.Contains("already exists", StringComparison.OrdinalIgnoreCase))
                {
                    SetStatus("Case already exists. Ready to mesh.");
                    BtnMesh.IsEnabled = true;
                    Log("--- Case 'cavity' already exists, reusing ---");
                }
                else
                {
                    SetStatus($"Failed: {resp.StatusCode}");
                    BtnCreateCase.IsEnabled = true;
                }
            }
        }
        catch (Exception ex)
        {
            Log($"!!! ERROR: {ex.Message}");
            SetStatus($"Error: {ex.Message}");
            BtnCreateCase.IsEnabled = true;
        }
    }

    // ── Step 2: Run blockMesh ────────────────────────────────────────

    private async void RunMesh_Click(object sender, RoutedEventArgs e)
    {
        BtnMesh.IsEnabled = false;
        await RunCommand("blockMesh", () =>
        {
            BtnSolve.IsEnabled = true;
            SetStatus("Mesh complete. Ready to solve.");
        });
    }

    // ── Step 3: Run icoFoam solver ───────────────────────────────────

    private async void RunSolver_Click(object sender, RoutedEventArgs e)
    {
        BtnSolve.IsEnabled = false;
        await RunCommand("icoFoam", () =>
        {
            BtnCheckResults.IsEnabled = true;
            SetStatus("Simulation complete!");
        });
    }

    // ── Step 4: Check results ────────────────────────────────────────

    private async void CheckResults_Click(object sender, RoutedEventArgs e)
    {
        SetStatus("Checking results...", busy: true);
        Log(">>> GET /cases/cavity/files");

        try
        {
            var resp = await _http.GetAsync("/cases/cavity/files");
            var body = await resp.Content.ReadAsStringAsync();

            // Parse to find time directories (they indicate results exist)
            Log($"<<< {(int)resp.StatusCode}");

            // Also check residuals from last job
            if (_jobId is not null)
            {
                Log($">>> GET /jobs/{_jobId}/residuals");
                var resResp = await _http.GetAsync($"/jobs/{_jobId}/residuals");
                var resBody = await resResp.Content.ReadAsStringAsync();
                Log($"<<< {(int)resResp.StatusCode}");

                // Parse residuals to show summary
                try
                {
                    using var doc = JsonDocument.Parse(resBody);
                    foreach (var field in doc.RootElement.EnumerateObject())
                    {
                        var entries = field.Value.GetArrayLength();
                        if (entries > 0)
                        {
                            var last = field.Value[entries - 1];
                            var finalRes = last.GetProperty("final").GetDouble();
                            Log($"  {field.Name}: {entries} iterations, final residual = {finalRes:E3}");
                        }
                    }
                }
                catch
                {
                    Log($"  (raw residuals) {resBody[..Math.Min(200, resBody.Length)]}");
                }
            }

            SetStatus("Done! Cavity tutorial completed successfully.");
            BtnParaView.IsEnabled = true;
            BtnOpenFolder.IsEnabled = true;
            Log("\n=== CAVITY TUTORIAL COMPLETE ===");
            Log("The simulation ran icoFoam on a lid-driven cavity.");
            Log("Results are in the 'cavity' case directory.");
        }
        catch (Exception ex)
        {
            Log($"!!! ERROR: {ex.Message}");
            SetStatus($"Error: {ex.Message}");
        }
    }

    // ── Step 5: Open in ParaView ────────────────────────────────────

    private void OpenParaView_Click(object sender, RoutedEventArgs e)
    {
        var casePath = GetCasePath("cavity");
        var foamFile = Path.Combine(casePath, "cavity.foam");

        // Ensure case directory exists
        if (!Directory.Exists(casePath))
        {
            Log($"!!! Case directory not found: {casePath}");
            SetStatus("Case directory not found. Run the simulation first.");
            return;
        }

        // Create .foam file if it doesn't exist (empty file triggers ParaView's OpenFOAM reader)
        if (!File.Exists(foamFile))
        {
            File.WriteAllText(foamFile, "");
            Log($"--- Created {foamFile} ---");
        }

        var paraViewPath = _config.ParaViewPath
            ?? @"C:\Program Files\ParaView 6.0.1\bin\paraview.exe";

        if (!File.Exists(paraViewPath))
        {
            Log($"!!! ParaView not found at: {paraViewPath}");
            Log("    Set ParaViewPath in appsettings.json to your ParaView installation.");
            SetStatus("ParaView not found. Check ParaViewPath in appsettings.json.");
            return;
        }

        Log($"--- Launching ParaView: {paraViewPath} \"{foamFile}\" ---");
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = paraViewPath,
                Arguments = $"\"{foamFile}\"",
                UseShellExecute = true,
            });
            SetStatus("ParaView launched.");
        }
        catch (Exception ex)
        {
            Log($"!!! ERROR launching ParaView: {ex.Message}");
            SetStatus($"Failed to launch ParaView: {ex.Message}");
        }
    }

    // ── Step 6: Open case folder ─────────────────────────────────────

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        var casePath = GetCasePath("cavity");
        Log($"--- Opening folder: {casePath} ---");
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = $"\"{casePath}\"",
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            Log($"!!! ERROR: {ex.Message}");
        }
    }

    private string GetCasePath(string caseName)
    {
        var basePath = _config.LocalCasesPath ?? @"C:\Dev\FoamPilot\cases";
        return Path.Combine(basePath, caseName);
    }

    // ── Shared: run a command and stream logs ────────────────────────

    private async Task RunCommand(string command, Action onSuccess)
    {
        SetStatus($"Running {command}...", busy: true);
        Log($"\n>>> POST /run  {{case_name: cavity, commands: [\"{command}\"]}}");

        try
        {
            var payload = new { case_name = "cavity", commands = new[] { command } };
            var resp = await _http.PostAsJsonAsync("/run", payload);
            var body = await resp.Content.ReadAsStringAsync();
            Log($"<<< {(int)resp.StatusCode} {body}");

            if (!resp.IsSuccessStatusCode)
            {
                SetStatus($"Failed to start {command}: {resp.StatusCode}");
                return;
            }

            // Parse job ID from response
            using var doc = JsonDocument.Parse(body);
            _jobId = doc.RootElement.GetProperty("job_id").GetString();
            Log($"--- Job started: {_jobId} ---");

            // Stream logs via WebSocket
            await StreamLogs(_jobId!);

            // Check final job status
            Log($">>> GET /jobs/{_jobId}");
            var statusResp = await _http.GetAsync($"/jobs/{_jobId}");
            var statusBody = await statusResp.Content.ReadAsStringAsync();
            Log($"<<< {(int)statusResp.StatusCode} {statusBody}");

            using var statusDoc = JsonDocument.Parse(statusBody);
            var status = statusDoc.RootElement.GetProperty("status").GetString();
            var exitCode = statusDoc.RootElement.TryGetProperty("exit_code", out var ec) ? ec.GetInt32() : -1;

            if (status == "completed" && exitCode == 0)
            {
                Log($"--- {command} completed successfully (exit code 0) ---");
                onSuccess();
            }
            else
            {
                SetStatus($"{command} failed (status={status}, exit={exitCode})");
                Log($"!!! {command} failed: status={status}, exit_code={exitCode}");
            }
        }
        catch (Exception ex)
        {
            Log($"!!! ERROR: {ex.Message}");
            SetStatus($"Error running {command}: {ex.Message}");
        }
    }

    private async Task StreamLogs(string jobId)
    {
        var wsUrl = $"ws://localhost:8000/logs/{jobId}";
        Log($"--- Connecting WebSocket: {wsUrl} ---");

        using var ws = new System.Net.WebSockets.ClientWebSocket();
        try
        {
            await ws.ConnectAsync(new Uri(wsUrl), CancellationToken.None);
            Log("--- WebSocket connected, streaming logs ---");

            var buffer = new byte[4096];
            while (ws.State == System.Net.WebSockets.WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buffer, CancellationToken.None);
                if (result.MessageType == System.Net.WebSockets.WebSocketMessageType.Close)
                    break;

                var msg = Encoding.UTF8.GetString(buffer, 0, result.Count);
                try
                {
                    using var msgDoc = JsonDocument.Parse(msg);
                    var line = msgDoc.RootElement.GetProperty("line").GetString() ?? "";
                    var stream = msgDoc.RootElement.GetProperty("stream").GetString() ?? "";

                    if (stream == "eof")
                    {
                        Log("--- Log stream ended ---");
                        break;
                    }

                    Log(line);
                }
                catch
                {
                    Log(msg);
                }
            }
        }
        catch (Exception ex)
        {
            Log($"--- WebSocket error: {ex.Message} ---");
            // Fall back to polling the full log
            Log("--- Falling back to HTTP log fetch ---");
            await Task.Delay(2000);
            try
            {
                var logResp = await _http.GetAsync($"/jobs/{jobId}/log");
                var logBody = await logResp.Content.ReadAsStringAsync();
                Log(logBody);
            }
            catch (Exception ex2)
            {
                Log($"!!! Log fetch also failed: {ex2.Message}");
            }
        }
    }
}
