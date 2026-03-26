using LiveChartsCore.SkiaSharpView;

namespace FoamPilot.Ui.Presentation;

public sealed partial class LogsPage : Page
{
    public LogsPage()
    {
        this.InitializeComponent();
        this.Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Configure logarithmic Y axis for residuals
        ResidualChart.YAxes = new[]
        {
            new LogaritmicAxis
            {
                Base = 10,
                Labeler = value => Math.Pow(10, value).ToString("E1"),
                MinLimit = Math.Log10(1e-10),
            }
        };

        // Find the ComboBox inside the FeedView after it renders
        FindAndBindComboBox();
    }

    private void FindAndBindComboBox()
    {
        var comboBox = FindDescendant<ComboBox>(this, "JobSelector");
        if (comboBox is not null)
        {
            comboBox.SelectionChanged += OnJobSelectionChanged;
        }
    }

    private async void OnJobSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox combo && DataContext is BindableLogsModel model)
        {
            var selectedJob = combo.SelectedItem as RunJob;
            await model.Model.OnJobSelected(selectedJob, CancellationToken.None);

            // Scroll to bottom after loading
            ScrollToBottom();
        }
    }

    private void ScrollToBottom()
    {
        if (LogScrollViewer is not null)
        {
            LogScrollViewer.ChangeView(null, LogScrollViewer.ScrollableHeight, null);
        }
    }

    private static T? FindDescendant<T>(DependencyObject parent, string name) where T : FrameworkElement
    {
        var count = Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChildrenCount(parent);
        for (int i = 0; i < count; i++)
        {
            var child = Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChild(parent, i);
            if (child is T typedChild && typedChild.Name == name)
                return typedChild;

            var result = FindDescendant<T>(child, name);
            if (result is not null)
                return result;
        }
        return null;
    }
}
