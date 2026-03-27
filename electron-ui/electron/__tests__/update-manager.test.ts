import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/mock/userData",
    getAppPath: () => "/mock/app",
  },
}));

// Mock child_process (needed by DockerManager import)
vi.mock("child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: () => false,
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: () => "FOAMPILOT_VERSION=1.0.0\n",
  copyFileSync: vi.fn(),
}));

import { UpdateManager } from "../update-manager";
import { DockerManager } from "../docker-manager";

describe("UpdateManager", () => {
  let dm: DockerManager;
  let um: UpdateManager;

  beforeEach(() => {
    vi.clearAllMocks();
    dm = new DockerManager("/tmp/test-foampilot");
    um = new UpdateManager(dm);
  });

  describe("checkForContainerUpdate()", () => {
    it("should detect when a newer version is available", async () => {
      vi.spyOn(dm, "getStoredVersion").mockReturnValue("1.0.0");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v1.1.0" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await um.checkForContainerUpdate();
      expect(result).not.toBeNull();
      expect(result!.available).toBe(true);
      expect(result!.current).toBe("1.0.0");
      expect(result!.latest).toBe("1.1.0");

      vi.unstubAllGlobals();
    });

    it("should return not available when already on latest", async () => {
      vi.spyOn(dm, "getStoredVersion").mockReturnValue("1.1.0");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v1.1.0" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await um.checkForContainerUpdate();
      expect(result).not.toBeNull();
      expect(result!.available).toBe(false);

      vi.unstubAllGlobals();
    });

    it("should return null on API error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      vi.stubGlobal("fetch", mockFetch);

      const result = await um.checkForContainerUpdate();
      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it("should return null on network error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await um.checkForContainerUpdate();
      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it("should emit container-update-available event when update found", async () => {
      vi.spyOn(dm, "getStoredVersion").mockReturnValue("1.0.0");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v2.0.0" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const handler = vi.fn();
      um.on("container-update-available", handler);

      await um.checkForContainerUpdate();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ available: true, latest: "2.0.0" }),
      );

      vi.unstubAllGlobals();
    });
  });

  describe("applyContainerUpdate()", () => {
    it("should pull new image, stop old container, and start new one", async () => {
      const pullSpy = vi.spyOn(dm, "pull").mockResolvedValue();
      const downSpy = vi.spyOn(dm, "down").mockResolvedValue();
      const upSpy = vi.spyOn(dm, "up").mockResolvedValue();

      await um.applyContainerUpdate("1.2.0");

      expect(pullSpy).toHaveBeenCalledWith("1.2.0", undefined);
      expect(downSpy).toHaveBeenCalled();
      expect(upSpy).toHaveBeenCalled();

      // Verify order: pull → down → up
      const pullOrder = pullSpy.mock.invocationCallOrder[0];
      const downOrder = downSpy.mock.invocationCallOrder[0];
      const upOrder = upSpy.mock.invocationCallOrder[0];
      expect(pullOrder).toBeLessThan(downOrder);
      expect(downOrder).toBeLessThan(upOrder);
    });
  });

  describe("checkForElectronUpdate()", () => {
    it("should not throw when app is not packaged", () => {
      // app.isPackaged is false in our mock, so this should be a no-op
      expect(() => um.checkForElectronUpdate()).not.toThrow();
    });
  });

  describe("version comparison", () => {
    it("should detect 1.1.0 > 1.0.0", async () => {
      vi.spyOn(dm, "getStoredVersion").mockReturnValue("1.0.0");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v1.1.0" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await um.checkForContainerUpdate();
      expect(result!.available).toBe(true);
      vi.unstubAllGlobals();
    });

    it("should detect 1.0.1 > 1.0.0", async () => {
      vi.spyOn(dm, "getStoredVersion").mockReturnValue("1.0.0");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v1.0.1" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await um.checkForContainerUpdate();
      expect(result!.available).toBe(true);
      vi.unstubAllGlobals();
    });

    it("should not flag 1.0.0 > 1.0.0", async () => {
      vi.spyOn(dm, "getStoredVersion").mockReturnValue("1.0.0");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v1.0.0" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await um.checkForContainerUpdate();
      expect(result!.available).toBe(false);
      vi.unstubAllGlobals();
    });
  });
});
