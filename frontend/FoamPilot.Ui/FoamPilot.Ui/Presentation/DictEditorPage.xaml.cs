using Microsoft.UI.Xaml.Controls;
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

        State.ForEachAsync(Model.FileContent, OnFileContentChanged);
        State.ForEachAsync(Model.IsDirty, OnIsDirtyChanged);
        State.ForEachAsync(Model.ValidationWarning, OnValidationWarningChanged);
        State.ForEachAsync(Model.SelectedFile, OnSelectedFileStateChanged);
        State.ForEachAsync(Model.FileTreeNodes, OnFileTreeChanged);
    }

    // ── State subscribers ─────────────────────────────────────────────

    private async ValueTask OnFileContentChanged(string? content, CancellationToken ct)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            _suppressTextChanged = true;
            EditorTextBox.Text = content ?? string.Empty;
            // Enable editor when a file is loaded (content is non-null)
            EditorTextBox.IsEnabled = content is not null;
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

    private async ValueTask OnFileTreeChanged(IImmutableList<FileNode>? nodes, CancellationToken ct)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            FileTreeView.RootNodes.Clear();

            if (nodes is null || nodes.Count == 0)
            {
                FileTreeView.Visibility = Visibility.Collapsed;
                TreePlaceholderText.Visibility = Visibility.Visible;
                TreeProgressRing.IsActive = false;
                return;
            }

            foreach (var node in nodes)
            {
                FileTreeView.RootNodes.Add(BuildTreeViewNode(node));
            }

            FileTreeView.Visibility = Visibility.Visible;
            TreePlaceholderText.Visibility = Visibility.Collapsed;
            TreeProgressRing.IsActive = false;
        });
    }

    private static TreeViewNode BuildTreeViewNode(FileNode fileNode)
    {
        var tvNode = new TreeViewNode
        {
            Content = fileNode,
            IsExpanded = fileNode.Type == "dir"
        };

        if (fileNode.Children is not null)
        {
            foreach (var child in fileNode.Children)
            {
                tvNode.Children.Add(BuildTreeViewNode(child));
            }
        }

        return tvNode;
    }

    // ── Event handlers ────────────────────────────────────────────────

    private void CaseComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox combo && combo.SelectedItem is FoamCase selected)
        {
            _ = HandleCaseChangeAsync(selected);
        }
    }

    private async Task HandleCaseChangeAsync(FoamCase selected)
    {
        if (Model is null) return;

        if (!await ConfirmDiscardIfDirtyAsync()) return;

        // Clear current file selection and editor
        await Model.SelectedFile.UpdateAsync(_ => null!, CancellationToken.None);
        await Model.FileContent.UpdateAsync(_ => null!, CancellationToken.None);
        await Model.OriginalContent.UpdateAsync(_ => null!, CancellationToken.None);
        await Model.IsDirty.UpdateAsync(_ => false, CancellationToken.None);
        await Model.ValidationWarning.UpdateAsync(_ => string.Empty, CancellationToken.None);

        // Show loading state
        DispatcherQueue.TryEnqueue(() =>
        {
            FileTreeView.RootNodes.Clear();
            FileTreeView.Visibility = Visibility.Collapsed;
            TreePlaceholderText.Visibility = Visibility.Collapsed;
            TreeProgressRing.IsActive = true;
            EditorTextBox.IsEnabled = false;
        });

        // Setting SelectedCase triggers OnSelectedCaseChanged → FileTreeNodes update → OnFileTreeChanged
        await Model.SelectedCase.UpdateAsync(_ => selected, CancellationToken.None);
    }

    private async void FileTreeView_ItemInvoked(TreeView sender, TreeViewItemInvokedEventArgs args)
    {
        if (args.InvokedItem is not TreeViewNode tvNode) return;
        if (tvNode.Content is not FileNode node) return;
        if (node.Type != "file") return;
        if (Model is null) return;

        if (!await ConfirmDiscardIfDirtyAsync()) return;

        await Model.SelectedFile.UpdateAsync(_ => node, CancellationToken.None);
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

    // ── Unsaved changes dialog ────────────────────────────────────────

    /// <summary>
    /// Returns true if it's safe to proceed (not dirty, or user chose to discard).
    /// Returns false if the user cancelled.
    /// </summary>
    private async Task<bool> ConfirmDiscardIfDirtyAsync()
    {
        if (Model is null) return true;

        var isDirty = await Model.IsDirty;
        if (!isDirty) return true;

        var dialog = new ContentDialog
        {
            Title = "Unsaved Changes",
            Content = "You have unsaved changes. Do you want to save them before switching?",
            PrimaryButtonText = "Save",
            SecondaryButtonText = "Discard",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.XamlRoot
        };

        var result = await dialog.ShowAsync();

        return result switch
        {
            ContentDialogResult.Primary => await SaveAndContinueAsync(),
            ContentDialogResult.Secondary => true, // discard
            _ => false // cancel
        };
    }

    private async Task<bool> SaveAndContinueAsync()
    {
        if (Model is null) return false;
        try
        {
            await Model.SaveFile(CancellationToken.None);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
