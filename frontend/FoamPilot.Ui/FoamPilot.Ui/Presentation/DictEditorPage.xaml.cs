using System.Net.Http;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.UI.Xaml.Controls;

namespace FoamPilot.Ui.Presentation;

public sealed partial class DictEditorPage : Page
{
    private readonly HttpClient _http;
    private string? _currentCase;
    private string? _currentFilePath;
    private string? _originalContent;

    public DictEditorPage()
    {
        this.InitializeComponent();

        var config = App.Services?.GetService<IOptions<AppConfig>>()?.Value ?? new AppConfig();
        _http = new HttpClient { BaseAddress = new Uri(config.BackendUrl) };

        this.Loaded += async (_, _) => await LoadCases();
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

    private async void CaseCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _currentCase = CaseCombo.SelectedItem as string;
        if (string.IsNullOrEmpty(_currentCase)) return;
        await LoadFileTree();
    }

    private async Task LoadFileTree()
    {
        FileTree.RootNodes.Clear();
        if (string.IsNullOrEmpty(_currentCase)) return;

        try
        {
            var resp = await _http.GetAsync($"/cases/{_currentCase}/files");
            if (!resp.IsSuccessStatusCode) return;
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            BuildTree(doc.RootElement, FileTree.RootNodes);
        }
        catch { }
    }

    private void BuildTree(JsonElement node, IList<TreeViewNode> nodes)
    {
        if (node.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in node.EnumerateArray())
                BuildTree(child, nodes);
            return;
        }

        var name = node.GetProperty("name").GetString() ?? "";
        var type = node.GetProperty("type").GetString() ?? "file";
        var path = node.TryGetProperty("path", out var p) ? p.GetString() ?? name : name;

        var treeNode = new TreeViewNode
        {
            Content = name,
            IsExpanded = type == "directory",
        };
        // Store path in Tag-like fashion via a wrapper
        treeNode.Content = new FileTreeItem { Name = name, Path = path, IsDir = type == "directory" };

        if (type == "directory" && node.TryGetProperty("children", out var children))
        {
            foreach (var child in children.EnumerateArray())
                BuildTree(child, treeNode.Children);
        }

        nodes.Add(treeNode);
    }

    private async void FileTree_ItemInvoked(TreeView sender, TreeViewItemInvokedEventArgs args)
    {
        if (args.InvokedItem is not TreeViewNode node) return;
        if (node.Content is not FileTreeItem item || item.IsDir) return;

        await LoadFile(item.Path);
    }

    private async Task LoadFile(string filePath)
    {
        if (string.IsNullOrEmpty(_currentCase)) return;

        try
        {
            var encodedPath = Uri.EscapeDataString(filePath);
            var resp = await _http.GetAsync($"/cases/{_currentCase}/file?path={encodedPath}");
            if (!resp.IsSuccessStatusCode)
            {
                EditorStatus.Text = $"Failed to load: {resp.StatusCode}";
                return;
            }

            var content = await resp.Content.ReadAsStringAsync();
            _currentFilePath = filePath;
            _originalContent = content;
            Editor.Text = content;
            FilePathText.Text = filePath;
            EditorStatus.Text = "";
        }
        catch (Exception ex) { EditorStatus.Text = $"Error: {ex.Message}"; }
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(_currentCase) || string.IsNullOrEmpty(_currentFilePath)) return;

        try
        {
            var encodedPath = Uri.EscapeDataString(_currentFilePath);
            // Normalize \r (WinUI TextBox) to \n for OpenFOAM
            var normalized = Editor.Text.Replace("\r\n", "\n").Replace("\r", "\n");
            var content = new StringContent(normalized, Encoding.UTF8, "text/plain");
            var resp = await _http.PutAsync($"/cases/{_currentCase}/file?path={encodedPath}", content);
            if (resp.IsSuccessStatusCode)
            {
                _originalContent = Editor.Text;
                EditorStatus.Text = "Saved.";
            }
            else
            {
                EditorStatus.Text = $"Save failed: {resp.StatusCode}";
            }
        }
        catch (Exception ex) { EditorStatus.Text = $"Error: {ex.Message}"; }
    }

    private void Revert_Click(object sender, RoutedEventArgs e)
    {
        if (_originalContent is not null)
        {
            Editor.Text = _originalContent;
            EditorStatus.Text = "Reverted.";
        }
    }

    private class FileTreeItem
    {
        public string Name { get; init; } = "";
        public string Path { get; init; } = "";
        public bool IsDir { get; init; }
        public override string ToString() => Name;
    }
}
