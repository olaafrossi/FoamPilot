using LiveChartsCore.SkiaSharpView;

namespace FoamPilot.Ui.Presentation;

public sealed partial class LogsPage : Page
{
    private long _lastLogCount;

    public LogsPage()
    {
        this.InitializeComponent();
        this.Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Configure axes for residuals chart
        ResidualChart.XAxes = new Axis[] { new() { Name = "Iteration" } };
        ResidualChart.YAxes = new Axis[]
        {
            new LogaritmicAxis(10)
            {
                Labeler = value => Math.Pow(10, value).ToString("E1"),
                MinLimit = Math.Log10(1e-10),
            }
        };

        // Find the ComboBox inside the FeedView after it renders
        FindAndBindComboBox();

        // Start auto-scroll polling via DispatcherTimer
        var scrollTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        scrollTimer.Tick += OnScrollTimerTick;
        scrollTimer.Start();
    }

    private void OnScrollTimerTick(object? sender, object e)
    {
        var model = GetModel();
        if (model is null) return;

        // Check if auto-scroll is enabled and log has new content
        var logLines = model.LogLines;
        if (logLines is null) return;

        // Use the ScrollableHeight as a proxy for content change
        if (LogScrollViewer.ScrollableHeight > 0)
        {
            // Check AutoScroll state synchronously via the binding
            var autoScrollToggle = AutoScrollToggle;
            if (autoScrollToggle?.IsChecked == true)
            {
                LogScrollViewer.ChangeView(null, LogScrollViewer.ScrollableHeight, null);
            }
        }
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
        if (sender is ComboBox combo)
        {
            var selectedJob = combo.SelectedItem as RunJob;
            var model = GetModel();
            if (model is not null)
            {
                await model.OnJobSelected(selectedJob, CancellationToken.None);
            }

            // Scroll to bottom after loading
            ScrollToBottom();
        }
    }

    private async void OnFieldCheckBoxClick(object sender, RoutedEventArgs e)
    {
        if (sender is CheckBox checkBox && checkBox.DataContext is FieldVisibility field)
        {
            var model = GetModel();
            if (model is not null)
            {
                await model.ToggleFieldVisibility(field.Name, CancellationToken.None);
            }
        }
    }

    private void ScrollToBottom()
    {
        if (LogScrollViewer is not null)
        {
            LogScrollViewer.ChangeView(null, LogScrollViewer.ScrollableHeight, null);
        }
    }

    private LogsModel? GetModel()
    {
        return DataContext?.GetType().GetProperty("Model")?.GetValue(DataContext) as LogsModel;
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
