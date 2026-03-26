using System.Text.RegularExpressions;
using FoamPilot.Ui.Services;
using LiveChartsCore;
using LiveChartsCore.Defaults;
using LiveChartsCore.SkiaSharpView;

namespace FoamPilot.Ui.Presentation;

public partial record LogsModel
{
    private const int MaxLogLines = 50_000;
    private const int ResidualBatchSize = 10;

    private static readonly Regex ResidualRegex = new(
        @"Solving for (\w+), Initial residual = ([\d.e+-]+), Final residual = ([\d.e+-]+), No Iterations (\d+)",
        RegexOptions.Compiled);

    private static readonly string[] Palette =
    [
        "#2196F3", "#F44336", "#4CAF50", "#FF9800", "#9C27B0",
        "#00BCD4", "#FFEB3B", "#795548", "#607D8B", "#E91E63"
    ];

    private readonly IOpenFoamApiClient _api;
    private readonly ILogStreamService _logStream;

    private CancellationTokenSource? _streamCts;

    public LogsModel(IOpenFoamApiClient api, ILogStreamService logStream)
    {
        _api = api;
        _logStream = logStream;
    }

    /// <summary>All known jobs for the ComboBox selector.</summary>
    public IListFeed<RunJob> Jobs => ListFeed.Async(async ct =>
        await _api.GetJobsAsync(ct));

    /// <summary>The currently selected job.</summary>
    public IState<RunJob> SelectedJob => State<RunJob>.Empty(this);

    /// <summary>Accumulated log lines (capped at <see cref="MaxLogLines"/>).</summary>
    public IState<ImmutableList<LogLine>> LogLines =>
        State<ImmutableList<LogLine>>.Value(this, () => ImmutableList<LogLine>.Empty);

    /// <summary>Parsed residual points grouped by field.</summary>
    public IState<ImmutableList<ResidualPoint>> Residuals =>
        State<ImmutableList<ResidualPoint>>.Value(this, () => ImmutableList<ResidualPoint>.Empty);

    /// <summary>Chart series derived from residuals, one LineSeries per field.</summary>
    public IState<ImmutableList<ISeries>> ChartSeries =>
        State<ImmutableList<ISeries>>.Value(this, () => ImmutableList<ISeries>.Empty);

    /// <summary>Fields available in residuals for legend checkboxes.</summary>
    public IState<ImmutableList<FieldVisibility>> FieldVisibilities =>
        State<ImmutableList<FieldVisibility>>.Value(this, () => ImmutableList<FieldVisibility>.Empty);

    /// <summary>Whether to auto-scroll the log panel to the bottom.</summary>
    public IState<bool> AutoScroll => State<bool>.Value(this, () => true);

    /// <summary>Status text shown below the job selector.</summary>
    public IState<string> StatusText => State<string>.Value(this, () => "Select a job to view logs.");

    /// <summary>Called when job selection changes in the ComboBox.</summary>
    public async ValueTask OnJobSelected(RunJob? job, CancellationToken ct)
    {
        // Cancel any previous stream
        if (_streamCts is not null)
        {
            await _streamCts.CancelAsync();
            _streamCts.Dispose();
            _streamCts = null;
        }

        // Clear state
        await LogLines.UpdateAsync(_ => ImmutableList<LogLine>.Empty, ct);
        await Residuals.UpdateAsync(_ => ImmutableList<ResidualPoint>.Empty, ct);
        await ChartSeries.UpdateAsync(_ => ImmutableList<ISeries>.Empty, ct);
        await FieldVisibilities.UpdateAsync(_ => ImmutableList<FieldVisibility>.Empty, ct);

        if (job is null)
        {
            await StatusText.UpdateAsync(_ => "Select a job to view logs.", ct);
            return;
        }

        await SelectedJob.UpdateAsync(_ => job, ct);

        if (job.Status == JobStatus.Running || job.Status == JobStatus.Queued)
        {
            await StreamLiveLog(job, ct);
        }
        else
        {
            await LoadCompletedLog(job, ct);
        }
    }

    /// <summary>Toggle visibility of a specific field in the chart.</summary>
    public async ValueTask ToggleFieldVisibility(string fieldName, CancellationToken ct)
    {
        await FieldVisibilities.UpdateAsync(list =>
        {
            if (list is null) return ImmutableList<FieldVisibility>.Empty;
            var idx = list.FindIndex(f => f.Name == fieldName);
            if (idx < 0) return list;
            return list.SetItem(idx, list[idx] with { IsVisible = !list[idx].IsVisible });
        }, ct);

        await RebuildChartSeries(ct);
    }

    private async Task StreamLiveLog(RunJob job, CancellationToken ct)
    {
        _streamCts = new CancellationTokenSource();
        var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, _streamCts.Token);
        var token = linkedCts.Token;

        await StatusText.UpdateAsync(_ => $"Streaming logs for {job.CaseName}...", token);

        try
        {
            var pendingResiduals = new List<ResidualPoint>();
            int lineCount = 0;
            int iteration = 0;
            var seenInStep = new HashSet<string>();

            await foreach (var line in _logStream.StreamAsync(job.Id, token))
            {
                // Add log line (capped)
                await LogLines.UpdateAsync(list =>
                {
                    list ??= ImmutableList<LogLine>.Empty;
                    if (list.Count >= MaxLogLines)
                        list = list.RemoveRange(0, list.Count - MaxLogLines + 1);
                    return list.Add(line);
                }, token);

                // Parse residual from this line
                var match = ResidualRegex.Match(line.Text);
                if (match.Success)
                {
                    var field = match.Groups[1].Value;
                    if (seenInStep.Contains(field))
                    {
                        iteration++;
                        seenInStep.Clear();
                    }
                    seenInStep.Add(field);

                    pendingResiduals.Add(new ResidualPoint(
                        iteration, field,
                        double.Parse(match.Groups[2].Value),
                        double.Parse(match.Groups[3].Value)));
                }

                lineCount++;

                // Batch residual updates
                if (pendingResiduals.Count > 0 && lineCount % ResidualBatchSize == 0)
                {
                    var batch = pendingResiduals.ToList();
                    pendingResiduals.Clear();

                    await Residuals.UpdateAsync(list =>
                    {
                        list ??= ImmutableList<ResidualPoint>.Empty;
                        return list.AddRange(batch);
                    }, token);

                    await UpdateFieldVisibilities(token);
                    await RebuildChartSeries(token);
                }
            }

            // Flush remaining residuals
            if (pendingResiduals.Count > 0)
            {
                var batch = pendingResiduals.ToList();
                await Residuals.UpdateAsync(list =>
                {
                    list ??= ImmutableList<ResidualPoint>.Empty;
                    return list.AddRange(batch);
                }, token);

                await UpdateFieldVisibilities(token);
                await RebuildChartSeries(token);
            }

            await StatusText.UpdateAsync(_ => $"Log stream ended for {job.CaseName}.", token);
        }
        catch (OperationCanceledException)
        {
            // Expected when switching jobs
        }
    }

    private async Task LoadCompletedLog(RunJob job, CancellationToken ct)
    {
        await StatusText.UpdateAsync(_ => $"Loading log for {job.CaseName}...", ct);

        try
        {
            // Fetch log and residuals in parallel
            var logTask = _api.GetJobLogAsync(job.Id, ct);
            var residualsTask = _api.GetJobResidualsAsync(job.Id, ct);
            await Task.WhenAll(logTask, residualsTask);

            var logText = await logTask;
            var residualsDict = await residualsTask;

            // Parse log lines
            var lines = logText.Split('\n')
                .Select(l => new LogLine(l, "stdout", DateTime.UtcNow))
                .ToImmutableList();

            // Cap at MaxLogLines
            if (lines.Count > MaxLogLines)
                lines = lines.GetRange(lines.Count - MaxLogLines, MaxLogLines);

            await LogLines.UpdateAsync(_ => lines, ct);

            // Flatten residuals
            var allResiduals = residualsDict
                .SelectMany(kvp => kvp.Value)
                .OrderBy(r => r.Iteration)
                .ToImmutableList();

            await Residuals.UpdateAsync(_ => allResiduals, ct);
            await UpdateFieldVisibilities(ct);
            await RebuildChartSeries(ct);

            await StatusText.UpdateAsync(_ => $"Loaded {lines.Count} lines for {job.CaseName}.", ct);
        }
        catch (Exception ex)
        {
            await StatusText.UpdateAsync(_ => $"Error loading log: {ex.Message}", ct);
        }
    }

    private async Task UpdateFieldVisibilities(CancellationToken ct)
    {
        var residuals = await Residuals.GetAsync(ct);
        if (residuals is null) return;

        var fieldNames = residuals.Select(r => r.Field).Distinct().ToList();
        var currentVisibilities = await FieldVisibilities.GetAsync(ct)
            ?? ImmutableList<FieldVisibility>.Empty;

        var updated = fieldNames.Select(name =>
        {
            var existing = currentVisibilities.FirstOrDefault(f => f.Name == name);
            return existing ?? new FieldVisibility(name, true);
        }).ToImmutableList();

        await FieldVisibilities.UpdateAsync(_ => updated, ct);
    }

    private async Task RebuildChartSeries(CancellationToken ct)
    {
        var residuals = await Residuals.GetAsync(ct);
        var visibilities = await FieldVisibilities.GetAsync(ct);
        if (residuals is null || visibilities is null)
        {
            await ChartSeries.UpdateAsync(_ => ImmutableList<ISeries>.Empty, ct);
            return;
        }

        var visibleFields = visibilities
            .Where(f => f.IsVisible)
            .Select(f => f.Name)
            .ToHashSet();

        var grouped = residuals
            .Where(r => visibleFields.Contains(r.Field))
            .GroupBy(r => r.Field)
            .ToList();

        int colorIdx = 0;
        var series = grouped.Select(g =>
        {
            var color = Palette[colorIdx % Palette.Length];
            colorIdx++;

            var values = g.Select(r =>
                new ObservablePoint(r.Iteration, r.InitialResidual)).ToList();

            return (ISeries)new LineSeries<ObservablePoint>
            {
                Name = g.Key,
                Values = values,
                GeometrySize = 0,
                LineSmoothness = 0,
                Fill = null,
                Stroke = new LiveChartsCore.SkiaSharpView.Painting.SolidColorPaint(
                    SKColorFromHex(color), 2),
            };
        }).ToImmutableList();

        await ChartSeries.UpdateAsync(_ => series, ct);
    }

    private static SkiaSharp.SKColor SKColorFromHex(string hex)
    {
        hex = hex.TrimStart('#');
        var r = Convert.ToByte(hex[..2], 16);
        var g = Convert.ToByte(hex[2..4], 16);
        var b = Convert.ToByte(hex[4..6], 16);
        return new SkiaSharp.SKColor(r, g, b);
    }
}
