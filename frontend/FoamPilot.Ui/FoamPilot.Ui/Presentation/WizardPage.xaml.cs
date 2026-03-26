/*
 * WizardPage Orchestrator — wires up step services and manages navigation.
 *
 *  Step 0: Geometry  (upload STL or pick template)
 *  Step 1: Mesh      (edit dicts, run mesh pipeline, 3D preview)
 *  Step 2: Physics   (edit boundary conditions)
 *  Step 3: Solver    (edit solver settings)
 *  Step 4: Run       (stream solver, convergence chart)
 *  Step 5: Results   (Cd/Cl card, ParaView launch)
 *
 *  ┌──────┐  ┌──────┐  ┌────────┐  ┌──────┐  ┌─────┐  ┌────────┐
 *  │Geom  │─▶│Mesh  │─▶│Physics │─▶│Solver│─▶│ Run │─▶│Results │
 *  └──────┘  └──────┘  └────────┘  └──────┘  └─────┘  └────────┘
 */

using System.Net.Http;
using FoamPilot.Ui.Presentation.WizardSteps;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace FoamPilot.Ui.Presentation;

public sealed partial class WizardPage : Page
{
    private readonly HttpClient _http;
    private readonly AppConfig _config;
    private readonly List<IWizardStep> _steps;
    private readonly List<Panel> _stepPanels;
    private int _currentStep;
    private CancellationTokenSource? _executionCts;

    // Step service instances (for cross-step communication)
    private readonly GeometryStep _geometryStep;
    private readonly MeshStep _meshStep;
    private readonly PhysicsStep _physicsStep;
    private readonly SolverStep _solverStep;
    private readonly RunStep _runStep;
    private readonly ResultsStep _resultsStep;

    public WizardPage()
    {
        this.InitializeComponent();

        _config = App.Services?.GetService<IOptions<AppConfig>>()?.Value ?? new AppConfig();
        _http = new HttpClient { BaseAddress = new Uri(_config.BackendUrl) };

        // Create step services
        _geometryStep = new GeometryStep(_http, _config);
        _meshStep = new MeshStep(_http, _config);
        _physicsStep = new PhysicsStep(_http, _config);
        _solverStep = new SolverStep(_http, _config);
        _runStep = new RunStep(_http, _config);
        _resultsStep = new ResultsStep(_http, _config);

        _steps = [_geometryStep, _meshStep, _physicsStep, _solverStep, _runStep, _resultsStep];

        // Wire cross-step events
        _geometryStep.CaseCreated += OnCaseCreated;
        _geometryStep.TemplateSelected += OnTemplateSelected;

        // Build step UIs
        _stepPanels = _steps.Select(s => s.CreateUI()).ToList();

        // Build stepper bar
        BuildStepperBar();

        // Start at step 0, and fetch core count from backend
        this.Loaded += async (_, _) =>
        {
            await FetchCoreCount();
            await GoToStep(0);
        };
    }

    private async Task FetchCoreCount()
    {
        try
        {
            var resp = await _http.GetAsync("/config");
            if (resp.IsSuccessStatusCode)
            {
                using var doc = System.Text.Json.JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("cores", out var c))
                {
                    var cores = c.GetInt32();
                    _meshStep.SetCores(cores);
                    _runStep.SetCores(cores);
                }
            }
        }
        catch { /* Backend not available — default to serial */ }
    }

    private void OnCaseCreated(string caseName)
    {
        // Propagate case name to all steps
        foreach (var step in _steps.OfType<WizardStepBase>())
            step.SetCaseName(caseName);
    }

    private void OnTemplateSelected(TemplateInfo template)
    {
        // Configure steps from template metadata
        _meshStep.SetTemplateMetadata(template);
        _physicsStep.SetTemplateMetadata(template);
        _solverStep.SetTemplateMetadata(template);
        _runStep.SetSolverCommand(template.Solver);
    }

    private void BuildStepperBar()
    {
        StepperBar.Children.Clear();
        for (int i = 0; i < _steps.Count; i++)
        {
            var step = _steps[i];

            if (i > 0)
            {
                // Connector line
                var line = new Border
                {
                    Width = 32,
                    Height = 2,
                    Background = new SolidColorBrush(Microsoft.UI.Colors.DimGray),
                    VerticalAlignment = VerticalAlignment.Center,
                };
                StepperBar.Children.Add(line);
            }

            var panel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
            };

            var circle = new Border
            {
                Width = 28,
                Height = 28,
                CornerRadius = new CornerRadius(14),
                Background = new SolidColorBrush(Microsoft.UI.Colors.DimGray),
                Child = new TextBlock
                {
                    Text = (i + 1).ToString(),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    FontSize = 12,
                    Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
                },
            };
            panel.Children.Add(circle);

            var label = new TextBlock
            {
                Text = step.Title,
                VerticalAlignment = VerticalAlignment.Center,
                FontSize = 12,
                Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            };
            panel.Children.Add(label);

            panel.Tag = i;
            StepperBar.Children.Add(panel);
        }
    }

    private void UpdateStepperBar()
    {
        int childIndex = 0;
        for (int i = 0; i < _steps.Count; i++)
        {
            if (i > 0) childIndex++; // skip connector
            if (childIndex >= StepperBar.Children.Count) break;

            var panel = StepperBar.Children[childIndex] as StackPanel;
            if (panel?.Children[0] is Border circle && circle.Child is TextBlock num)
            {
                var isComplete = _steps[i].IsComplete;
                var isCurrent = i == _currentStep;

                if (isCurrent)
                {
                    circle.Background = new SolidColorBrush(Microsoft.UI.Colors.DodgerBlue);
                }
                else if (isComplete)
                {
                    circle.Background = new SolidColorBrush(Microsoft.UI.Colors.LimeGreen);
                    num.Text = "✓";
                }
                else
                {
                    circle.Background = new SolidColorBrush(Microsoft.UI.Colors.DimGray);
                    num.Text = (i + 1).ToString();
                }

                if (panel.Children.Count > 1 && panel.Children[1] is TextBlock label)
                {
                    label.Foreground = new SolidColorBrush(isCurrent ? Microsoft.UI.Colors.White : Microsoft.UI.Colors.Gray);
                    label.FontWeight = isCurrent ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal;
                }
            }

            // Update connector color
            if (i > 0 && childIndex > 0)
            {
                var connector = StepperBar.Children[childIndex - 1] as Border;
                if (connector is not null)
                    connector.Background = new SolidColorBrush(
                        _steps[i - 1].IsComplete ? Microsoft.UI.Colors.LimeGreen : Microsoft.UI.Colors.DimGray);
            }

            childIndex++;
        }
    }

    private async Task GoToStep(int index)
    {
        if (index < 0 || index >= _steps.Count) return;

        // Leave current step
        if (_currentStep >= 0 && _currentStep < _steps.Count)
            await _steps[_currentStep].OnLeaveAsync();

        _currentStep = index;
        StepContent.Content = _stepPanels[index];

        // Enter new step
        await _steps[index].OnEnterAsync();

        UpdateStepperBar();
        UpdateButtons();
        StatusText.Text = "";
    }

    private void UpdateButtons()
    {
        var step = _steps[_currentStep];
        BtnBack.IsEnabled = _currentStep > 0;
        BtnNext.Visibility = _currentStep < _steps.Count - 1 ? Visibility.Visible : Visibility.Collapsed;

        if (step.HasExecution && !step.IsComplete)
        {
            BtnExecute.Visibility = Visibility.Visible;
            BtnExecute.Content = _currentStep switch
            {
                1 => "Generate Mesh",
                4 => "Run Solver",
                _ => "Execute",
            };
            BtnNext.IsEnabled = false;
        }
        else
        {
            BtnExecute.Visibility = Visibility.Collapsed;
            BtnNext.IsEnabled = true;
        }
    }

    private async void Back_Click(object sender, RoutedEventArgs e)
    {
        if (_currentStep > 0)
            await GoToStep(_currentStep - 1);
    }

    private async void Next_Click(object sender, RoutedEventArgs e)
    {
        var step = _steps[_currentStep];
        var error = step.Validate();
        if (error is not null)
        {
            StatusText.Text = error;
            StatusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed);
            return;
        }

        if (_currentStep < _steps.Count - 1)
            await GoToStep(_currentStep + 1);
    }

    private async void Execute_Click(object sender, RoutedEventArgs e)
    {
        var step = _steps[_currentStep];
        BtnExecute.IsEnabled = false;
        BtnBack.IsEnabled = false;
        BusyIndicator.IsActive = true;
        BusyIndicator.Visibility = Visibility.Visible;

        _executionCts = new CancellationTokenSource();

        void Log(string msg) => DispatcherQueue.TryEnqueue(() =>
            StatusText.Text = msg);
        void SetStatus(string msg) => DispatcherQueue.TryEnqueue(() =>
            StatusText.Text = msg);

        try
        {
            var success = await step.ExecuteAsync(Log, SetStatus, _executionCts.Token);

            if (success)
            {
                // If this is the run step, propagate divergence to results
                if (step == _runStep)
                    _resultsStep.SetDiverged(_runStep.Diverged);

                StatusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.LimeGreen);
            }
            else
            {
                StatusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed);
            }
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Error: {ex.Message}";
            StatusText.Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed);
        }
        finally
        {
            BtnExecute.IsEnabled = true;
            BtnBack.IsEnabled = _currentStep > 0;
            BusyIndicator.IsActive = false;
            BusyIndicator.Visibility = Visibility.Collapsed;
            UpdateStepperBar();
            UpdateButtons();
        }
    }
}
