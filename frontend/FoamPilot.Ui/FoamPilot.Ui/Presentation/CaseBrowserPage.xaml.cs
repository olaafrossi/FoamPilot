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
            var vm = (BindableCaseBrowserModel)DataContext;
            await vm.CreateCase(CancellationToken.None);
        }
    }
}
