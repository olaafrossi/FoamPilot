import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}));

// Mock child_process
vi.mock("child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    cb(null, "", "");
  }),
  spawn: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { DockerManager } from "../docker-manager";
import { UpdateManager } from "../update-manager";

describe("UpdateManager", () => {
  let dataDir: string;
  let dockerManager: DockerManager;
  let updateManager: UpdateManager;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "foampilot-update-test-"));
    dockerManager = new DockerManager(dataDir);
    updateManager = new UpdateManager(dockerManager);
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe("checkForContainerUpdate", () => {
    it("returns update available when newer version exists", async () => {
      // Write current version
      await dockerManager.writeEnvFile({
        foampilotVersion: "1.0.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: "v1.1.0" }),
      });

      const result = await updateManager.checkForContainerUpdate();
      expect(result).not.toBeNull();
      expect(result!.available).toBe(true);
      expect(result!.current).toBe("1.0.0");
      expect(result!.latest).toBe("1.1.0");
    });

    it("returns not available when already on latest", async () => {
      await dockerManager.writeEnvFile({
        foampilotVersion: "1.1.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: "v1.1.0" }),
      });

      const result = await updateManager.checkForContainerUpdate();
      expect(result).not.toBeNull();
      expect(result!.available).toBe(false);
    });

    it("returns available when current is 'latest'", async () => {
      await dockerManager.writeEnvFile({
        foampilotVersion: "latest",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: "v1.0.0" }),
      });

      const result = await updateManager.checkForContainerUpdate();
      expect(result).not.toBeNull();
      expect(result!.available).toBe(true);
    });

    it("returns null on API error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await updateManager.checkForContainerUpdate();
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await updateManager.checkForContainerUpdate();
      expect(result).toBeNull();
    });

    it("emits container-update-available event when update found", async () => {
      await dockerManager.writeEnvFile({
        foampilotVersion: "1.0.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: "v2.0.0" }),
      });

      const handler = vi.fn();
      updateManager.on("container-update-available", handler);

      await updateManager.checkForContainerUpdate();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ available: true, latest: "2.0.0" }),
      );
    });
  });

  describe("checkForElectronUpdate", () => {
    it("does not crash when app is not packaged", () => {
      // app.isPackaged is false in our mock, so this should be a no-op
      expect(() => updateManager.checkForElectronUpdate()).not.toThrow();
    });
  });

  describe("semver comparison (via checkForContainerUpdate)", () => {
    const testCases = [
      { current: "1.0.0", latest: "1.0.1", expected: true },
      { current: "1.0.0", latest: "1.1.0", expected: true },
      { current: "1.0.0", latest: "2.0.0", expected: true },
      { current: "2.0.0", latest: "1.0.0", expected: false },
      { current: "1.1.0", latest: "1.0.9", expected: false },
      { current: "1.0.0", latest: "1.0.0", expected: false },
    ];

    for (const { current, latest, expected } of testCases) {
      it(`${current} → ${latest} should ${expected ? "" : "not "}be an update`, async () => {
        await dockerManager.writeEnvFile({
          foampilotVersion: current,
          foampilotPort: 8000,
          foamCores: 4,
          dockerCpus: 4,
          dockerMemory: "8g",
          casesPath: "/cases",
          templatesPath: "/templates",
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: `v${latest}` }),
        });

        const result = await updateManager.checkForContainerUpdate();
        expect(result!.available).toBe(expected);
      });
    }
  });
});
