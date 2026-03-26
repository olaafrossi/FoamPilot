using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;

namespace FoamPilot.Ui.Presentation.WizardSteps;

/// <summary>
/// Step 0 — Geometry: Upload custom STL or pick a template.
/// Two paths: drag-drop/file-pick STL → backend auto-config,
///            or select template → backend case creation.
/// </summary>
public sealed class GeometryStep : WizardStepBase
{
    public override string Title => "Geometry";
    public override int Index => 0;
    public override bool HasExecution => false;

    private TextBlock? _statusText;
    private StackPanel? _templateList;
    private Border? _dropZone;
    private TextBlock? _dropLabel;
    private string? _selectedTemplate;
    private string? _uploadedStlPath;

    /// <summary>Raised when a case is created (template or STL upload).</summary>
    public event Action<string>? CaseCreated;

    /// <summary>Raised when a template is selected (carries TemplateInfo).</summary>
    public event Action<TemplateInfo>? TemplateSelected;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public GeometryStep(HttpClient http, AppConfig config) : base(http, config) { }

    public override Panel CreateUI()
    {
        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        // Header
        var header = new TextBlock
        {
            Text = "Choose your geometry",
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 16),
        };
        Grid.SetRow(header, 0);
        root.Children.Add(header);

        // Content: two-column layout
        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(content, 1);
        root.Children.Add(content);

        // Left: STL Upload (drag-drop zone)
        var uploadPanel = new StackPanel { Margin = new Thickness(0, 0, 8, 0) };

        var uploadTitle = new TextBlock
        {
            Text = "Upload Your Geometry",
            FontSize = 16,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 8),
        };
        uploadPanel.Children.Add(uploadTitle);

        var uploadDesc = new TextBlock
        {
            Text = "Drag and drop an STL or OBJ file, or click to browse. We'll automatically generate mesh settings based on your geometry's size.",
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            Margin = new Thickness(0, 0, 0, 12),
        };
        uploadPanel.Children.Add(uploadDesc);

        _dropZone = new Border
        {
            BorderBrush = new SolidColorBrush(Microsoft.UI.Colors.DimGray),
            BorderThickness = new Thickness(2),
            CornerRadius = new CornerRadius(8),
            MinHeight = 150,
            Padding = new Thickness(24),
            AllowDrop = true,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        };
        _dropZone.DragOver += DropZone_DragOver;
        _dropZone.Drop += DropZone_Drop;
        _dropZone.PointerPressed += async (_, _) => await BrowseForFile();

        var dropContent = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _dropLabel = new TextBlock
        {
            Text = "Drop STL/OBJ file here\nor click to browse",
            TextAlignment = TextAlignment.Center,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            FontSize = 14,
        };
        dropContent.Children.Add(_dropLabel);
        _dropZone.Child = dropContent;
        uploadPanel.Children.Add(_dropZone);

        _statusText = new TextBlock
        {
            Margin = new Thickness(0, 8, 0, 0),
            TextWrapping = TextWrapping.Wrap,
        };
        uploadPanel.Children.Add(_statusText);

        Grid.SetColumn(uploadPanel, 0);
        content.Children.Add(uploadPanel);

        // Right: Template picker
        var templatePanel = new StackPanel { Margin = new Thickness(8, 0, 0, 0) };

        var templateTitle = new TextBlock
        {
            Text = "Or Start from a Template",
            FontSize = 16,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 8),
        };
        templatePanel.Children.Add(templateTitle);

        var templateDesc = new TextBlock
        {
            Text = "Pre-configured simulations with geometry included. Great for learning.",
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            Margin = new Thickness(0, 0, 0, 12),
        };
        templatePanel.Children.Add(templateDesc);

        _templateList = new StackPanel { Spacing = 8 };
        templatePanel.Children.Add(_templateList);

        Grid.SetColumn(templatePanel, 1);
        content.Children.Add(templatePanel);

        return root;
    }

    public override async Task OnEnterAsync()
    {
        await LoadTemplatesAsync();
    }

    private async Task LoadTemplatesAsync()
    {
        if (_templateList is null) return;
        _templateList.Children.Clear();

        try
        {
            var resp = await Http.GetAsync("/templates");
            if (!resp.IsSuccessStatusCode) return;
            var templates = await resp.Content.ReadFromJsonAsync<List<TemplateInfo>>(JsonOpts);
            if (templates is null) return;

            foreach (var t in templates)
            {
                var card = new Button
                {
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    Padding = new Thickness(12),
                    Tag = t,
                };

                var cardContent = new StackPanel();
                var name = new TextBlock
                {
                    Text = t.Name ?? t.Path ?? "Unknown",
                    FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                };
                cardContent.Children.Add(name);

                if (!string.IsNullOrEmpty(t.Description))
                {
                    cardContent.Children.Add(new TextBlock
                    {
                        Text = t.Description,
                        Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
                        FontSize = 12,
                        TextWrapping = TextWrapping.Wrap,
                    });
                }

                var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Margin = new Thickness(0, 4, 0, 0) };
                if (!string.IsNullOrEmpty(t.Solver))
                    meta.Children.Add(new TextBlock { Text = $"Solver: {t.Solver}", FontSize = 11, Foreground = new SolidColorBrush(Microsoft.UI.Colors.DodgerBlue) });
                if (!string.IsNullOrEmpty(t.EstimatedRuntime))
                    meta.Children.Add(new TextBlock { Text = $"~{t.EstimatedRuntime}", FontSize = 11, Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray) });
                if (!string.IsNullOrEmpty(t.Difficulty))
                    meta.Children.Add(new TextBlock { Text = t.Difficulty, FontSize = 11, Foreground = new SolidColorBrush(Microsoft.UI.Colors.Orange) });
                cardContent.Children.Add(meta);

                card.Content = cardContent;
                card.Click += async (s, _) => await SelectTemplate((TemplateInfo)((Button)s!).Tag);
                _templateList.Children.Add(card);
            }
        }
        catch (Exception ex)
        {
            _templateList.Children.Add(new TextBlock
            {
                Text = $"Failed to load templates: {ex.Message}",
                Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed),
            });
        }
    }

    private async Task SelectTemplate(TemplateInfo template)
    {
        if (_statusText is null) return;
        _selectedTemplate = template.Path;
        _statusText.Text = $"Creating case from template: {template.Name ?? template.Path}...";

        var caseName = (template.Path ?? "case").Replace("/", "_").Replace("\\", "_");

        try
        {
            // Delete if exists
            await Http.DeleteAsync($"/cases/{caseName}");
            // Create from template
            var resp = await Http.PostAsJsonAsync("/cases", new { template = template.Path, name = caseName });
            if (resp.IsSuccessStatusCode)
            {
                CaseName = caseName;
                IsComplete = true;
                _statusText.Text = $"✓ Case '{caseName}' created from template.";
                _statusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.LimeGreen);
                CaseCreated?.Invoke(caseName);
                TemplateSelected?.Invoke(template);
            }
            else
            {
                var err = await resp.Content.ReadAsStringAsync();
                _statusText.Text = $"Failed: {err}";
                _statusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed);
            }
        }
        catch (Exception ex)
        {
            _statusText.Text = $"Error: {ex.Message}";
            _statusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed);
        }
    }

    private void DropZone_DragOver(object sender, DragEventArgs e)
    {
        if (e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            e.AcceptedOperation = DataPackageOperation.Copy;
            if (_dropLabel is not null)
                _dropLabel.Text = "Drop to upload";
            if (_dropZone is not null)
                _dropZone.BorderBrush = new SolidColorBrush(Microsoft.UI.Colors.DodgerBlue);
        }
    }

    private async void DropZone_Drop(object sender, DragEventArgs e)
    {
        if (_dropZone is not null)
            _dropZone.BorderBrush = new SolidColorBrush(Microsoft.UI.Colors.DimGray);
        if (_dropLabel is not null)
            _dropLabel.Text = "Drop STL/OBJ file here\nor click to browse";

        if (!e.DataView.Contains(StandardDataFormats.StorageItems)) return;
        var items = await e.DataView.GetStorageItemsAsync();
        if (items.Count == 0) return;

        var file = items[0] as StorageFile;
        if (file is null) return;

        var ext = System.IO.Path.GetExtension(file.Name).ToLowerInvariant();
        if (ext is not ".stl" and not ".obj")
        {
            if (_statusText is not null)
            {
                _statusText.Text = "Only .stl and .obj files are supported.";
                _statusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed);
            }
            return;
        }

        await UploadFile(file.Path, file.Name);
    }

    private async Task BrowseForFile()
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        picker.FileTypeFilter.Add(".stl");
        picker.FileTypeFilter.Add(".obj");
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.Desktop;

        // Initialize with window handle for WinUI3
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(((App)App.Current).MainWindow);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);

        var file = await picker.PickSingleFileAsync();
        if (file is not null)
            await UploadFile(file.Path, file.Name);
    }

    private async Task UploadFile(string filePath, string fileName)
    {
        if (_statusText is null) return;
        _statusText.Text = $"Uploading {fileName}...";
        _statusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.White);

        var caseName = System.IO.Path.GetFileNameWithoutExtension(fileName)
            .Replace(" ", "_").Replace(".", "_");

        try
        {
            // Upload via multipart to backend
            using var form = new MultipartFormDataContent();
            var fileBytes = await System.IO.File.ReadAllBytesAsync(filePath);
            form.Add(new ByteArrayContent(fileBytes), "file", fileName);

            // Delete existing case if any
            await Http.DeleteAsync($"/cases/{caseName}");

            var resp = await Http.PostAsync($"/cases/{caseName}/upload-geometry", form);
            if (resp.IsSuccessStatusCode)
            {
                var json = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                var tris = doc.RootElement.TryGetProperty("triangles", out var t) ? t.GetInt32() : 0;

                CaseName = caseName;
                _uploadedStlPath = filePath;
                IsComplete = true;
                _statusText.Text = $"✓ Uploaded {fileName} ({tris:N0} triangles). Mesh configs auto-generated.";
                _statusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.LimeGreen);

                if (_dropLabel is not null)
                    _dropLabel.Text = $"✓ {fileName}";

                CaseCreated?.Invoke(caseName);
            }
            else
            {
                var err = await resp.Content.ReadAsStringAsync();
                _statusText.Text = $"Upload failed: {err}";
                _statusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed);
            }
        }
        catch (Exception ex)
        {
            _statusText.Text = $"Error: {ex.Message}";
            _statusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed);
        }
    }

    public override string? Validate()
    {
        if (CaseName is null)
            return "Please select a template or upload a geometry file.";
        return null;
    }
}

// DTO for template metadata from /templates endpoint
public record TemplateInfo
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("path")] public string? Path { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("solver")] public string? Solver { get; init; }
    [JsonPropertyName("difficulty")] public string? Difficulty { get; init; }
    [JsonPropertyName("estimated_runtime")] public string? EstimatedRuntime { get; init; }
    [JsonPropertyName("steps")] public Dictionary<string, TemplateStepInfo>? Steps { get; init; }
}

public record TemplateStepInfo
{
    [JsonPropertyName("commands")] public List<string>? Commands { get; init; }
    [JsonPropertyName("files")] public List<string>? Files { get; init; }
}
