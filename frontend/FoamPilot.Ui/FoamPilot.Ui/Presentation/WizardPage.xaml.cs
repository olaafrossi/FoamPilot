namespace FoamPilot.Ui.Presentation;

public sealed partial class WizardPage : Page
{
    public WizardPage()
    {
        this.InitializeComponent();
    }

    private WizardModel? GetModel() =>
        DataContext?.GetType().GetProperty("Model")?.GetValue(DataContext) as WizardModel;

    // ── Template selection ──────────────────────────────────────────────

    private void TemplateGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is GridView grid && grid.SelectedItem is TemplateMetadata template)
        {
            var model = GetModel();
            model?.SelectedTemplate.UpdateAsync(_ => template, CancellationToken.None);
        }
    }

    // ── Navigation ─────────────────────────────────────────────────────

    private async void Next_Click(object sender, RoutedEventArgs e)
    {
        var model = GetModel();
        if (model is null) return;

        var step = await model.CurrentStep;
        if (step == 0)
        {
            await model.StartWizard(CancellationToken.None);
        }
        else
        {
            await model.AdvanceStep(CancellationToken.None);
        }

        await UpdateUI();
    }

    private async void Back_Click(object sender, RoutedEventArgs e)
    {
        var model = GetModel();
        if (model is null) return;

        var step = await model.CurrentStep;
        if (step > 0)
        {
            await model.CurrentStep.UpdateAsync(_ => step - 1, CancellationToken.None);
            await model.StatusMessage.UpdateAsync(_ => GetStepTitle(step - 1), CancellationToken.None);
            await UpdateUI();
        }
    }

    // ── File editing ───────────────────────────────────────────────────

    private async void SaveFile_Click(object sender, RoutedEventArgs e)
    {
        var model = GetModel();
        if (model is null) return;
        await model.SaveFile(CancellationToken.None);
    }

    private async void RevertFile_Click(object sender, RoutedEventArgs e)
    {
        var model = GetModel();
        if (model is null) return;
        await model.RevertFile(CancellationToken.None);
        var content = await model.FileContent;
        if (content is not null)
            WizardEditor.Text = content;
    }

    private async void Editor_TextChanged(object sender, TextChangedEventArgs e)
    {
        var model = GetModel();
        if (model is null) return;
        await model.FileContent.UpdateAsync(_ => WizardEditor.Text, CancellationToken.None);
        var original = await model.OriginalFileContent;
        await model.IsFileDirty.UpdateAsync(_ => WizardEditor.Text != original, CancellationToken.None);
    }

    // ── Validation ─────────────────────────────────────────────────────

    private async void Validate_Click(object sender, RoutedEventArgs e)
    {
        var model = GetModel();
        if (model is null) return;
        await model.ValidateCurrentStep(CancellationToken.None);
    }

    // ── ParaView ───────────────────────────────────────────────────────

    private void OpenParaView_Click(object sender, RoutedEventArgs e)
    {
        // TODO: wire up ParaView launch for the wizard case
    }

    // ── UI state management ────────────────────────────────────────────

    private async Task UpdateUI()
    {
        var model = GetModel();
        if (model is null) return;

        var step = await model.CurrentStep;

        // Show/hide content panels
        TemplatePicker.Visibility = step == 0 ? Visibility.Visible : Visibility.Collapsed;
        FileEditorPanel.Visibility = step >= 1 && step <= 3 ? Visibility.Visible : Visibility.Collapsed;
        RunPanel.Visibility = step == 4 ? Visibility.Visible : Visibility.Collapsed;
        ResultsPanel.Visibility = step == 5 ? Visibility.Visible : Visibility.Collapsed;

        // Show/hide nav buttons
        BackButton.Visibility = step > 0 ? Visibility.Visible : Visibility.Collapsed;
        NextButton.Content = step == 0 ? "Start Wizard" : step >= 5 ? "Done" : "Validate & Next";

        // Update stepper indicators
        UpdateStepIndicators(step);

        // Load first file for the current step
        if (step >= 1 && step <= 3)
        {
            var firstFile = GetStepFiles(step).FirstOrDefault();
            if (firstFile is not null)
            {
                await model.LoadFile(firstFile, CancellationToken.None);
                var content = await model.FileContent;
                if (content is not null)
                    WizardEditor.Text = content;
            }
        }
    }

    private void UpdateStepIndicators(int currentStep)
    {
        Step1.SetState(currentStep > 1 ? "complete" : currentStep == 1 ? "current" : "locked");
        Step2.SetState(currentStep > 2 ? "complete" : currentStep == 2 ? "current" : "locked");
        Step3.SetState(currentStep > 3 ? "complete" : currentStep == 3 ? "current" : "locked");
        Step4.SetState(currentStep > 4 ? "complete" : currentStep == 4 ? "current" : "locked");
        Step5.SetState(currentStep >= 5 ? "complete" : "locked");
    }

    private static string[] GetStepFiles(int step) => step switch
    {
        1 => ["system/blockMeshDict"],
        2 => ["0/U", "0/p"],
        3 => ["system/controlDict", "system/fvSchemes", "system/fvSolution"],
        _ => [],
    };

    private static string GetStepTitle(int step) => step switch
    {
        0 => "Select a template to begin.",
        1 => "Step 1: Generate Mesh",
        2 => "Step 2: Set Boundary Conditions",
        3 => "Step 3: Configure Solver",
        4 => "Step 4: Run Simulation",
        5 => "Simulation Complete!",
        _ => "",
    };
}
