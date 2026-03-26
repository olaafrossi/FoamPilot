using System.Diagnostics.CodeAnalysis;
using System.Net.Http;
using FoamPilot.Ui.Services;
using Uno.Resizetizer;

namespace FoamPilot.Ui;

public partial class App : Application
{
    public App()
    {
        this.InitializeComponent();
    }

    protected Window? MainWindow { get; private set; }
    protected IHost? Host { get; private set; }

    [SuppressMessage("Trimming", "IL2026:Members annotated with 'RequiresUnreferencedCodeAttribute' require dynamic access otherwise can break functionality when trimming application code", Justification = "Uno.Extensions APIs are used in a way that is safe for trimming in this template context.")]
    protected async override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var builder = this.CreateBuilder(args)
            .UseToolkitNavigation()
            .Configure(host => host
#if DEBUG
                .UseEnvironment(Environments.Development)
#endif
                .UseLogging(configure: (context, logBuilder) =>
                {
                    logBuilder
                        .SetMinimumLevel(
                            context.HostingEnvironment.IsDevelopment()
                                ? LogLevel.Information
                                : LogLevel.Warning)
                        .CoreLogLevel(LogLevel.Warning);
                }, enableUnoLogging: true)
                .UseSerilog(consoleLoggingEnabled: true, fileLoggingEnabled: true)
                .UseConfiguration(configure: configBuilder =>
                    configBuilder
                        .EmbeddedSource<App>()
                        .Section<AppConfig>()
                )
                .ConfigureServices((context, services) =>
                {
                    // ── HTTP client for the FastAPI backend ──
                    services.AddHttpClient<IOpenFoamApiClient, OpenFoamApiClient>(client =>
                    {
                        client.BaseAddress = new Uri("http://localhost:8000");
                    });

                    // ── WebSocket log streaming ──
                    services.AddSingleton<ILogStreamService>(sp =>
                        new LogStreamService(() => new Uri("http://localhost:8000")));

                    // ── Docker Compose manager ──
                    services.AddSingleton<IDockerManager>(sp =>
                        new DockerManager(() => "./docker"));

                    // ── ParaView service ──
                    services.AddSingleton<IParaViewService, ParaViewService>();
                })
                .UseNavigation(ReactiveViewModelMappings.ViewModelMappings, RegisterRoutes)
            );

        MainWindow = builder.Window;

#if DEBUG
        MainWindow.UseStudio();
#endif
        MainWindow.SetWindowIcon();

        Host = await builder.NavigateAsync<Shell>();

        // Auto-start container if enabled
        if (Host is not null)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    var paraViewService = Host.Services.GetService<IParaViewService>();
                    if (paraViewService?.AutoStartContainer == true)
                    {
                        var docker = Host.Services.GetRequiredService<IDockerManager>();
                        await docker.StartAsync(CancellationToken.None);
                    }
                }
                catch
                {
                    // Swallow auto-start failures silently
                }
            });
        }
    }

    private static void RegisterRoutes(IViewRegistry views, IRouteRegistry routes)
    {
        views.Register(
            new ViewMap(ViewModel: typeof(ShellModel)),
            new ViewMap<DashboardPage, DashboardModel>(),
            new ViewMap<CasesPage, CasesModel>(),
            new ViewMap<CaseBrowserPage, CaseBrowserModel>(),
            new ViewMap<RunControlPage, RunControlModel>(),
            new ViewMap<LogsPage, LogsModel>(),
            new ViewMap<DictEditorPage, DictEditorModel>(),
            new ViewMap<WizardPage, WizardModel>(),
            new ViewMap<SettingsPage, SettingsModel>()
        );

        routes.Register(
            new RouteMap("", View: views.FindByViewModel<ShellModel>(),
                Nested:
                [
                    new("Dashboard", View: views.FindByViewModel<DashboardModel>(), IsDefault: true),
                    new("Cases", View: views.FindByViewModel<CaseBrowserModel>()),
                    new("RunControl", View: views.FindByViewModel<RunControlModel>()),
                    new("Logs", View: views.FindByViewModel<LogsModel>()),
                    new("DictEditor", View: views.FindByViewModel<DictEditorModel>()),
                    new("Wizard", View: views.FindByViewModel<WizardModel>()),
                    new("Settings", View: views.FindByViewModel<SettingsModel>()),
                ]
            )
        );
    }
}
