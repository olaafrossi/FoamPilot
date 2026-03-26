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

    private TextBox? _editor;
    private ComboBox? _fileSelector;
    private TextBlock? _descriptionText;
    private string? _currentFile;
    private string? _originalContent;
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

        _fileSelector = new ComboBox
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Margin = new Thickness(0, 0, 0, 4),
        };
        _fileSelector.SelectionChanged += async (_, _) => await LoadSelectedFile();
        Grid.SetRow(_fileSelector, 1);
        root.Children.Add(_fileSelector);

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

        _editor = new TextBox
        {
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            FontFamily = new FontFamily("Cascadia Code, Consolas, monospace"),
            FontSize = 12,
            IsSpellCheckEnabled = false,
        };
        var scroll = new ScrollViewer
        {
            Content = _editor,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        };
        Grid.SetRow(scroll, 3);
        root.Children.Add(scroll);

        return root;
    }

    public override async Task OnEnterAsync()
    {
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
        if (_fileSelector?.SelectedItem is not string filePath || _editor is null) return;
        await SaveCurrentFile();

        var content = await LoadFileAsync(filePath);
        _editor.Text = content ?? $"// Could not load {filePath}";
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
        if (_currentFile is null || _editor is null || _originalContent is null) return;
        if (_editor.Text != _originalContent)
        {
            await SaveFileAsync(_currentFile, _editor.Text);
            _originalContent = _editor.Text;
        }
    }
}
