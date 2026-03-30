import { useState, useEffect, useCallback, useRef } from "react";
import { fetchTemplates, createCase } from "../api";
import type { Template } from "../types";

interface StepProps {
  caseName: string | null;
  setCaseName: (name: string) => void;
  templateName: string | null;
  setTemplateName: (name: string) => void;
  goNext: () => void;
  goBack: () => void;
  completeStep: (step: number) => void;
  velocity: number;
  setVelocity: (v: number) => void;
  geometryClass: string | null;
  setGeometryClass: (c: string | null) => void;
}

// Templates without geometry get dimmed with "(soon)"
function isAvailable(t: Template): boolean {
  return t.has_geometry !== false || t.category === "verification";
}

function deriveVelocity(t: Template): number {
  // Extract velocity magnitude from template physics if available
  const physics = (t as any).physics;
  if (physics?.magUInf) return physics.magUInf;
  if (physics?.velocity) {
    const v = physics.velocity;
    if (Array.isArray(v)) return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
    if (typeof v === "number") return v;
  }
  return 20; // default
}

export default function GeometryStep({
  caseName,
  setCaseName,
  templateName,
  setTemplateName,
  goNext,
  completeStep,
  setVelocity,
}: StepProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [tutorialStatus, setTutorialStatus] = useState<Record<string, unknown>>({});
  const [retryCount, setRetryCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Load tutorial status + templates together to avoid race condition on auto-select
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      window.foamPilot?.tutorials?.getStatus()?.catch(() => ({} as Record<string, unknown>)) ?? Promise.resolve({} as Record<string, unknown>),
      fetchTemplates(),
    ])
      .then(([status, tpls]) => {
        if (cancelled) return;
        setTutorialStatus(status);
        setTemplates(tpls);
        setLoading(false);

        // Auto-select based on first-run or returning user
        if (caseName && templateName) {
          // Back navigation: restore previous selection
          setSelectedPath(templateName);
        } else if (!status.onboarding_completed) {
          // First run: select first verification tutorial
          const firstTutorial = tpls.find((t) => t.category === "verification" && isAvailable(t));
          if (firstTutorial) setSelectedPath(firstTutorial.path);
        } else {
          // Returning user: select first simulation
          const firstSim = tpls.find((t) => t.category !== "verification" && isAvailable(t));
          if (firstSim) setSelectedPath(firstSim.path);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load templates");
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group templates
  const simulations = templates.filter((t) => t.category !== "verification");
  const verification = templates.filter((t) => t.category === "verification");
  const selected = templates.find((t) => t.path === selectedPath) ?? null;
  const isFirstRun = !tutorialStatus.onboarding_completed;
  const caseAlreadyCreated = caseName !== null && templateName === selectedPath;

  const handleSelect = useCallback((t: Template) => {
    if (!isAvailable(t)) return;
    setSelectedPath(t.path);
    setCreateError(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!selected || creating) return;
    setCreating(true);
    setCreateError(null);

    // Derive case name from template path (use last segment, replace slashes)
    const caseSuffix = selected.path.split("/").pop() ?? selected.path;
    const name = caseSuffix.replace(/[^a-zA-Z0-9_-]/g, "_");

    try {
      await createCase(name, selected.path);
      setCaseName(name);
      setTemplateName(selected.path);
      setVelocity(deriveVelocity(selected));
      completeStep(0);
      goNext();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create case");
    } finally {
      setCreating(false);
    }
  }, [selected, creating, setCaseName, setTemplateName, setVelocity, completeStep, goNext]);

  const handleContinue = useCallback(() => {
    completeStep(0);
    goNext();
  }, [completeStep, goNext]);

  // Keyboard navigation
  const selectableItems = [...simulations, ...verification].filter(isAvailable);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectableItems.length) return;
      const currentIndex = selectableItems.findIndex((t) => t.path === selectedPath);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = currentIndex < selectableItems.length - 1 ? currentIndex + 1 : 0;
        setSelectedPath(selectableItems[next].path);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : selectableItems.length - 1;
        setSelectedPath(selectableItems[prev].path);
      } else if (e.key === "Enter" && selected) {
        e.preventDefault();
        if (caseAlreadyCreated) handleContinue();
        else handleCreate();
      }
    },
    [selectableItems, selectedPath, selected, caseAlreadyCreated, handleCreate, handleContinue],
  );

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="flex h-full gap-0" style={{ minHeight: 400 }}>
      {/* Left pane: template list */}
      <div
        ref={listRef}
        className="flex flex-col overflow-y-auto"
        style={{
          width: 250,
          minWidth: 200,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-sidebar)",
        }}
        role="listbox"
        aria-label="Template list"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {loading ? (
          // Skeleton rows
          <>
            <GroupHeader label="SIMULATIONS" />
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="mx-2 my-1 rounded"
                style={{ height: 28, background: "var(--bg-elevated)", opacity: 0.5, animation: "pulse 1.5s infinite" }}
              />
            ))}
            <GroupHeader label="SETUP VERIFICATION" />
            {[1, 2].map((i) => (
              <div
                key={`v${i}`}
                className="mx-2 my-1 rounded"
                style={{ height: 28, background: "var(--bg-elevated)", opacity: 0.5, animation: "pulse 1.5s infinite" }}
              />
            ))}
          </>
        ) : error ? (
          // Error state
          <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-3">
            <span style={{ fontSize: 24 }}>!</span>
            <p style={{ color: "var(--error)", fontSize: 13 }}>Could not connect to backend</p>
            <p style={{ color: "var(--fg-muted)", fontSize: 11 }}>Is Docker running?</p>
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              className="px-3 py-1 rounded"
              style={{
                background: "var(--accent)",
                color: "#09090B",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex items-center justify-center h-full px-4" style={{ color: "var(--fg-muted)", fontSize: 13 }}>
            No templates found
          </div>
        ) : (
          <>
            {/* Simulations group */}
            <GroupHeader label="SIMULATIONS" />
            {simulations.map((t) => (
              <ListItem
                key={t.path}
                template={t}
                selected={t.path === selectedPath}
                available={isAvailable(t)}
                tutorialCompleted={false}
                onClick={() => handleSelect(t)}
              />
            ))}

            {/* Setup Verification group */}
            {verification.length > 0 && (
              <>
                <GroupHeader label="SETUP VERIFICATION" />
                {verification.map((t) => (
                  <ListItem
                    key={t.path}
                    template={t}
                    selected={t.path === selectedPath}
                    available={isAvailable(t)}
                    tutorialCompleted={!!tutorialStatus[t.path.split("/").pop() ?? t.path]}
                    onClick={() => handleSelect(t)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Right pane: detail inspector */}
      <div
        className="flex-1 flex flex-col overflow-y-auto px-6 py-5"
        style={{ background: "var(--bg-editor)" }}
        aria-live="polite"
      >
        {loading ? (
          <p style={{ color: "var(--fg-muted)", fontSize: 13, textAlign: "center", marginTop: 80 }}>
            Loading templates...
          </p>
        ) : selected ? (
          <>
            {/* Template name */}
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 16,
                fontWeight: 700,
                color: "var(--fg)",
                margin: 0,
              }}
            >
              {selected.name}
            </h2>

            {/* First-run nudge */}
            {isFirstRun && selected.category === "verification" && (
              <p
                style={{
                  color: "var(--accent)",
                  fontSize: 13,
                  fontWeight: 600,
                  marginTop: 8,
                  marginBottom: 0,
                }}
              >
                First time? Start here.
              </p>
            )}

            {/* Description */}
            <p
              style={{
                color: "var(--fg)",
                fontSize: 13,
                lineHeight: 1.5,
                marginTop: 10,
              }}
            >
              {isFirstRun && selected.category === "verification"
                ? `${selected.description} Once it completes, you'll know your environment is ready for real simulations.`
                : selected.description}
            </p>

            {/* Metadata row */}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginTop: 10,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {selected.solver && (
                <span style={{ color: "var(--fg-muted)" }}>{selected.solver}</span>
              )}
              {selected.solver && selected.difficulty && (
                <span style={{ color: "var(--fg-muted)" }}>&middot;</span>
              )}
              {selected.difficulty && (
                <span
                  style={{
                    color: selected.difficulty === "beginner" ? "var(--success)" : "var(--warning)",
                  }}
                >
                  {selected.difficulty.charAt(0).toUpperCase() + selected.difficulty.slice(1)}
                </span>
              )}
              {selected.estimated_runtime && (
                <>
                  <span style={{ color: "var(--fg-muted)" }}>&middot;</span>
                  <span style={{ color: "var(--fg-muted)" }}>{selected.estimated_runtime}</span>
                </>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Action button */}
            <div style={{ marginTop: 24 }}>
              {createError && (
                <p
                  style={{
                    color: "var(--error)",
                    fontSize: 12,
                    marginBottom: 8,
                    padding: "6px 10px",
                    border: "1px solid var(--error)",
                    borderRadius: 3,
                  }}
                >
                  {createError}
                </p>
              )}
              {caseAlreadyCreated ? (
                <button
                  onClick={handleContinue}
                  style={{
                    background: "var(--accent)",
                    color: "#09090B",
                    border: "none",
                    borderRadius: 2,
                    padding: "8px 20px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Continue &#9654;
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  style={{
                    background: creating ? "var(--bg-elevated)" : "var(--accent)",
                    color: creating ? "var(--fg-disabled)" : "#09090B",
                    border: "none",
                    borderRadius: 2,
                    padding: "8px 20px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: creating ? "not-allowed" : "pointer",
                  }}
                >
                  {creating
                    ? "Creating case..."
                    : selected.category === "verification"
                      ? "Run Tutorial \u25B6"
                      : "Create Case \u25B6"}
                </button>
              )}
            </div>
          </>
        ) : (
          <p style={{ color: "var(--fg-muted)", fontSize: 13, textAlign: "center", marginTop: 80 }}>
            Select a template to see details
          </p>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function GroupHeader({ label }: { label: string }) {
  return (
    <div
      role="presentation"
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--fg-muted)",
        letterSpacing: "0.05em",
        padding: "12px 12px 4px",
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}

function ListItem({
  template,
  selected,
  available,
  tutorialCompleted,
  onClick,
}: {
  template: Template;
  selected: boolean;
  available: boolean;
  tutorialCompleted: boolean;
  onClick: () => void;
}) {
  const isVerification = template.category === "verification";

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={!available}
      aria-label={
        !available
          ? `${template.name} (coming soon)`
          : isVerification
            ? `${template.name} (${tutorialCompleted ? "completed" : "not yet run"})`
            : template.name
      }
      onClick={available ? onClick : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: "0 12px",
        fontSize: 13,
        cursor: available ? "pointer" : "default",
        color: available ? "var(--fg)" : "var(--fg-disabled)",
        background: selected ? "var(--bg-selection)" : "transparent",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 100ms ease",
      }}
      onMouseEnter={(e) => {
        if (available && !selected) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {isVerification && (
        <span style={{ fontSize: 10, lineHeight: 1 }}>
          {tutorialCompleted ? "\u25CF" : "\u25CB"}
        </span>
      )}
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {template.name}
      </span>
      {!available && (
        <span style={{ fontSize: 11, color: "var(--fg-disabled)" }}>(soon)</span>
      )}
    </div>
  );
}
