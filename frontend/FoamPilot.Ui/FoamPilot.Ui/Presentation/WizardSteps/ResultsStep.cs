using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace FoamPilot.Ui.Presentation.WizardSteps;

/// <summary>
/// Step 5 — Results: Show aero summary card (Cd, Cl, mesh stats, wall time),
/// ParaView launch, open folder. Warn if solver diverged.
/// </summary>
public sealed class ResultsStep : WizardStepBase
{
    public override string Title => "Results";
    public override int Index => 5;

    private StackPanel? _summaryPanel;
    private TextBlock? _warningText;
    private bool _diverged;

    public ResultsStep(HttpClient http, AppConfig config) : base(http, config) { }

    public void SetDiverged(bool diverged) => _diverged = diverged;

    public override Panel CreateUI()
    {
        var root = new StackPanel { Spacing = 12 };

        var header = new TextBlock
        {
            Text = "Simulation Results",
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        };
        root.Children.Add(header);

        // Warning banner (hidden by default)
        _warningText = new TextBlock
        {
            Text = "⚠️ The solver may not have fully converged. Residuals were still above the typical threshold. Results may not be accurate — check the convergence plot on the previous step.",
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Orange),
            Padding = new Thickness(12),
            Visibility = Visibility.Collapsed,
        };
        root.Children.Add(_warningText);

        // Summary card
        _summaryPanel = new StackPanel
        {
            Padding = new Thickness(16),
            Spacing = 8,
            BorderBrush = new SolidColorBrush(Microsoft.UI.Colors.DimGray),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
        };
        _summaryPanel.Children.Add(new TextBlock
        {
            Text = "Loading results...",
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
        });
        root.Children.Add(_summaryPanel);

        // Action buttons
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Margin = new Thickness(0, 8, 0, 0) };

        var paraviewBtn = new Button
        {
            Content = "Open in ParaView",
            Style = Application.Current.Resources["AccentButtonStyle"] as Style,
        };
        paraviewBtn.Click += async (_, _) => await OpenParaView();
        buttons.Children.Add(paraviewBtn);

        var folderBtn = new Button { Content = "Open Case Folder" };
        folderBtn.Click += (_, _) => OpenCaseFolder();
        buttons.Children.Add(folderBtn);

        root.Children.Add(buttons);

        // Success message
        root.Children.Add(new TextBlock
        {
            Text = "🎉 Your simulation is complete! Open in ParaView to explore pressure fields, streamlines, and flow visualization.",
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            Margin = new Thickness(0, 12, 0, 0),
        });

        return root;
    }

    public override async Task OnEnterAsync()
    {
        if (_warningText is not null)
            _warningText.Visibility = _diverged ? Visibility.Visible : Visibility.Collapsed;

        await LoadResultsSummary();
    }

    private async Task LoadResultsSummary()
    {
        if (_summaryPanel is null || CaseName is null) return;
        _summaryPanel.Children.Clear();

        var title = new TextBlock
        {
            Text = "Aerodynamic Results",
            FontSize = 16,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 8),
        };
        _summaryPanel.Children.Add(title);

        // Try to load aero results from backend
        try
        {
            var resp = await Http.GetAsync($"/cases/{CaseName}/results");
            if (resp.IsSuccessStatusCode)
            {
                var json = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                AddResultRow("Drag Coefficient (Cd)", root, "cd", "{0:F4}");
                AddResultRow("Lift Coefficient (Cl)", root, "cl", "{0:F4}");
                AddResultRow("Moment Coefficient (Cm)", root, "cm", "{0:F4}");
                AddResultRow("Pressure Drag (Cd_p)", root, "cd_pressure", "{0:F4}");
                AddResultRow("Viscous Drag (Cd_v)", root, "cd_viscous", "{0:F4}");
                AddResultRow("Iterations", root, "iterations", "{0:N0}");
                AddResultRow("Wall Time", root, "wall_time_seconds", null, formatAsTime: true);
            }
            else
            {
                _summaryPanel.Children.Add(new TextBlock
                {
                    Text = "No aerodynamic data available. The solver may not have been configured to output force coefficients.",
                    Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
                    TextWrapping = TextWrapping.Wrap,
                });
            }
        }
        catch
        {
            _summaryPanel.Children.Add(new TextBlock
            {
                Text = "Could not load results from backend.",
                Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed),
            });
        }

        // Also try mesh quality
        try
        {
            var meshResp = await Http.GetAsync($"/cases/{CaseName}/mesh-quality");
            if (meshResp.IsSuccessStatusCode)
            {
                var json = await meshResp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                _summaryPanel.Children.Add(new Border
                {
                    Height = 1,
                    Background = new SolidColorBrush(Microsoft.UI.Colors.DimGray),
                    Margin = new Thickness(0, 8, 0, 8),
                });

                var meshTitle = new TextBlock
                {
                    Text = "Mesh Statistics",
                    FontSize = 14,
                    FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                    Margin = new Thickness(0, 0, 0, 4),
                };
                _summaryPanel.Children.Add(meshTitle);
                AddResultRow("Cells", root, "cells", "{0:N0}");
                AddResultRow("Faces", root, "faces", "{0:N0}");
                AddResultRow("Points", root, "points", "{0:N0}");
            }
        }
        catch { }
    }

    private void AddResultRow(string label, JsonElement root, string prop, string? format, bool formatAsTime = false)
    {
        if (_summaryPanel is null) return;
        if (!root.TryGetProperty(prop, out var val)) return;

        string valueStr;
        if (formatAsTime && val.TryGetDouble(out var seconds))
        {
            var ts = TimeSpan.FromSeconds(seconds);
            valueStr = ts.TotalHours >= 1 ? $"{ts:h\\:mm\\:ss}" : $"{ts:m\\:ss}";
        }
        else if (val.ValueKind == JsonValueKind.Number && format is not null)
        {
            valueStr = string.Format(format, val.GetDouble());
        }
        else if (val.ValueKind == JsonValueKind.Null)
        {
            return; // Skip null values
        }
        else
        {
            valueStr = val.ToString();
        }

        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(200) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var labelText = new TextBlock
        {
            Text = label,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
        };
        Grid.SetColumn(labelText, 0);
        row.Children.Add(labelText);

        var valueText = new TextBlock
        {
            Text = valueStr,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            FontFamily = new FontFamily("Cascadia Code, Consolas, monospace"),
        };
        Grid.SetColumn(valueText, 1);
        row.Children.Add(valueText);

        _summaryPanel.Children.Add(row);
    }

    private async Task OpenParaView()
    {
        if (CaseName is null) return;
        var casePath = System.IO.Path.Combine(Config.LocalCasesPath, CaseName);
        var foamFile = System.IO.Path.Combine(casePath, $"{CaseName}.foam");

        // Create .foam file if missing
        if (!System.IO.File.Exists(foamFile))
        {
            try
            {
                await Http.PostAsync($"/cases/{CaseName}/ensure-foam", null);
                // Also create locally in case volume mount is slow
                System.IO.File.WriteAllText(foamFile, "");
            }
            catch { }
        }

        if (!System.IO.File.Exists(Config.ParaViewPath))
        {
            // ParaView not found — show message
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = Config.ParaViewPath,
            Arguments = $"\"{foamFile}\"",
            UseShellExecute = true,
        });
    }

    private void OpenCaseFolder()
    {
        if (CaseName is null) return;
        var casePath = System.IO.Path.Combine(Config.LocalCasesPath, CaseName);
        if (System.IO.Directory.Exists(casePath))
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = $"\"{casePath}\"",
                UseShellExecute = true,
            });
        }
    }
}
