using Microsoft.UI.Xaml.Data;

namespace FoamPilot.Ui.Presentation;

public sealed class BoolToVisibilityConverter : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var boolValue = value is true;
        if (Invert) boolValue = !boolValue;

        // For InfoBar.IsOpen, return bool directly
        if (targetType == typeof(bool)) return boolValue;

        return boolValue ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language)
        => throw new NotSupportedException();
}
