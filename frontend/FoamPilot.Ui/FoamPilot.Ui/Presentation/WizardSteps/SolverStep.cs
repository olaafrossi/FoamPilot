using System.Net.Http;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace FoamPilot.Ui.Presentation.WizardSteps;

/// <summary>
/// Step 3 — Solver Configuration: Edit controlDict, fvSchemes, fvSolution
/// with plain-English explanations of key settings.
/// </summary>
public sealed class SolverStep : WizardStepBase
{
    public override string Title => "Solver";
    public override int Index => 3;

    private FrameworkElement? _editorControl;
    private Func<Task<string>>? _getContent;
    private Func<string, Task>? _setContent;
    private Func<Task>? _showDiff;
    private ComboBox? _fileSelector;
    private TextBlock? _descriptionText;
    private Grid? _editorHost;
    private string? _currentFile;
    private string? _originalContent;
    private bool _editorInitialized;
    private readonly List<string> _solverFiles = [];

    private static readonly string[] DefaultSolverFiles =
        ["system/controlDict", "system/fvSchemes", "system/fvSolution"];

    private static readonly Dictionary<string, string> FileDescriptions = new()
    {
        ["system/controlDict"] = "Simulation control — how long to run and how often to save. 'endTime' sets the number of iterations (e.g., 500 for steady-state). 'writeInterval' controls how often results are saved to disk.",
        ["system/fvSchemes"] = "Numerical schemes — the math behind the simulation. 'divSchemes' control how the flow equations are discretized. The defaults use second-order accurate schemes that work well for most cases.",
        ["system/fvSolution"] = "Solver settings — how the system of equations is solved at each iteration. 'tolerance' controls accuracy, 'relTol' controls how much improvement is needed per iteration.",
    };

    public SolverStep(HttpClient http, AppConfig config) : base(http, config) { }

    public void SetTemplateMetadata(TemplateInfo? template)
    {
        _solverFiles.Clear();
        if (template?.Steps?.TryGetValue("solver", out var step) == true && step.Files?.Count > 0)
            _solverFiles.AddRange(step.Files);
        else
            _solverFiles.AddRange(DefaultSolverFiles);
    }

    public override Panel CreateUI()
    {
        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var header = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
        header.Children.Add(new TextBlock
        {
            Text = "Solver Configuration",
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        });
        header.Children.Add(new TextBlock
        {
            Text = "These settings control how the simulation runs. The defaults are optimized for external aerodynamics — you rarely need to change them.",
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            Margin = new Thickness(0, 4, 0, 0),
        });
        Grid.SetRow(header, 0);
        root.Children.Add(header);

        var selectorRow = new Grid();
        selectorRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        selectorRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _fileSelector = new ComboBox
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Margin = new Thickness(0, 0, 8, 0),
        };
        _fileSelector.SelectionChanged += async (_, _) => await LoadSelectedFile();
        Grid.SetColumn(_fileSelector, 0);
        selectorRow.Children.Add(_fileSelector);

        var diffButton = new Button { Content = "Show Diff", FontSize = 12 };
        diffButton.Click += async (_, _) =>
        {
            if (_showDiff is not null) await _showDiff();
        };
        Grid.SetColumn(diffButton, 1);
        selectorRow.Children.Add(diffButton);

        Grid.SetRow(selectorRow, 1);
        root.Children.Add(selectorRow);

        _descriptionText = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.DodgerBlue),
            FontSize = 12,
            Margin = new Thickness(0, 0, 0, 8),
            Padding = new Thickness(8),
        };
        Grid.SetRow(_descriptionText, 2);
        root.Children.Add(_descriptionText);

        _editorHost = new Grid();
        _editorHost.Children.Add(new TextBlock
        {
            Text = "Loading editor...",
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        });
        Grid.SetRow(_editorHost, 3);
        root.Children.Add(_editorHost);

        return root;
    }

    public override async Task OnEnterAsync()
    {
        if (!_editorInitialized && _editorHost is not null)
        {
            _editorInitialized = true;
            var (control, get, set, diff) = await CreateMonacoEditorAsync();
            _editorControl = control;
            _getContent = get;
            _setContent = set;
            _showDiff = diff;
            _editorHost.Children.Clear();
            _editorHost.Children.Add(control);
        }

        if (_fileSelector is null) return;
        _fileSelector.Items.Clear();
        foreach (var f in _solverFiles)
            _fileSelector.Items.Add(f);
        if (_fileSelector.Items.Count > 0)
            _fileSelector.SelectedIndex = 0;
    }

    public override async Task OnLeaveAsync() => await SaveCurrentFile();

    private async Task LoadSelectedFile()
    {
        if (_fileSelector?.SelectedItem is not string filePath) return;
        await SaveCurrentFile();

        var content = await LoadFileAsync(filePath);
        if (_setContent is not null)
            await _setContent(content ?? $"// Could not load {filePath}");
        _originalContent = content;
        _currentFile = content is not null ? filePath : null;

        if (_descriptionText is not null)
        {
            _descriptionText.Text = FileDescriptions.GetValueOrDefault(filePath, "");
            _descriptionText.Visibility = string.IsNullOrEmpty(_descriptionText.Text)
                ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    private async Task SaveCurrentFile()
    {
        if (_currentFile is null || _getContent is null || _originalContent is null) return;
        try
        {
            var current = await _getContent();
            if (current != _originalContent)
            {
                await SaveFileAsync(_currentFile, current);
                _originalContent = current;
            }
        }
        catch { }
    }
}
