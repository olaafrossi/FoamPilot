// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import SettingsPage from "../SettingsPage";

// ── Mock the api module ─────────────────────────────────────────
vi.mock("../../api", () => ({
  getConfig: () => ({
    backendUrl: "http://localhost:8000",
    localCasesPath: "/cases",
    paraViewPath: "/usr/bin/paraview",
    cores: 4,
    dockerCpus: 8,
    dockerMemory: 16,
  }),
  setConfig: vi.fn(),
  syncCoresFromBackend: () => Promise.resolve(null),
}));

// ── Helpers ─────────────────────────────────────────────────────

function mockFoamPilot(overrides: Partial<typeof window.foamPilot> = {}) {
  const base = {
    getConfig: () => Promise.resolve({
      backendUrl: "http://localhost:8000",
      localCasesPath: "/cases",
      paraViewPath: "/usr/bin/paraview",
      cores: 4,
      dockerCpus: 8,
      dockerMemory: 16,
    }),
    saveConfig: vi.fn().mockResolvedValue({ ok: true }),
    openParaView: vi.fn(),
    openFolder: vi.fn(),
    selectFile: vi.fn(),
    readFile: vi.fn(),
    showNotification: vi.fn(),
    tutorials: {
      getStatus: vi.fn().mockResolvedValue({}),
      setCompleted: vi.fn().mockResolvedValue(true),
    },
    docker: {
      getStatus: vi.fn().mockResolvedValue({ container: "running", version: "24.0.0" }),
      pull: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      ensureSetup: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true),
      ping: vi.fn(),
      diagnostics: vi.fn(),
      getSystemResources: vi.fn().mockResolvedValue({ cpus: 16, memoryGB: 32 }),
      updateResources: vi.fn(),
      onProgress: vi.fn().mockReturnValue(() => {}),
      onStatusChange: vi.fn().mockReturnValue(() => {}),
      checkWsl: vi.fn(),
      checkWinget: vi.fn(),
      checkWindowsBuild: vi.fn(),
      installWsl: vi.fn(),
      installDocker: vi.fn(),
      startDesktop: vi.fn(),
      getInstallState: vi.fn(),
      clearInstallState: vi.fn(),
      onInstallProgress: vi.fn().mockReturnValue(() => {}),
    },
    updates: {
      check: vi.fn().mockResolvedValue({ container: null, app: null }),
      applyContainer: vi.fn(),
      getAppVersion: vi.fn().mockResolvedValue("0.0.4"),
      onAvailable: vi.fn().mockReturnValue(() => {}),
      onDownloaded: vi.fn().mockReturnValue(() => {}),
    },
    ...overrides,
  };

  (window as any).foamPilot = base;
  return base;
}

// ── Tests ───────────────────────────────────────────────────────

describe("SettingsPage — Updates Section", () => {
  beforeEach(() => {
    mockFoamPilot();
  });

  afterEach(() => {
    cleanup();
    delete (window as any).foamPilot;
  });

  it("should display app version", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("0.0.4")).toBeTruthy();
    });
  });

  it("should show 'up to date' when no app update available", async () => {
    const fp = mockFoamPilot();
    fp.updates.check = vi.fn().mockResolvedValue({
      container: null,
      app: { available: false, current: "0.0.4", latest: "0.0.4" },
    });

    render(<SettingsPage />);

    const button = screen.getByText("Check for Updates");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("App is up to date")).toBeTruthy();
    });
  });

  it("should show update banner when app update available", async () => {
    const fp = mockFoamPilot();
    fp.updates.check = vi.fn().mockResolvedValue({
      container: null,
      app: {
        available: true,
        current: "0.0.4",
        latest: "0.0.5",
        downloadUrl: "https://github.com/olaafrossi/FoamPilot/releases/tag/v0.0.5",
      },
    });

    render(<SettingsPage />);

    const button = screen.getByText("Check for Updates");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/App update available/)).toBeTruthy();
      expect(screen.getByText("View on GitHub")).toBeTruthy();
    });
  });

  it("should show error message when update check fails", async () => {
    const fp = mockFoamPilot();
    fp.updates.check = vi.fn().mockRejectedValue(new Error("network error"));

    render(<SettingsPage />);

    const button = screen.getByText("Check for Updates");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Could not check for updates")).toBeTruthy();
    });
  });

  it("should show error when both checks return null", async () => {
    const fp = mockFoamPilot();
    fp.updates.check = vi.fn().mockResolvedValue({
      container: null,
      app: null,
    });

    render(<SettingsPage />);

    const button = screen.getByText("Check for Updates");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Could not check for updates")).toBeTruthy();
    });
  });

  it("should show container update banner alongside app status", async () => {
    const fp = mockFoamPilot();
    fp.updates.check = vi.fn().mockResolvedValue({
      container: { available: true, current: "0.0.3", latest: "0.0.5" },
      app: { available: false, current: "0.0.5", latest: "0.0.5" },
    });

    render(<SettingsPage />);

    const button = screen.getByText("Check for Updates");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("App is up to date")).toBeTruthy();
      expect(screen.getByText(/Container update available/)).toBeTruthy();
    });
  });
});
