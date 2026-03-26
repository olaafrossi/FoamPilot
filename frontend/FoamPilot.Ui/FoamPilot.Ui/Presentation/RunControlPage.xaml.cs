namespace FoamPilot.Ui.Presentation;

public sealed partial class RunControlPage : Page
{
    public RunControlPage()
    {
        this.InitializeComponent();
    }

    private RunControlModel? Model =>
        DataContext?.GetType().GetProperty("Model")?.GetValue(DataContext) as RunControlModel;

    private void CaseComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox combo && combo.SelectedItem is FoamCase selected)
        {
            Model?.SelectedCase.UpdateAsync(_ => selected, CancellationToken.None);
        }
    }
}
