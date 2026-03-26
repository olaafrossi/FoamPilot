using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public sealed partial class SettingsPage : Page
{
    private readonly AppConfig _config;
    private readonly IDockerManager? _docker;

    public SettingsPage()
    {
        this.InitializeComponent();

        _config = App.Services?.GetService<IOptions<AppConfig>>()?.Value ?? new AppConfig();
        _docker = App.Services?.GetService<IDockerManager>();

        this.Loaded += (_, _) => LoadSettings();
    }

    private void LoadSettings()
    {
        BackendUrlBox.Text = _config.BackendUrl;
        DockerComposePathBox.Text = _config.DockerComposePath;
        ParaViewPathBox.Text = _config.ParaViewPath;
        LocalCasesPathBox.Text = _config.LocalCasesPath;
        AutoStartToggle.IsOn = _config.AutoStartContainer;
        ThemeComboBox.SelectedItem = "System";
    }

    private async void StartContainer_Click(object sender, RoutedEventArgs e)
    {
        if (_docker is null) return;
        BtnStartContainer.IsEnabled = false;
        DockerStatusText.Text = "Starting...";
        try
        {
            await _docker.StartAsync(CancellationToken.None);
            DockerStatusText.Text = "Container started.";
        }
        catch (Exception ex)
        {
            DockerStatusText.Text = $"Failed: {ex.Message}";
        }
        finally
        {
            BtnStartContainer.IsEnabled = true;
        }
    }

    private async void StopContainer_Click(object sender, RoutedEventArgs e)
    {
        if (_docker is null) return;
        BtnStopContainer.IsEnabled = false;
        DockerStatusText.Text = "Stopping...";
        try
        {
            await _docker.StopAsync(CancellationToken.None);
            DockerStatusText.Text = "Container stopped.";
        }
        catch (Exception ex)
        {
            DockerStatusText.Text = $"Failed: {ex.Message}";
        }
        finally
        {
            BtnStopContainer.IsEnabled = true;
        }
    }

    private void AutoStart_Toggled(object sender, RoutedEventArgs e)
    {
        // Will be persisted on Save
    }

    private void ThemeComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is not Microsoft.UI.Xaml.Controls.ComboBox combo
            || combo.SelectedItem is not string themeName)
            return;

        var theme = themeName switch
        {
            "Light" => ElementTheme.Light,
            "Dark" => ElementTheme.Dark,
            _ => ElementTheme.Default
        };

        if (XamlRoot?.Content is FrameworkElement root)
        {
            root.RequestedTheme = theme;
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        // Build updated config
        var updated = new Dictionary<string, object>
        {
            ["AppConfig"] = new Dictionary<string, object>
            {
                ["Environment"] = _config.Environment ?? "Development",
                ["ParaViewPath"] = ParaViewPathBox.Text,
                ["LocalCasesPath"] = LocalCasesPathBox.Text,
                ["BackendUrl"] = BackendUrlBox.Text,
                ["DockerComposePath"] = DockerComposePathBox.Text,
                ["AutoStartContainer"] = AutoStartToggle.IsOn,
            }
        };

        try
        {
            // Write to appsettings.json next to the exe
            var appDir = AppContext.BaseDirectory;
            var settingsPath = Path.Combine(appDir, "appsettings.json");
            var json = JsonSerializer.Serialize(updated, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(settingsPath, json);

            SaveStatus.Text = $"Saved to {settingsPath}. Restart the app to apply changes.";
        }
        catch (Exception ex)
        {
            SaveStatus.Text = $"Failed to save: {ex.Message}";
        }
    }
}
