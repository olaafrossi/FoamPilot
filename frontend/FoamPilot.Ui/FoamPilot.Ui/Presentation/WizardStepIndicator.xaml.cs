namespace FoamPilot.Ui.Presentation;

public sealed partial class WizardStepIndicator : UserControl
{
    public int StepNumber { get; set; }
    public string StepTitle { get; set; } = "";

    public WizardStepIndicator()
    {
        this.InitializeComponent();
        this.Loaded += (_, _) =>
        {
            NumberText.Text = StepNumber.ToString();
            TitleText.Text = StepTitle;
            SetState("locked");
        };
    }

    /// <summary>Set visual state: "locked", "current", or "complete".</summary>
    public void SetState(string state)
    {
        switch (state)
        {
            case "current":
                NumberBorder.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 199, 191, 255)); // #C7BFFF
                NumberText.Text = StepNumber.ToString();
                NumberText.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 28, 27, 31)); // dark text
                TitleText.Opacity = 1.0;
                StepBorder.BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 199, 191, 255));
                break;

            case "complete":
                NumberBorder.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 76, 175, 80)); // green
                NumberText.Text = "✓";
                NumberText.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 255, 255, 255));
                TitleText.Opacity = 0.7;
                StepBorder.BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(60, 76, 175, 80));
                break;

            default: // locked
                NumberBorder.Background = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["CardStrokeColorDefaultBrush"];
                NumberText.Text = StepNumber.ToString();
                NumberText.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 150, 150, 150));
                TitleText.Opacity = 0.4;
                StepBorder.BorderBrush = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["CardStrokeColorDefaultBrush"];
                break;
        }
    }
}
