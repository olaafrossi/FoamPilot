namespace FoamPilot.Ui.Presentation;

public sealed partial class CaseBrowserPage : Page
{
    public CaseBrowserPage()
    {
        this.InitializeComponent();
    }

    private async void NewCase_Click(object sender, RoutedEventArgs e)
    {
        var result = await NewCaseDialog.ShowAsync();

        if (result == ContentDialogResult.Primary)
        {
            // Access the CreateCase command via the source-generated bindable model
            dynamic vm = DataContext;
            await vm.CreateCase(CancellationToken.None);
        }
    }
}
