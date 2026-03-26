using Microsoft.UI;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Media;

namespace FoamPilot.Ui.Presentation;

public sealed class JobStatusToBrushConverter : IValueConverter
{
    private static readonly SolidColorBrush BlueBrush = new(ColorHelper.FromArgb(255, 0, 120, 212));
    private static readonly SolidColorBrush GreenBrush = new(ColorHelper.FromArgb(255, 16, 124, 16));
    private static readonly SolidColorBrush RedBrush = new(ColorHelper.FromArgb(255, 209, 52, 56));
    private static readonly SolidColorBrush GreyBrush = new(ColorHelper.FromArgb(255, 138, 136, 134));
    private static readonly SolidColorBrush YellowBrush = new(ColorHelper.FromArgb(255, 196, 160, 0));

    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var status = value switch
        {
            JobStatus s => s,
            string str when Enum.TryParse<JobStatus>(str, true, out var parsed) => parsed,
            _ => JobStatus.Queued
        };

        return status switch
        {
            JobStatus.Running => BlueBrush,
            JobStatus.Completed => GreenBrush,
            JobStatus.Failed => RedBrush,
            JobStatus.Cancelled => GreyBrush,
            JobStatus.Queued => YellowBrush,
            _ => GreyBrush
        };
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language)
        => throw new NotSupportedException();
}
