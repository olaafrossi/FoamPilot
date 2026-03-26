namespace FoamPilot.Ui.Presentation;

public sealed partial class WizardStepIndicator : UserControl
{
    public int StepNumber { get; set; }
    public string StepTitle { get; set; } = "";

    private static readonly SolidColorBrush PrimaryBrush = new(Windows.UI.Color.FromArgb(255, 199, 191, 255));
    private static readonly SolidColorBrush DarkTextBrush = new(Windows.UI.Color.FromArgb(255, 28, 27, 31));
    private static readonly SolidColorBrush GreenBrush = new(Windows.UI.Color.FromArgb(255, 76, 175, 80));
    private static readonly SolidColorBrush GreenFaintBrush = new(Windows.UI.Color.FromArgb(60, 76, 175, 80));
    private static readonly SolidColorBrush WhiteBrush = new(Windows.UI.Color.FromArgb(255, 255, 255, 255));
    private static readonly SolidColorBrush GrayBrush = new(Windows.UI.Color.FromArgb(255, 100, 100, 100));
    private static readonly SolidColorBrush DimBrush = new(Windows.UI.Color.FromArgb(255, 60, 60, 60));

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

    public void SetState(string state)
    {
        switch (state)
        {
            case "current":
                NumberBorder.Background = PrimaryBrush;
                NumberText.Text = StepNumber.ToString();
                NumberText.Foreground = DarkTextBrush;
                TitleText.Opacity = 1.0;
                StepBorder.BorderBrush = PrimaryBrush;
                break;

            case "complete":
                NumberBorder.Background = GreenBrush;
                NumberText.Text = "\u2713";
                NumberText.Foreground = WhiteBrush;
                TitleText.Opacity = 0.7;
                StepBorder.BorderBrush = GreenFaintBrush;
                break;

            default:
                NumberBorder.Background = DimBrush;
                NumberText.Text = StepNumber.ToString();
                NumberText.Foreground = GrayBrush;
                TitleText.Opacity = 0.4;
                StepBorder.BorderBrush = DimBrush;
                break;
        }
    }
}
