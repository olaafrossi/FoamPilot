using FoamPilot.Ui.Services;

namespace FoamPilot.Ui.Presentation;

public partial record CasesModel
{
    private readonly IOpenFoamApiClient _api;

    public CasesModel(IOpenFoamApiClient api)
    {
        _api = api;
    }

    public IListFeed<FoamCase> Cases => ListFeed.Async(async ct =>
        await _api.GetCasesAsync(ct));
}
