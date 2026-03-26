using Uno.Resizetizer;

namespace FoamPilot.Ui;

public partial class App : Application
{
    public App()
    {
        this.InitializeComponent();
    }

    public Window? MainWindow { get; private set; }
    protected IHost? Host { get; private set; }

    /// <summary>Expose DI container for manual page construction.</summary>
    public static IServiceProvider? Services => ((App)Current).Host?.Services;

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // Build host for configuration (IOptions<AppConfig>) and logging only.
        // We handle navigation manually in Shell.xaml.cs — no Uno.Extensions.Navigation.
        var hostBuilder = Microsoft.Extensions.Hosting.Host.CreateDefaultBuilder()
            .ConfigureServices((context, services) =>
            {
                // Register AppConfig from embedded appsettings.json
                var config = new AppConfig();
                try
                {
                    var env = "Production";
#if DEBUG
                    env = "Development";
#endif
                    // Try to load from embedded resource
                    var asm = typeof(App).Assembly;
                    var resName = env == "Development"
                        ? "FoamPilot.Ui.appsettings.development.json"
                        : "FoamPilot.Ui.appsettings.json";

                    // Try development first, fall back to production
                    var stream = asm.GetManifestResourceStream(resName)
                              ?? asm.GetManifestResourceStream("FoamPilot.Ui.appsettings.json");

                    if (stream is not null)
                    {
                        var jsonDoc = System.Text.Json.JsonDocument.Parse(stream);
                        if (jsonDoc.RootElement.TryGetProperty("AppConfig", out var appConfigEl))
                        {
                            config = System.Text.Json.JsonSerializer.Deserialize<AppConfig>(appConfigEl.GetRawText())
                                     ?? new AppConfig();
                        }
                    }
                }
                catch { /* Use defaults */ }

                services.AddSingleton(Microsoft.Extensions.Options.Options.Create(config));
            });

        Host = hostBuilder.Build();

        // Create window and set Shell directly — no navigation framework
        MainWindow = new Window();
        MainWindow.Content = new Presentation.Shell();

#if DEBUG
        MainWindow.EnableHotReload();
#endif

        MainWindow.SetWindowIcon();
        MainWindow.Activate();
    }
}
