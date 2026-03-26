using System.Net.Http;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LiveChartsCore;
using LiveChartsCore.Defaults;
using LiveChartsCore.SkiaSharpView;
using LiveChartsCore.SkiaSharpView.WinUI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace FoamPilot.Ui.Presentation.WizardSteps;

/// <summary>
/// Step 4 — Run: Stream solver output via WebSocket, show live convergence
/// chart, detect divergence, show progress bar, fire toast on completion.
/// </summary>
public sealed class RunStep : WizardStepBase
{
    public override string Title => "Run";
    public override int Index => 4;
    public override bool HasExecution => true;

    private TextBlock? _logOutput;
    private ScrollViewer? _logScroll;
    private CartesianChart? _chart;
    private TextBlock? _progressText;
    private ProgressBar? _progressBar;
    private Button? _cancelButton;
    private string? _solverCommand;
    private CancellationTokenSource? _cancelSource;
    private double _endTime = 500;
    private bool _diverged;
    private int _cores = 1;

    // Residual tracking for convergence chart
    private readonly Dictionary<string, List<ObservablePoint>> _residualData = [];
    private readonly List<ISeries> _chartSeries = [];
    private int _iteration;

    private static readonly Regex ResidualRegex = new(
        @"Solving for (\w+), Initial residual = ([0-9.eE+-]+), Final residual = ([0-9.eE+-]+)",
        RegexOptions.Compiled);

    private static readonly Regex TimeRegex = new(
        @"^Time = (\d+)", RegexOptions.Compiled);

    public RunStep(HttpClient http, AppConfig config) : base(http, config) { }

    public void SetSolverCommand(string? solver)
    {
        _solverCommand = solver;
    }

    public void SetEndTime(double endTime)
    {
        _endTime = endTime;
    }

    /// <summary>Set the number of cores for parallel solving.</summary>
    public void SetCores(int cores) => _cores = Math.Max(1, cores);

    public bool Diverged => _diverged;

    public override Panel CreateUI()
    {
        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // header
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // progress
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(250) }); // chart
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // log

        // Header
        var headerPanel = new Grid();
        headerPanel.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerPanel.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var header = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
        header.Children.Add(new TextBlock
        {
            Text = "Running Simulation",
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        });
        header.Children.Add(new TextBlock
        {
            Text = "The solver is running. Watch the residuals converge below — when all lines trend downward, the simulation is converging.",
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            Margin = new Thickness(0, 4, 0, 0),
        });
        Grid.SetColumn(header, 0);
        headerPanel.Children.Add(header);

        _cancelButton = new Button
        {
            Content = "Cancel",
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
        };
        _cancelButton.Click += (_, _) => _cancelSource?.Cancel();
        Grid.SetColumn(_cancelButton, 1);
        headerPanel.Children.Add(_cancelButton);

        Grid.SetRow(headerPanel, 0);
        root.Children.Add(headerPanel);

        // Progress bar
        var progressPanel = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
        _progressBar = new ProgressBar
        {
            Minimum = 0,
            Maximum = 100,
            Value = 0,
        };
        progressPanel.Children.Add(_progressBar);
        _progressText = new TextBlock
        {
            FontSize = 11,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            Margin = new Thickness(0, 2, 0, 0),
        };
        progressPanel.Children.Add(_progressText);
        Grid.SetRow(progressPanel, 1);
        root.Children.Add(progressPanel);

        // Convergence chart
        _chart = new CartesianChart
        {
            Series = _chartSeries,
            YAxes = [new LiveChartsCore.SkiaSharpView.Axis
            {
                Name = "Residual (log scale)",
                MinLimit = -8,
                MaxLimit = 0,
            }],
            XAxes = [new LiveChartsCore.SkiaSharpView.Axis
            {
                Name = "Iteration",
            }],
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        };
        Grid.SetRow(_chart, 2);
        root.Children.Add(_chart);

        // Log output
        _logScroll = new ScrollViewer
        {
            Background = new SolidColorBrush(Microsoft.UI.Colors.Black),
            Padding = new Thickness(8),
            CornerRadius = new CornerRadius(4),
        };
        _logOutput = new TextBlock
        {
            FontFamily = new FontFamily("Cascadia Code, Consolas, monospace"),
            FontSize = 11,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.LightGreen),
            TextWrapping = TextWrapping.NoWrap,
            IsTextSelectionEnabled = true,
        };
        _logScroll.Content = _logOutput;
        Grid.SetRow(_logScroll, 3);
        root.Children.Add(_logScroll);

        return root;
    }

    public override async Task<bool> ExecuteAsync(Action<string> log, Action<string> setStatus, CancellationToken ct)
    {
        _cancelSource = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var token = _cancelSource.Token;
        _diverged = false;
        _iteration = 0;
        _residualData.Clear();
        _chartSeries.Clear();

        /*
         * Solver pipeline (serial vs parallel):
         *
         * Serial (1 core):
         *   simpleFoam                              (streamed via WebSocket)
         *
         * Parallel (N cores):
         *   decomposePar →                          (quick, polled)
         *   mpirun -np N simpleFoam -parallel →     (streamed via WebSocket)
         *   reconstructPar                          (quick, polled)
         */

        var baseSolver = _solverCommand ?? "simpleFoam";
        bool useParallel = _cores > 1;

        try
        {
            // Phase 1: decomposePar (parallel only, quick)
            if (useParallel)
            {
                // Ensure decomposeParDict exists with correct core count
                var decomposeDict =
                    "FoamFile\n{\n    version     2.0;\n    format      ascii;\n" +
                    "    class       dictionary;\n    object      decomposeParDict;\n}\n\n" +
                    $"numberOfSubdomains  {_cores};\n\nmethod          scotch;\n";
                await SaveFileAsync("system/decomposeParDict", decomposeDict);

                // Clean up stale processor directories from mesh step
                setStatus("Cleaning processor directories...");
                await RunCommandAsync("rm -rf processor*", log, setStatus, token);

                setStatus($"Decomposing case for {_cores} cores...");
                log($">>> decomposePar ({_cores} subdomains)");
                var (decompOk, _) = await RunCommandAsync("decomposePar", log, setStatus, token);
                if (!decompOk) { setStatus("decomposePar failed."); return false; }
            }

            // Phase 2: Run the solver (streamed via WebSocket)
            var command = useParallel
                ? $"mpirun -np {_cores} {baseSolver} -parallel"
                : baseSolver;

            setStatus($"Starting {command}...");
            log($">>> {command}");

            var resp = await Http.PostAsJsonAsync("/run",
                new { case_name = CaseName, commands = new[] { command } }, token);
            if (!resp.IsSuccessStatusCode)
            {
                log($"<<< Failed to start: {resp.StatusCode}");
                return false;
            }

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(token));
            var jobId = doc.RootElement.GetProperty("job_id").GetString()!;

            // Stream via WebSocket
            var wsScheme = Config.BackendUrl.StartsWith("https") ? "wss" : "ws";
            var wsHost = Config.BackendUrl.Replace("http://", "").Replace("https://", "");
            using var ws = new ClientWebSocket();
            await ws.ConnectAsync(new Uri($"{wsScheme}://{wsHost}/logs/{jobId}"), token);

            var logBuffer = new StringBuilder();
            var fullLog = new StringBuilder();
            var dispatcher = DispatcherQueue.GetForCurrentThread();

            // Flush timer: update UI every 250ms
            var flushTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
            flushTimer.Tick += (_, _) =>
            {
                if (logBuffer.Length > 0)
                {
                    var batch = logBuffer.ToString();
                    logBuffer.Clear();
                    fullLog.Append(batch);
                    if (fullLog.Length > 200_000)
                    {
                        var trimmed = fullLog.ToString();
                        fullLog.Clear();
                        fullLog.Append(trimmed[^150_000..]);
                    }
                    if (_logOutput is not null) _logOutput.Text = fullLog.ToString();
                    if (_logScroll is not null) _logScroll.ChangeView(null, _logScroll.ScrollableHeight, null);
                }
            };
            flushTimer.Start();

            var buffer = new byte[4096];
            while (ws.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                var result = await ws.ReceiveAsync(buffer, token);
                if (result.MessageType == WebSocketMessageType.Close) break;
                var msg = Encoding.UTF8.GetString(buffer, 0, result.Count);

                try
                {
                    using var msgDoc = JsonDocument.Parse(msg);
                    var line = msgDoc.RootElement.GetProperty("line").GetString() ?? "";
                    var stream = msgDoc.RootElement.GetProperty("stream").GetString() ?? "";
                    if (stream == "eof") break;

                    lock (logBuffer) { logBuffer.AppendLine(line); }

                    // Parse residuals for chart
                    ParseAndUpdateChart(line, dispatcher);
                }
                catch { }
            }

            flushTimer.Stop();
            // Final flush
            if (logBuffer.Length > 0 && _logOutput is not null)
            {
                fullLog.Append(logBuffer);
                dispatcher?.TryEnqueue(() => _logOutput.Text = fullLog.ToString());
            }

            // Check job status
            var statusResp = await Http.GetAsync($"/jobs/{jobId}");
            using var statusDoc = JsonDocument.Parse(await statusResp.Content.ReadAsStringAsync());
            var status = statusDoc.RootElement.GetProperty("status").GetString();

            // Check for divergence
            CheckDivergence();

            var solverCompleted = status == "completed";

            // Phase 3: reconstructPar (parallel only, quick)
            if (solverCompleted && useParallel)
            {
                setStatus("Reconstructing parallel results...");
                log(">>> reconstructPar");
                var (reconOk, _) = await RunCommandAsync("reconstructPar", log, setStatus, token);
                if (!reconOk)
                {
                    log("Warning: reconstructPar failed — results may be in processor directories.");
                }
            }

            // Check for divergence
            CheckDivergence();

            IsComplete = solverCompleted;
            if (IsComplete)
            {
                var coresMsg = useParallel ? $" ({_cores} cores)" : "";
                setStatus(_diverged
                    ? $"⚠️ Solver completed{coresMsg} but may not have converged — check residual plot."
                    : $"✓ Solver completed successfully{coresMsg}.");

                FireCompletionToast();
            }
            else
            {
                setStatus("Solver failed — check log output.");
            }

            return IsComplete;
        }
        catch (OperationCanceledException)
        {
            setStatus("Solver cancelled.");
            return false;
        }
        catch (Exception ex)
        {
            log($"Error: {ex.Message}");
            return false;
        }
    }

    private void ParseAndUpdateChart(string line, DispatcherQueue? dispatcher)
    {
        // Parse time step for progress
        var timeMatch = TimeRegex.Match(line);
        if (timeMatch.Success && double.TryParse(timeMatch.Groups[1].Value, out var time))
        {
            _iteration = (int)time;
            var progress = Math.Min(100, (time / _endTime) * 100);
            dispatcher?.TryEnqueue(() =>
            {
                if (_progressBar is not null) _progressBar.Value = progress;
                if (_progressText is not null)
                    _progressText.Text = $"Iteration {_iteration} / {_endTime:F0} ({progress:F0}%)";
            });
        }

        // Parse residuals for chart
        var match = ResidualRegex.Match(line);
        if (match.Success)
        {
            var field = match.Groups[1].Value;
            var initial = double.TryParse(match.Groups[2].Value, out var i) ? i : 0;
            var logResidual = initial > 0 ? Math.Log10(initial) : -10;

            dispatcher?.TryEnqueue(() =>
            {
                if (!_residualData.ContainsKey(field))
                {
                    _residualData[field] = [];
                    var series = new LineSeries<ObservablePoint>
                    {
                        Values = _residualData[field],
                        Name = field,
                        GeometrySize = 0,
                        LineSmoothness = 0,
                        Fill = null,
                    };
                    _chartSeries.Add(series);
                }
                _residualData[field].Add(new ObservablePoint(_iteration, logResidual));

                // Trim to last 500 points for performance
                if (_residualData[field].Count > 500)
                    _residualData[field].RemoveAt(0);
            });
        }
    }

    private void CheckDivergence()
    {
        // Check if any final residual is above threshold
        foreach (var (field, points) in _residualData)
        {
            if (points.Count < 10) continue;
            var last = points[^1].Y;
            if (last is not null && last > 0) // log10(residual) > 0 means residual > 1.0
            {
                _diverged = true;
                return;
            }
        }
    }

    private void FireCompletionToast()
    {
        // Toast notifications require app packaging (MSIX) which we don't have yet.
        // For now, this is a no-op placeholder. The UI already shows completion status
        // prominently in the wizard, and the convergence chart makes progress visible.
        // TODO: Add toast support when the app is packaged for distribution.
    }
}
