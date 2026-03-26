# TODOS

## Tier 2 Validation Rules
**Priority:** High | **Effort:** human: ~3 days / CC: ~1 hour
**What:** Implement patch name matching (parse `constant/polyMesh/boundary` after meshing, compare against 0/ boundary conditions) and solver-field compatibility table.
**Why:** Tier 1 catches syntax errors; Tier 2 catches the semantic errors that actually waste students' time — boundary conditions referencing non-existent patches, and solver/field mismatches.
**Context:** Deferred from the wizard PR because the OpenFOAM boundary file parsing needs careful design. Boundary file format varies across OpenFOAM versions. Start by instrumenting which validation failures students hit with Tier 1 to prioritize which Tier 2 rules matter most.
**Depends on:** Pipeline engine must ship first. Tier 2 validates against state that Tier 1 creates.

## DictEditor Refactor to Reusable UserControl
**Priority:** Medium | **Effort:** human: ~1 week / CC: ~30 min
**What:** Extract DictEditorPage into a reusable UserControl that can be embedded in other pages (wizard, future compare view, template editor).
**Why:** The wizard uses a simpler inline editor that duplicates some DictEditor functionality. When file editing appears in a 3rd place, the duplication becomes unmaintainable.
**Context:** Deferred from the wizard PR to avoid risky refactor. Currently tightly coupled to navigation context, DI, case selection, and dialog patterns. The reflection-based GetModel() pattern in code-behind makes extraction harder.
**Trigger:** When file editing is needed in a 3rd location beyond DictEditor page and wizard.
**Depends on:** Wizard ships first. GetModel() reflection cleanup (below) is a nice-to-have prerequisite.

## Replace Reflection-Based GetModel() Pattern
**Priority:** Low | **Effort:** human: ~2 hours / CC: ~10 min
**What:** Replace `DataContext?.GetType().GetProperty("Model")?.GetValue(DataContext) as XModel` with a typed base class or interface across all page code-behind files.
**Why:** Runtime reflection with silent null return — no compile-time safety. Used in LogsPage, SettingsPage, DictEditorPage, RunControlPage, and will be used in WizardPage.
**Context:** Pre-existing tech debt. Needs investigation into Uno MVUX internals to find the correct typed accessor pattern. May require changes to all 6+ page code-behind files.
**Depends on:** Nothing. Can be done independently.
