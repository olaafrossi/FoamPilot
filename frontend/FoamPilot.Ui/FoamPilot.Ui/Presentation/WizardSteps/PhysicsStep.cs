using System.Net.Http;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace FoamPilot.Ui.Presentation.WizardSteps;

/// <summary>
/// Step 2 — Physics: Edit boundary condition files (U, p, k, omega, nut)
/// with plain-English descriptions for hobbyists.
/// </summary>
public sealed class PhysicsStep : WizardStepBase
{
    public override string Title => "Physics";
    public override int Index => 2;

    private TextBox? _editor;
    private ComboBox? _fileSelector;
    private TextBlock? _descriptionText;
    private string? _currentFile;
    private string? _originalContent;
    private readonly List<string> _physicsFiles = [];

    private static readonly string[] DefaultPhysicsFiles = ["0/U", "0/p", "0/k", "0/omega", "0/nut"];

    private static readonly Dictionary<string, string> FileDescriptions = new()
    {
        ["0/U"] = "Velocity — how fast the air moves and in what direction. Default: 20 m/s in the X direction (left to right). The 'inlet' is where air enters, the 'outlet' is where it leaves.",
        ["0/p"] = "Pressure — the pressure field around your geometry. Default: zero at the outlet, calculated everywhere else. You usually don't need to change this.",
        ["0/k"] = "Turbulent kinetic energy — how 'energetic' the turbulence is. Higher values = more turbulent flow. Auto-calculated from the inlet velocity.",
        ["0/omega"] = "Specific dissipation rate — how quickly turbulence dissipates. Works together with k to model turbulent flow. Auto-calculated.",
        ["0/nut"] = "Turbulent viscosity — the effective viscosity from turbulence. Usually starts at zero and is calculated by the solver.",
    };

    public PhysicsStep(HttpClient http, AppConfig config) : base(http, config) { }

    public void SetTemplateMetadata(TemplateInfo? template)
    {
        _physicsFiles.Clear();
        if (template?.Steps?.TryGetValue("boundaries", out var step) == true && step.Files?.Count > 0)
            _physicsFiles.AddRange(step.Files);
        else
            _physicsFiles.AddRange(DefaultPhysicsFiles);
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
            Text = "Physics & Boundary Conditions",
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        });
        header.Children.Add(new TextBlock
        {
            Text = "These files define how the air behaves at the edges of your simulation domain. The defaults work well for most external aerodynamics — only change them if you know what you're doing.",
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
        foreach (var f in _physicsFiles)
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
