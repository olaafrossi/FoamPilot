namespace FoamPilot.Ui.Presentation;

public sealed partial class SettingsPage : Page
{
    public SettingsPage()
    {
        this.InitializeComponent();
    }

    private SettingsModel? Model =>
        DataContext?.GetType().GetProperty("Model")?.GetValue(DataContext) as SettingsModel;

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

    private void ParaViewPath_LostFocus(object sender, RoutedEventArgs e)
    {
        if (sender is not TextBox textBox)
            return;

        _ = Model?.SaveParaViewPath(textBox.Text, CancellationToken.None);
    }

    private void AutoStart_Toggled(object sender, RoutedEventArgs e)
    {
        if (sender is not ToggleSwitch toggle)
            return;

        _ = Model?.SaveAutoStart(toggle.IsOn);
    }
}
