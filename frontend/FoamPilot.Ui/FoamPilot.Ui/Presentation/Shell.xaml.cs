using FoamPilot.Ui.Services;
using Microsoft.UI.Xaml.Controls;

namespace FoamPilot.Ui.Presentation;

public sealed partial class Shell : UserControl, IContentControlProvider
{
    private IUpdateService? _updateService;

    public Shell()
    {
        this.InitializeComponent();
        // Default to New Simulation (wizard) on launch
        this.Loaded += (_, _) =>
        {
            if (NavView.MenuItems.Count > 0)
                NavView.SelectedItem = NavView.MenuItems[0];
        };

        // Check for updates on startup
        this.Loaded += async (_, _) =>
        {
            _updateService = App.Services?.GetService(typeof(IUpdateService)) as IUpdateService;
            if (_updateService is not null)
            {
                await CheckForUpdateAsync();
                _ = StartBackgroundUpdateCheckAsync();
            }
        };
    }

    public ContentControl ContentControl => NavContent;

    private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is NavigationViewItem item && item.Tag is string tag)
        {
            Navigate(tag);
        }
    }

    private void Navigate(string tag)
    {
        Page? page = tag switch
        {
            "Wizard" => new WizardPage(),
            "MySimulations" => new MySimulationsPage(),
            "Dashboard" => new DashboardPage(),
            "Cases" => new CaseBrowserPage(),
            "RunControl" => new RunControlPage(),
            "Logs" => new LogsPage(),
            "DictEditor" => new DictEditorPage(),
            "Settings" => new SettingsPage(),
            _ => null,
        };

        if (page is not null)
        {
            NavContent.Content = page;
        }
    }

    private async Task CheckForUpdateAsync()
    {
        if (_updateService is null) return;

        try
        {
            var update = await _updateService.CheckForUpdateAsync(CancellationToken.None);
            if (update is not null)
            {
                UpdateInfoBar.Message = $"Version {update.TargetVersion} is ready to install.";
                UpdateInfoBar.IsOpen = true;
            }
        }
        catch
        {
            // Silently ignore update check failures
        }
    }

    private async Task StartBackgroundUpdateCheckAsync()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
        while (await timer.WaitForNextTickAsync())
        {
            await CheckForUpdateAsync();
        }
    }

    private async void UpdateNow_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        if (_updateService is null) return;

        try
        {
            UpdateNowButton.IsEnabled = false;
            UpdateInfoBar.Message = "Downloading update...";
            await _updateService.DownloadUpdateAsync(null, CancellationToken.None);
            _updateService.ApplyUpdateAndRestart();
        }
        catch (Exception ex)
        {
            UpdateInfoBar.Severity = InfoBarSeverity.Error;
            UpdateInfoBar.Message = $"Update failed: {ex.Message}";
            UpdateNowButton.IsEnabled = true;
        }
    }
}
