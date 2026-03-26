using Microsoft.UI.Xaml.Controls;

namespace FoamPilot.Ui.Presentation;

public sealed partial class Shell : UserControl, IContentControlProvider
{
    public Shell()
    {
        this.InitializeComponent();
        // Default to New Simulation (wizard) on launch
        this.Loaded += (_, _) =>
        {
            if (NavView.MenuItems.Count > 0)
                NavView.SelectedItem = NavView.MenuItems[0];
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
}
