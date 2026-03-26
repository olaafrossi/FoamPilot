using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace FoamPilot.Ui.Presentation;

public sealed partial class CaseBrowserPage : Page
{
    private readonly HttpClient _http;
    private readonly string _localCasesPath;

    public CaseBrowserPage()
    {
        this.InitializeComponent();

        var config = App.Services?.GetService<IOptions<AppConfig>>()?.Value ?? new AppConfig();
        _http = new HttpClient { BaseAddress = new Uri(config.BackendUrl) };
        _localCasesPath = config.LocalCasesPath;

        this.Loaded += async (_, _) =>
        {
            await LoadTemplates();
            await LoadCases();
        };
    }

    private async Task LoadTemplates()
    {
        try
        {
            var resp = await _http.GetAsync("/cases/templates");
            if (!resp.IsSuccessStatusCode) return;
            var templates = await resp.Content.ReadFromJsonAsync<List<string>>();
            TemplateCombo.ItemsSource = templates;
            if (templates?.Count > 0)
                TemplateCombo.SelectedIndex = 0;
        }
        catch { }
    }

    private async Task LoadCases()
    {
        try
        {
            var resp = await _http.GetAsync("/cases");
            if (!resp.IsSuccessStatusCode) return;

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var cases = doc.RootElement.EnumerateArray().Select(c => new CaseRow
            {
                Name = c.GetProperty("name").GetString() ?? "",
                Modified = c.TryGetProperty("modified", out var m) && m.ValueKind != JsonValueKind.Null
                    ? DateTimeOffset.Parse(m.GetString()!).LocalDateTime.ToString("g")
                    : "",
            }).ToList();

            CasesList.ItemsSource = cases;
            NoCasesText.Visibility = cases.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Error: {ex.Message}";
        }
    }

    private async void CreateCase_Click(object sender, RoutedEventArgs e)
    {
        var template = TemplateCombo.SelectedItem as string;
        var name = NewCaseNameBox.Text.Trim();
        if (string.IsNullOrEmpty(template) || string.IsNullOrEmpty(name))
        {
            StatusText.Text = "Select a template and enter a name.";
            return;
        }

        StatusText.Text = "Creating...";
        try
        {
            var resp = await _http.PostAsJsonAsync("/cases", new { template, name });
            var body = await resp.Content.ReadAsStringAsync();
            if (resp.IsSuccessStatusCode)
            {
                StatusText.Text = $"Created '{name}'.";
                NewCaseNameBox.Text = "";
                await LoadCases();
            }
            else
            {
                StatusText.Text = body.Contains("already exists") ? $"'{name}' already exists." : $"Failed: {body}";
            }
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Error: {ex.Message}";
        }
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "";
        await LoadCases();
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string caseName)
        {
            var path = Path.Combine(_localCasesPath, caseName);
            if (Directory.Exists(path))
            {
                Process.Start(new ProcessStartInfo { FileName = "explorer.exe", Arguments = $"\"{path}\"", UseShellExecute = true });
            }
            else
            {
                StatusText.Text = $"Local folder not found: {path}";
            }
        }
    }

    private async void DeleteCase_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string caseName)
        {
            StatusText.Text = $"Deleting '{caseName}'...";
            try
            {
                var resp = await _http.DeleteAsync($"/cases/{caseName}");
                StatusText.Text = resp.IsSuccessStatusCode ? $"Deleted '{caseName}'." : $"Failed to delete.";
                await LoadCases();
            }
            catch (Exception ex)
            {
                StatusText.Text = $"Error: {ex.Message}";
            }
        }
    }

    private class CaseRow
    {
        public string Name { get; init; } = "";
        public string Modified { get; init; } = "";
    }
}
