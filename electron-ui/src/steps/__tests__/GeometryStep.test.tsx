// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import GeometryStep from "../GeometryStep";
import type { Template } from "../../types";

// ── Mock data ─────────────────────────────────────────────────────

const AIRFOIL: Template = {
  name: "2D Airfoil",
  path: "airFoil2D",
  description: "Pre-meshed NACA airfoil",
  steps: [],
  difficulty: "beginner",
  solver: "simpleFoam",
  category: "aero",
  has_geometry: true,
  estimated_runtime: "~2 min",
};

const RACE_CAR: Template = {
  name: "Race Car",
  path: "raceCar",
  description: "Ground vehicle aero",
  steps: [],
  difficulty: "intermediate",
  solver: "simpleFoam",
  category: "aero",
  has_geometry: false,
};

const TUTORIAL_AIRFOIL: Template = {
  name: "2D Airfoil (Tutorial)",
  path: "tutorials/incompressible/simpleFoam/airFoil2D",
  description: "Stock OpenFOAM tutorial",
  steps: [],
  difficulty: "beginner",
  solver: "simpleFoam",
  category: "verification",
  has_geometry: false,
  estimated_runtime: "1-3 minutes",
};

const TUTORIAL_MOTORBIKE: Template = {
  name: "Motorbike (Tutorial)",
  path: "tutorials/incompressible/simpleFoam/motorBike",
  description: "Stock motorbike tutorial",
  steps: [],
  difficulty: "intermediate",
  solver: "simpleFoam",
  category: "verification",
  has_geometry: true,
};

const ALL_TEMPLATES = [AIRFOIL, RACE_CAR, TUTORIAL_AIRFOIL, TUTORIAL_MOTORBIKE];

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("../../api", () => ({
  fetchTemplates: vi.fn(),
  createCase: vi.fn(),
}));

import { fetchTemplates, createCase } from "../../api";

const mockFetch = fetchTemplates as Mock;
const mockCreate = createCase as Mock;
const mockGetStatus = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockCreate.mockReset();
  mockGetStatus.mockReset();
  mockFetch.mockResolvedValue(ALL_TEMPLATES);
  mockCreate.mockResolvedValue(undefined);
  mockGetStatus.mockResolvedValue({});

  // @ts-expect-error -- partial mock
  window.foamPilot = { tutorials: { getStatus: mockGetStatus, setCompleted: vi.fn() } };
});

afterEach(cleanup);

function props(overrides: Record<string, unknown> = {}) {
  return {
    caseName: null as string | null,
    setCaseName: vi.fn(),
    templateName: null as string | null,
    setTemplateName: vi.fn(),
    goNext: vi.fn(),
    goBack: vi.fn(),
    completeStep: vi.fn(),
    velocity: 20,
    setVelocity: vi.fn(),
    geometryClass: null as string | null,
    setGeometryClass: vi.fn(),
    ...overrides,
  };
}

/** Wait for the template list to finish loading. */
async function waitForLoaded() {
  await waitFor(() => expect(screen.queryByText("Loading templates...")).not.toBeInTheDocument());
}

// ── Tests ─────────────────────────────────────────────────────────

describe("GeometryStep", () => {
  // ── Loading ─────────────────────────────────────────────────────

  it("shows skeleton rows and 'Loading templates...' while fetching", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<GeometryStep {...props()} />);
    expect(screen.getByText("SIMULATIONS")).toBeInTheDocument();
    expect(screen.getByText("SETUP VERIFICATION")).toBeInTheDocument();
    expect(screen.getByText("Loading templates...")).toBeInTheDocument();
  });

  // ── Error ───────────────────────────────────────────────────────

  it("shows error and Docker hint when fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));
    render(<GeometryStep {...props()} />);
    await waitFor(() => expect(screen.getByText("Could not connect to backend")).toBeInTheDocument());
    expect(screen.getByText("Is Docker running?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("retries on Retry click and shows templates on success", async () => {
    // First load fails (Promise.all rejects because fetchTemplates rejects)
    mockFetch.mockRejectedValueOnce(new Error("fail"));
    render(<GeometryStep {...props()} />);
    await waitFor(() => screen.getByRole("button", { name: "Retry" }));

    // Set up success for next load. getStatus is still mocked from beforeEach.
    mockFetch.mockResolvedValue(ALL_TEMPLATES);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });

    await waitForLoaded();
    expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(1);
  });

  // ── Empty ───────────────────────────────────────────────────────

  it("shows 'No templates found' for empty list", async () => {
    mockFetch.mockResolvedValue([]);
    render(<GeometryStep {...props()} />);
    await waitFor(() => expect(screen.getByText("No templates found")).toBeInTheDocument());
  });

  // ── Template list ───────────────────────────────────────────────

  it("renders both group headers and all template items", async () => {
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(screen.getByText("SIMULATIONS")).toBeInTheDocument();
    expect(screen.getByText("SETUP VERIFICATION")).toBeInTheDocument();
  });

  it("shows (soon) suffix for templates without geometry", async () => {
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(screen.getByText("(soon)")).toBeInTheDocument();
  });

  it("marks unavailable templates with aria-disabled", async () => {
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    const disabled = screen.getByRole("option", { name: /coming soon/ });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
  });

  // ── First-run auto-select ───────────────────────────────────────

  it("auto-selects first verification tutorial on first run", async () => {
    mockGetStatus.mockResolvedValue({}); // no onboarding flag
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(screen.getByText("First time? Start here.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2D Airfoil (Tutorial)" })).toBeInTheDocument();
  });

  it("auto-selects first simulation for returning user", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(screen.getByRole("heading", { name: "2D Airfoil" })).toBeInTheDocument();
    expect(screen.queryByText("First time? Start here.")).not.toBeInTheDocument();
  });

  // ── Selection ───────────────────────────────────────────────────

  it("selects a template on click and updates detail pane", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    render(<GeometryStep {...props()} />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("option", { name: /Motorbike \(Tutorial\)/ }));
    expect(screen.getByRole("heading", { name: "Motorbike (Tutorial)" })).toBeInTheDocument();
  });

  it("ignores click on disabled templates", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    render(<GeometryStep {...props()} />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("option", { name: /coming soon/ }));
    // Still shows original auto-selected template
    expect(screen.getByRole("heading", { name: "2D Airfoil" })).toBeInTheDocument();
  });

  // ── Detail pane ─────────────────────────────────────────────────

  it("shows solver, difficulty, and runtime in metadata row", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(screen.getByText("simpleFoam")).toBeInTheDocument();
    expect(screen.getByText("Beginner")).toBeInTheDocument();
    expect(screen.getByText("~2 min")).toBeInTheDocument();
  });

  it("shows 'Run Tutorial' button for verification templates", async () => {
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(screen.getByRole("button", { name: /Run Tutorial/ })).toBeInTheDocument();
  });

  it("shows 'Create Case' button for simulation templates", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(screen.getByRole("button", { name: /Create Case/ })).toBeInTheDocument();
  });

  it("shows empty detail pane when no selectable template exists", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    mockFetch.mockResolvedValue([RACE_CAR]); // only unavailable
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(screen.getByText("Select a template to see details")).toBeInTheDocument();
  });

  // ── Create case ─────────────────────────────────────────────────

  it("calls createCase and advances wizard on button click", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    const p = props();
    render(<GeometryStep {...p} />);
    await waitForLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create Case/ }));
    });

    expect(mockCreate).toHaveBeenCalledWith("airFoil2D", "airFoil2D");
    expect(p.setCaseName).toHaveBeenCalledWith("airFoil2D");
    expect(p.setTemplateName).toHaveBeenCalledWith("airFoil2D");
    expect(p.completeStep).toHaveBeenCalledWith(0);
    expect(p.goNext).toHaveBeenCalled();
  });

  it("shows error when createCase fails", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    mockCreate.mockRejectedValue(new Error("Case already exists"));
    render(<GeometryStep {...props()} />);
    await waitForLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create Case/ }));
    });

    expect(screen.getByText("Case already exists")).toBeInTheDocument();
  });

  it("sets velocity from template metadata on create", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    const p = props();
    render(<GeometryStep {...p} />);
    await waitForLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create Case/ }));
    });

    expect(p.setVelocity).toHaveBeenCalledWith(20);
  });

  // ── Back navigation ─────────────────────────────────────────────

  it("shows Continue button when case already created", async () => {
    render(<GeometryStep {...props({ caseName: "airFoil2D", templateName: "airFoil2D" })} />);
    await waitForLoaded();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeInTheDocument();
  });

  it("Continue advances without calling createCase", async () => {
    const p = props({ caseName: "airFoil2D", templateName: "airFoil2D" });
    render(<GeometryStep {...p} />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(p.completeStep).toHaveBeenCalledWith(0);
    expect(p.goNext).toHaveBeenCalled();
  });

  // ── Tutorial status ─────────────────────────────────────────────

  it("reads tutorial status via IPC on mount", () => {
    render(<GeometryStep {...props()} />);
    expect(mockGetStatus).toHaveBeenCalled();
  });

  it("shows open circle for incomplete tutorials", async () => {
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    const option = screen.getByRole("option", { name: /2D Airfoil \(Tutorial\).*not yet run/ });
    expect(option.textContent).toContain("\u25CB");
  });

  it("shows filled circle for completed tutorials", async () => {
    mockGetStatus.mockResolvedValue({ airFoil2D: true });
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    const option = screen.getByRole("option", { name: /2D Airfoil \(Tutorial\).*completed/ });
    expect(option.textContent).toContain("\u25CF");
  });

  // ── Keyboard ────────────────────────────────────────────────────

  it("ArrowDown moves selection to next available item", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    // Auto-selected: 2D Airfoil. ArrowDown should skip Race Car (disabled) -> Tutorial Airfoil
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "2D Airfoil (Tutorial)" })).toBeInTheDocument();
  });

  it("ArrowUp wraps from first to last item", async () => {
    mockGetStatus.mockResolvedValue({ onboarding_completed: true });
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowUp" });
    expect(screen.getByRole("heading", { name: "Motorbike (Tutorial)" })).toBeInTheDocument();
  });

  // ── Accessibility ───────────────────────────────────────────────

  it("has listbox with aria-label on template list", async () => {
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-label", "Template list");
  });

  it("renders correct number of option roles", async () => {
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("has aria-live region in detail pane", async () => {
    render(<GeometryStep {...props()} />);
    await waitForLoaded();
    expect(document.querySelector("[aria-live='polite']")).not.toBeNull();
  });
});
