using Uno.Extensions.Reactive;

namespace FoamPilot.Ui.Presentation;

public sealed partial class DictEditorPage : Page
{
    public DictEditorPage()
    {
        this.InitializeComponent();
        this.DataContextChanged += OnDataContextChanged;
    }

    private DictEditorModel? Model =>
        DataContext?.GetType().GetProperty("Model")?.GetValue(DataContext) as DictEditorModel;

    private bool _suppressTextChanged;

    private void OnDataContextChanged(FrameworkElement sender, DataContextChangedEventArgs args)
    {
        if (Model is null) return;

        // Subscribe to state changes for FileContent, IsDirty, ValidationWarning, SelectedFile
        State.ForEachAsync(Model.FileContent, OnFileContentChanged);
        State.ForEachAsync(Model.IsDirty, OnIsDirtyChanged);
        State.ForEachAsync(Model.ValidationWarning, OnValidationWarningChanged);
        State.ForEachAsync(Model.SelectedFile, OnSelectedFileStateChanged);
    }

    private async ValueTask OnFileContentChanged(string? content, CancellationToken ct)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            _suppressTextChanged = true;
            EditorTextBox.Text = content ?? string.Empty;
            EditorTextBox.IsEnabled = !string.IsNullOrEmpty(content) || content == string.Empty;
            _suppressTextChanged = false;
        });
    }

    private async ValueTask OnIsDirtyChanged(bool isDirty, CancellationToken ct)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            SaveButton.IsEnabled = isDirty;
            RevertButton.IsEnabled = isDirty;
        });
    }

    private async ValueTask OnValidationWarningChanged(string? warning, CancellationToken ct)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            if (!string.IsNullOrEmpty(warning))
            {
                ValidationInfoBar.Message = warning;
                ValidationInfoBar.IsOpen = true;
            }
            else
            {
                ValidationInfoBar.IsOpen = false;
            }
        });
    }

    private async ValueTask OnSelectedFileStateChanged(FileNode? file, CancellationToken ct)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            BreadcrumbText.Text = file?.Path ?? string.Empty;
        });
    }

    private void CaseComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox combo && combo.SelectedItem is FoamCase selected)
        {
            Model?.SelectedCase.UpdateAsync(_ => selected, CancellationToken.None);
        }
    }

    private void FileTreeView_ItemInvoked(Microsoft.UI.Xaml.Controls.TreeView sender,
        Microsoft.UI.Xaml.Controls.TreeViewItemInvokedEventArgs args)
    {
        if (args.InvokedItem is FileNode node && node.Type == "file")
        {
            Model?.SelectedFile.UpdateAsync(_ => node, CancellationToken.None);
        }
    }

    private void EditorTextBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressTextChanged || Model is null) return;
        Model.FileContent.UpdateAsync(_ => EditorTextBox.Text, CancellationToken.None);
    }

    private async void SaveButton_Click(object sender, RoutedEventArgs e)
    {
        if (Model is null) return;
        await Model.SaveFile(CancellationToken.None);
    }

    private async void RevertButton_Click(object sender, RoutedEventArgs e)
    {
        if (Model is null) return;
        await Model.RevertFile(CancellationToken.None);
    }
}
