using Microsoft.UI;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Media;

namespace FoamPilot.Ui.Presentation;

public sealed class ContainerStatusToColorConverter : IValueConverter
{
    private static readonly SolidColorBrush GreenBrush = new(ColorHelper.FromArgb(255, 16, 124, 16));
    private static readonly SolidColorBrush RedBrush = new(ColorHelper.FromArgb(255, 209, 52, 56));
    private static readonly SolidColorBrush GreyBrush = new(ColorHelper.FromArgb(255, 138, 136, 134));

    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var status = value switch
        {
            ContainerStatus s => s,
            string str when Enum.TryParse<ContainerStatus>(str, true, out var parsed) => parsed,
            _ => ContainerStatus.Unknown
        };

        return status switch
        {
            ContainerStatus.Running => GreenBrush,
            ContainerStatus.Stopped => RedBrush,
            ContainerStatus.Error => RedBrush,
            _ => GreyBrush
        };
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language)
        => throw new NotSupportedException();
}
