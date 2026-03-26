using System.Diagnostics;
using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public partial record CaseBrowserModel
{
    private readonly IOpenFoamApiClient _api;

    public CaseBrowserModel(IOpenFoamApiClient api)
    {
        _api = api;
    }

    public IListState<FoamCase> Cases => ListState.Async(this, async ct =>
        await _api.GetCasesAsync(ct));

    public IState<FoamCase> SelectedCase => State<FoamCase>.Empty(this);

    public IListFeed<string> Templates => ListFeed.Async(async ct =>
        await _api.GetTemplatesAsync(ct));

    public IState<string> NewCaseName => State<string>.Empty(this);

    public IState<string> SelectedTemplate => State<string>.Empty(this);

    public async ValueTask CreateCase(CancellationToken ct)
    {
        var template = await SelectedTemplate;
        var name = await NewCaseName;

        if (string.IsNullOrWhiteSpace(template) || string.IsNullOrWhiteSpace(name))
        {
            return;
        }

        await _api.CreateCaseAsync(template, name, ct);

        // Clear inputs
        await NewCaseName.UpdateAsync(_ => string.Empty, ct);

        // Refresh cases list
        var freshCases = await _api.GetCasesAsync(ct);
        await Cases.UpdateAsync(_ => freshCases, ct);
    }

    public async ValueTask CloneCase(FoamCase source, CancellationToken ct)
    {
        var newName = $"{source.Name}_copy";
        await _api.CloneCaseAsync(source.Name, newName, ct);
        var freshCases = await _api.GetCasesAsync(ct);
        await Cases.UpdateAsync(_ => freshCases, ct);
    }

    public async ValueTask DeleteCase(FoamCase target, CancellationToken ct)
    {
        await _api.DeleteCaseAsync(target.Name, ct);
        var freshCases = await _api.GetCasesAsync(ct);
        await Cases.UpdateAsync(_ => freshCases, ct);
    }

    public ValueTask OpenFolder(FoamCase target)
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                Process.Start("explorer.exe", target.Path);
            }
            else if (OperatingSystem.IsMacOS())
            {
                Process.Start("open", target.Path);
            }
            else if (OperatingSystem.IsLinux())
            {
                Process.Start("xdg-open", target.Path);
            }
        }
        catch
        {
            // Swallow process start failures silently
        }

        return ValueTask.CompletedTask;
    }
}
