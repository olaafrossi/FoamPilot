using Microsoft.UI.Xaml.Data;

namespace FoamPilot.Ui.Presentation;

public sealed class NullToBoolConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language)
        => value is string s && !string.IsNullOrEmpty(s);

    public object ConvertBack(object value, Type targetType, object parameter, string language)
        => throw new NotSupportedException();
}

public sealed class VersionMessageConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language)
        => value is string version ? $"Version {version} is ready to install." : string.Empty;

    public object ConvertBack(object value, Type targetType, object parameter, string language)
        => throw new NotSupportedException();
}
