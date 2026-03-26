using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace FoamPilot.Ui.Presentation;

public sealed partial class MySimulationsPage : Page
{
    private readonly HttpClient _http;
    private readonly AppConfig _config;

    public MySimulationsPage()
    {
        this.InitializeComponent();
        _config = App.Services?.GetService<IOptions<AppConfig>>()?.Value ?? new AppConfig();
        _http = new HttpClient { BaseAddress = new Uri(_config.BackendUrl) };
        this.Loaded += async (_, _) => await LoadCases();
    }

    private async Task LoadCases()
    {
        try
        {
            var cases = await _http.GetFromJsonAsync<List<CaseItem>>("/cases");
            if (cases is not null)
            {
                CaseList.ItemsSource = cases.OrderByDescending(c => c.Modified).ToList();
            }
        }
        catch { }
    }

    private void CaseList_ItemClick(object sender, ItemClickEventArgs e)
    {
        // Future: navigate to wizard with this case loaded
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string name })
        {
            var path = System.IO.Path.Combine(_config.LocalCasesPath, name);
            if (System.IO.Directory.Exists(path))
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
        }
    }

    private async void ParaView_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string name })
        {
            var foamFile = System.IO.Path.Combine(_config.LocalCasesPath, name, $"{name}.foam");
            if (!System.IO.File.Exists(foamFile))
            {
                try { await _http.PostAsync($"/cases/{name}/ensure-foam", null); } catch { }
                if (!System.IO.File.Exists(foamFile))
                    System.IO.File.WriteAllText(foamFile, "");
            }
            if (System.IO.File.Exists(_config.ParaViewPath))
                Process.Start(new ProcessStartInfo(_config.ParaViewPath, $"\"{foamFile}\"") { UseShellExecute = true });
        }
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string name })
        {
            var dialog = new ContentDialog
            {
                Title = "Delete Case",
                Content = $"Are you sure you want to delete '{name}'? This cannot be undone.",
                PrimaryButtonText = "Delete",
                CloseButtonText = "Cancel",
                XamlRoot = this.XamlRoot,
            };
            if (await dialog.ShowAsync() == ContentDialogResult.Primary)
            {
                try
                {
                    await _http.DeleteAsync($"/cases/{name}");
                    await LoadCases();
                }
                catch { }
            }
        }
    }

    private record CaseItem
    {
        [JsonPropertyName("name")] public string Name { get; init; } = "";
        [JsonPropertyName("path")] public string Path { get; init; } = "";
        [JsonPropertyName("modified")] public string? Modified { get; init; }
    }
}
