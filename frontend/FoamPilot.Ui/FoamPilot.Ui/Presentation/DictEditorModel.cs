using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public partial record DictEditorModel
{
    private readonly IOpenFoamApiClient _api;

    public DictEditorModel(IOpenFoamApiClient api)
    {
        _api = api;

        SelectedFile.ForEachAsync(OnSelectedFileChanged);
    }

    // ── Feeds & States ───────────────────────────────────────────────

    public IListFeed<FoamCase> Cases => ListFeed.Async(async ct => await _api.GetCasesAsync(ct));

    public IState<FoamCase> SelectedCase => State<FoamCase>.Empty(this);

    public IListFeed<FileNode> FileTree => SelectedCase
        .SelectAsync(async (c, ct) =>
        {
            if (c is null) return ImmutableList<FileNode>.Empty;
            return await _api.GetFileTreeAsync(c.Name, ct);
        })
        .AsListFeed();

    public IState<FileNode> SelectedFile => State<FileNode>.Empty(this);

    public IState<string> FileContent => State<string>.Empty(this);

    public IState<string> OriginalContent => State<string>.Empty(this);

    public IFeed<bool> IsDirty => FileContent
        .CombineAsync(OriginalContent, (current, original) =>
            !string.Equals(current, original, StringComparison.Ordinal));

    public IState<string> ValidationWarning => State<string>.Empty(this);

    // ── File selection handler ────────────────────────────────────────

    private async ValueTask OnSelectedFileChanged(FileNode? file, CancellationToken ct)
    {
        if (file is null || file.Type != "file") return;

        var selectedCase = await SelectedCase;
        if (selectedCase is null) return;

        var content = await _api.GetFileContentAsync(selectedCase.Name, file.Path, ct);
        await OriginalContent.SetAsync(content, ct);
        await FileContent.SetAsync(content, ct);
        await ValidationWarning.SetAsync(string.Empty, ct);
    }

    // ── Commands ─────────────────────────────────────────────────────

    public async ValueTask SaveFile(CancellationToken ct)
    {
        var selectedCase = await SelectedCase;
        var selectedFile = await SelectedFile;
        var content = await FileContent ?? string.Empty;

        if (selectedCase is null || selectedFile is null) return;

        // Brace validation - warn but allow save
        var warning = ValidateBraces(content);
        await ValidationWarning.SetAsync(warning, ct);

        await _api.SaveFileContentAsync(selectedCase.Name, selectedFile.Path, content, ct);
        await OriginalContent.SetAsync(content, ct);
    }

    public async ValueTask RevertFile(CancellationToken ct)
    {
        var original = await OriginalContent ?? string.Empty;
        await FileContent.SetAsync(original, ct);
        await ValidationWarning.SetAsync(string.Empty, ct);
    }

    // ── Brace validation ─────────────────────────────────────────────

    private static string ValidateBraces(string text)
    {
        int curly = 0, paren = 0;
        foreach (var ch in text)
        {
            switch (ch)
            {
                case '{': curly++; break;
                case '}': curly--; break;
                case '(': paren++; break;
                case ')': paren--; break;
            }
        }

        var warnings = new List<string>();
        if (curly != 0) warnings.Add($"Curly braces unbalanced ({{}} off by {Math.Abs(curly)})");
        if (paren != 0) warnings.Add($"Parentheses unbalanced (() off by {Math.Abs(paren)})");
        return string.Join("; ", warnings);
    }
}
