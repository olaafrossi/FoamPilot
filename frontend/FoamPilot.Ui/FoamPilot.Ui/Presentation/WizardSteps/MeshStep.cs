using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace FoamPilot.Ui.Presentation.WizardSteps;

/// <summary>
/// Step 1 — Mesh: Edit mesh dicts, run surfaceFeatureExtract → blockMesh →
/// snappyHexMesh, show checkMesh quality, show 3D preview.
/// </summary>
public sealed class MeshStep : WizardStepBase
{
    public override string Title => "Mesh";
    public override int Index => 1;
    public override bool HasExecution => true;

    private TextBox? _editor;
    private ComboBox? _fileSelector;
    private TextBlock? _qualityText;
    private TextBlock? _logOutput;
    private ScrollViewer? _logScroll;
    private WebView2? _meshPreview;
    private Border? _previewContainer;
    private StackPanel? _qualityPanel;
    private string? _currentFile;
    private string? _originalContent;
    private readonly List<string> _meshFiles = [];
    private readonly string[] _defaultMeshFiles = ["system/blockMeshDict", "system/snappyHexMeshDict", "system/surfaceFeatureExtractDict"];
    private readonly string[] _defaultMeshCommands = ["surfaceFeatureExtract", "blockMesh", "snappyHexMesh -overwrite"];

    private string[]? _meshCommands;
    private int _cores = 1;

    public MeshStep(HttpClient http, AppConfig config) : base(http, config) { }

    /// <summary>Set the number of cores for parallel meshing.</summary>
    public void SetCores(int cores) => _cores = Math.Max(1, cores);

    public void SetTemplateMetadata(TemplateInfo? template)
    {
        _meshFiles.Clear();
        if (template?.Steps?.TryGetValue("mesh", out var step) == true && step.Files?.Count > 0)
        {
            _meshFiles.AddRange(step.Files);
            _meshCommands = step.Commands?.ToArray();
        }
        else
        {
            _meshFiles.AddRange(_defaultMeshFiles);
            _meshCommands = null;
        }
    }

    public override Panel CreateUI()
    {
        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // header
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // file selector
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // editor + preview
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // quality
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(200) }); // log

        // Header
        var header = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
        header.Children.Add(new TextBlock
        {
            Text = "Mesh Generation",
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        });
        header.Children.Add(new TextBlock
        {
            Text = "Review the mesh settings below, then click 'Generate Mesh' to create the computational grid. This typically takes 1-5 minutes.",
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            Margin = new Thickness(0, 4, 0, 0),
        });
        Grid.SetRow(header, 0);
        root.Children.Add(header);

        // File selector
        _fileSelector = new ComboBox
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Margin = new Thickness(0, 0, 0, 8),
        };
        _fileSelector.SelectionChanged += async (_, _) => await LoadSelectedFile();
        Grid.SetRow(_fileSelector, 1);
        root.Children.Add(_fileSelector);

        // Editor + preview side by side
        var editorPreview = new Grid();
        editorPreview.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        editorPreview.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(editorPreview, 2);
        root.Children.Add(editorPreview);

        _editor = new TextBox
        {
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            FontFamily = new FontFamily("Cascadia Code, Consolas, monospace"),
            FontSize = 12,
            IsSpellCheckEnabled = false,
            Margin = new Thickness(0, 0, 4, 0),
        };
        var editorScroll = new ScrollViewer
        {
            Content = _editor,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        };
        Grid.SetColumn(editorScroll, 0);
        editorPreview.Children.Add(editorScroll);

        // 3D preview placeholder (WebView2 loaded on demand)
        _previewContainer = new Border
        {
            Background = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 26, 26, 46)),
            CornerRadius = new CornerRadius(4),
            Margin = new Thickness(4, 0, 0, 0),
        };
        _previewContainer.Child = new TextBlock
        {
            Text = "3D preview will appear here after meshing",
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(_previewContainer, 1);
        editorPreview.Children.Add(_previewContainer);

        // Quality summary
        _qualityPanel = new StackPanel { Margin = new Thickness(0, 8, 0, 8), Visibility = Visibility.Collapsed };
        _qualityText = new TextBlock
        {
            FontFamily = new FontFamily("Cascadia Code, Consolas, monospace"),
            FontSize = 12,
        };
        _qualityPanel.Children.Add(_qualityText);
        Grid.SetRow(_qualityPanel, 3);
        root.Children.Add(_qualityPanel);

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
        Grid.SetRow(_logScroll, 4);
        root.Children.Add(_logScroll);

        return root;
    }

    public override async Task OnEnterAsync()
    {
        if (_fileSelector is null) return;
        _fileSelector.Items.Clear();
        var files = _meshFiles.Count > 0 ? _meshFiles : _defaultMeshFiles.ToList();
        foreach (var f in files)
            _fileSelector.Items.Add(f);
        if (_fileSelector.Items.Count > 0)
            _fileSelector.SelectedIndex = 0;
    }

    public override async Task OnLeaveAsync()
    {
        await SaveCurrentFile();
    }

    private async Task LoadSelectedFile()
    {
        if (_fileSelector?.SelectedItem is not string filePath || _editor is null) return;

        // Save previous file first
        await SaveCurrentFile();

        var content = await LoadFileAsync(filePath);
        if (content is not null)
        {
            _editor.Text = content;
            _originalContent = content;
            _currentFile = filePath;
        }
        else
        {
            _editor.Text = $"// Could not load {filePath}";
            _currentFile = null;
        }
    }

    private async Task SaveCurrentFile()
    {
        if (_currentFile is null || _editor is null || _originalContent is null) return;
        var current = _editor.Text;
        if (current != _originalContent)
        {
            await SaveFileAsync(_currentFile, current);
            _originalContent = current;
        }
    }

    public override async Task<bool> ExecuteAsync(Action<string> log, Action<string> setStatus, CancellationToken ct)
    {
        /*
         * Mesh pipeline (serial vs parallel):
         *
         * Serial (1 core):
         *   surfaceFeatureExtract → blockMesh → snappyHexMesh -overwrite
         *
         * Parallel (N cores):
         *   surfaceFeatureExtract → blockMesh → decomposePar →
         *   mpirun -np N snappyHexMesh -overwrite -parallel →
         *   reconstructParMesh -constant
         */

        // Save any pending edits
        await SaveCurrentFile();

        bool useParallel = _cores > 1;

        if (useParallel)
            log($"Running parallel mesh pipeline ({_cores} cores)...");
        else
            log("Running serial mesh pipeline...");

        // Phase 1: surfaceFeatureExtract (always serial)
        var (ok1, _) = await RunCommandAsync("surfaceFeatureExtract", log, setStatus, ct);
        if (!ok1) { setStatus("surfaceFeatureExtract failed."); return false; }

        // Phase 2: blockMesh (always serial — creates the background hex mesh)
        var (ok2, _) = await RunCommandAsync("blockMesh", log, setStatus, ct);
        if (!ok2) { setStatus("blockMesh failed."); return false; }

        // Phase 3: snappyHexMesh — serial or parallel
        if (useParallel)
        {
            // Write decomposeParDict for our core count
            setStatus($"Writing decomposeParDict for {_cores} cores...");
            var decomposeDict =
                "FoamFile\n{\n    version     2.0;\n    format      ascii;\n" +
                "    class       dictionary;\n    object      decomposeParDict;\n}\n\n" +
                $"numberOfSubdomains  {_cores};\n\nmethod          scotch;\n";
            await SaveFileAsync("system/decomposeParDict", decomposeDict);

            // Decompose for parallel
            var (okDecomp, _) = await RunCommandAsync("decomposePar", log, setStatus, ct);
            if (!okDecomp) { setStatus("decomposePar failed."); return false; }

            // Parallel snappyHexMesh
            var (okSnappy, _) = await RunCommandAsync(
                $"mpirun -np {_cores} snappyHexMesh -overwrite -parallel", log, setStatus, ct);
            if (!okSnappy) { setStatus("snappyHexMesh (parallel) failed."); return false; }

            // Reconstruct mesh
            var (okRecon, _) = await RunCommandAsync("reconstructParMesh -constant", log, setStatus, ct);
            if (!okRecon) { setStatus("reconstructParMesh failed."); return false; }
        }
        else
        {
            // Serial snappyHexMesh
            var (okSnappy, _) = await RunCommandAsync("snappyHexMesh -overwrite", log, setStatus, ct);
            if (!okSnappy) { setStatus("snappyHexMesh failed."); return false; }
        }

        // Phase 4: checkMesh
        setStatus("Checking mesh quality...");
        var (checkOk, checkJobId) = await RunCommandAsync("checkMesh", log, setStatus, ct);

        if (checkOk && !string.IsNullOrEmpty(checkJobId))
        {
            await ShowMeshQuality(checkJobId, log);
        }

        // Phase 5: 3D preview
        await Load3DPreview();

        IsComplete = true;
        setStatus($"✓ Mesh generation complete{(useParallel ? $" ({_cores} cores)" : "")}.");
        return true;
    }

    private async Task ShowMeshQuality(string jobId, Action<string> log)
    {
        if (_qualityText is null || _qualityPanel is null) return;

        try
        {
            var resp = await Http.GetAsync($"/cases/{CaseName}/mesh-quality");
            if (resp.IsSuccessStatusCode)
            {
                var json = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                var cells = root.TryGetProperty("cells", out var c) ? c.GetInt32() : 0;
                var maxNonOrtho = root.TryGetProperty("max_non_orthogonality", out var no) ? no.GetDouble() : 0;
                var maxSkew = root.TryGetProperty("max_skewness", out var sk) ? sk.GetDouble() : 0;
                var ok = root.TryGetProperty("ok", out var o) && o.GetBoolean();

                var status = ok ? "✅ GOOD" : "⚠️ CHECK QUALITY";
                _qualityText.Text = $"Cells: {cells:N0}  |  Max non-orthogonality: {maxNonOrtho:F1}°  |  Max skewness: {maxSkew:F2}  |  Quality: {status}";
                _qualityText.Foreground = new SolidColorBrush(ok ? Microsoft.UI.Colors.LimeGreen : Microsoft.UI.Colors.Orange);
                _qualityPanel.Visibility = Visibility.Visible;
            }
        }
        catch (Exception ex)
        {
            log($"Could not fetch mesh quality: {ex.Message}");
        }
    }

    private async Task Load3DPreview()
    {
        if (_previewContainer is null || CaseName is null) return;

        try
        {
            // Find the geometry file in constant/triSurface/
            var casePath = System.IO.Path.Combine(Config.LocalCasesPath, CaseName, "constant", "triSurface");
            if (!System.IO.Directory.Exists(casePath)) return;

            var stlFile = System.IO.Directory.GetFiles(casePath, "*.stl").FirstOrDefault()
                       ?? System.IO.Directory.GetFiles(casePath, "*.obj").FirstOrDefault();
            if (stlFile is null) return;

            var webView = new WebView2
            {
                DefaultBackgroundColor = Microsoft.UI.ColorHelper.FromArgb(255, 26, 26, 46),
            };

            await webView.EnsureCoreWebView2Async();

            // Navigate to viewer with file param
            var viewerPath = System.IO.Path.Combine(
                AppDomain.CurrentDomain.BaseDirectory, "Assets", "WebViewer", "mesh-viewer.html");

            if (System.IO.File.Exists(viewerPath))
            {
                var fileUri = new Uri(stlFile).AbsoluteUri;
                webView.Source = new Uri($"file:///{viewerPath}?file={Uri.EscapeDataString(fileUri)}");
                _previewContainer.Child = webView;
                _meshPreview = webView;
            }
        }
        catch
        {
            // WebView2 not available — show fallback
            _previewContainer.Child = new TextBlock
            {
                Text = "3D preview unavailable.\nInstall WebView2 Runtime for 3D mesh viewing.\nMesh generated successfully — continue to next step.",
                Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
                TextWrapping = TextWrapping.Wrap,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                TextAlignment = TextAlignment.Center,
            };
        }
    }
}
