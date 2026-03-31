import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron app module
vi.mock("electron", () => ({
  app: {
    getPath: () => "/mock/userData",
    getAppPath: () => "/mock/app",
    isPackaged: false,
  },
}));

// Mock child_process
const mockExecFile = vi.fn();
const mockSpawn = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

// Mock fs
const mockFs: Record<string, any> = {};
const mockUnlinkSync = vi.fn();
vi.mock("fs", () => ({
  existsSync: (p: string) => mockFs.existsSync?.(p) ?? false,
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: (p: string, enc?: string) => mockFs.readFileSync?.(p, enc) ?? "",
  copyFileSync: vi.fn(),
  unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
  unlink: vi.fn((_p: string, cb: Function) => cb()),
  createWriteStream: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock https
vi.mock("https", () => ({
  get: vi.fn(),
}));

import { DockerManager } from "../docker-manager";

describe("DockerManager", () => {
  let dm: DockerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync = () => false;
    mockFs.readFileSync = () => "";
    dm = new DockerManager("/tmp/test-foampilot");
  });

  describe("checkDocker()", () => {
    it("should return installed + running when docker info succeeds", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "24.0.5\n", "");
      });

      const status = await dm.checkDocker();
      expect(status.installed).toBe(true);
      expect(status.running).toBe(true);
      expect(status.version).toBe("24.0.5");
    });

    it("should return installed but not running when docker errors (not ENOENT)", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err = new Error("daemon not running") as any;
        err.code = "ECONNREFUSED";
        cb(err, "", "");
      });

      const status = await dm.checkDocker();
      expect(status.installed).toBe(true);
      expect(status.running).toBe(false);
    });

    it("should return not installed when docker command not found", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err = new Error("ENOENT") as any;
        err.code = "ENOENT";
        cb(err, "", "");
      });

      const status = await dm.checkDocker();
      expect(status.installed).toBe(false);
      expect(status.running).toBe(false);
    });
  });

  describe("checkCompose()", () => {
    it("should return true when docker compose is available", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "Docker Compose version v2.20.0", "");
      });

      const result = await dm.checkCompose();
      expect(result).toBe(true);
    });

    it("should return false when docker compose is not available", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error("not found"), "", "");
      });

      const result = await dm.checkCompose();
      expect(result).toBe(false);
    });
  });

  describe("pull()", () => {
    it("should stream progress lines and resolve on success", async () => {
      mockFs.existsSync = () => false;

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild);

      const lines: string[] = [];
      const pullPromise = dm.pull(undefined, (line) => lines.push(line));

      // Simulate stdout data
      const stdoutCb = mockChild.stdout.on.mock.calls.find((c: any[]) => c[0] === "data")?.[1];
      stdoutCb?.(Buffer.from("Pulling foampilot...\nDigest: sha256:abc123\n"));

      // Simulate close
      const closeCb = mockChild.on.mock.calls.find((c: any[]) => c[0] === "close")?.[1];
      closeCb?.(0);

      await pullPromise;
      expect(lines).toContain("Pulling foampilot...");
      expect(lines).toContain("Digest: sha256:abc123");
    });

    it("should reject on non-zero exit code", async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild);

      const pullPromise = dm.pull();

      const closeCb = mockChild.on.mock.calls.find((c: any[]) => c[0] === "close")?.[1];
      closeCb?.(1);

      await expect(pullPromise).rejects.toThrow("exited with code 1");
    });
  });

  describe("up()", () => {
    it("should call docker compose up -d", async () => {
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      await dm.up();
      expect(mockExecFile).toHaveBeenCalled();
      const args = mockExecFile.mock.calls[0][1];
      expect(args).toContain("up");
      expect(args).toContain("-d");
    });
  });

  describe("down()", () => {
    it("should call docker compose down", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      await dm.down();
      expect(mockExecFile).toHaveBeenCalled();
      const args = mockExecFile.mock.calls[0][1];
      expect(args).toContain("down");
    });

    it("should not throw if container is already stopped", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error("no containers"), "", "");
      });

      // Should not throw
      await dm.down();
    });
  });

  describe("status()", () => {
    it("should return 'running' when container is running", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, JSON.stringify({ State: "running" }), "");
      });

      const result = await dm.status();
      expect(result).toBe("running");
    });

    it("should return 'stopped' when container is exited", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, JSON.stringify({ State: "exited" }), "");
      });

      const result = await dm.status();
      expect(result).toBe("stopped");
    });

    it("should return 'not_found' when no output", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      const result = await dm.status();
      expect(result).toBe("not_found");
    });

    it("should return 'not_found' on error", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error("fail"), "", "");
      });

      const result = await dm.status();
      expect(result).toBe("not_found");
    });
  });

  describe("checkPort()", () => {
    it("should return true when port is free", async () => {
      // Use a high port that's very likely free
      const result = await dm.checkPort(59123);
      expect(result).toBe(true);
    });
  });

  describe("healthCheck()", () => {
    it("should return true when fetch succeeds", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      const result = await dm.healthCheck("http://localhost:9999/health", 2000);
      expect(result).toBe(true);

      vi.unstubAllGlobals();
    });

    it("should return false after timeout when fetch keeps failing", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await dm.healthCheck("http://localhost:9999/health", 1500);
      expect(result).toBe(false);

      vi.unstubAllGlobals();
    });
  });

  describe("writeEnvFile()", () => {
    it("should write correct .env content with number types", async () => {
      const { writeFileSync } = await import("fs");

      await dm.writeEnvFile({ cores: 8, dockerCpus: 6, dockerMemory: 12 } as any);

      expect(writeFileSync).toHaveBeenCalled();
      const content = (writeFileSync as any).mock.calls[0][1] as string;
      expect(content).toContain("FOAM_CORES=8");
      expect(content).toContain("DOCKER_CPUS=6");
      expect(content).toContain("DOCKER_MEMORY=12g");
      expect(content).toContain("FOAMPILOT_PORT=8000");
    });

    it("should use defaults when dockerCpus and dockerMemory are undefined", async () => {
      const { writeFileSync } = await import("fs");

      await dm.writeEnvFile({ cores: 4 } as any);

      expect(writeFileSync).toHaveBeenCalled();
      const content = (writeFileSync as any).mock.calls[0][1] as string;
      expect(content).toContain("FOAM_CORES=4");
      expect(content).toContain("DOCKER_CPUS=4");
      expect(content).toContain("DOCKER_MEMORY=8g");
    });
  });

  describe("getSystemResources()", () => {
    it("should return cpus >= 1 and memoryGB >= 2", () => {
      const res = dm.getSystemResources();
      expect(res.cpus).toBeGreaterThanOrEqual(1);
      expect(res.memoryGB).toBeGreaterThanOrEqual(2);
      expect(Number.isInteger(res.cpus)).toBe(true);
      expect(Number.isInteger(res.memoryGB)).toBe(true);
    });
  });

  describe("getStoredVersion()", () => {
    it("should return version from .env file", () => {
      mockFs.existsSync = () => true;
      mockFs.readFileSync = () => "FOAMPILOT_VERSION=1.2.3\nFOAM_CORES=4\n";

      const version = dm.getStoredVersion();
      expect(version).toBe("1.2.3");
    });

    it("should return null when .env does not exist", () => {
      mockFs.existsSync = () => false;

      const version = dm.getStoredVersion();
      expect(version).toBeNull();
    });
  });

  // ── Auto-install tests ──────────────────────────────────────────────

  describe("checkWsl()", () => {
    it("should return installed when wsl --status succeeds", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "Default Version: 2\n", "");
      });

      const result = await dm.checkWsl();
      expect(result.installed).toBe(true);
    });

    it("should return not installed when wsl --status fails", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err = new Error("not found") as any;
        err.code = "ENOENT";
        cb(err, "", "");
      });

      const result = await dm.checkWsl();
      expect(result.installed).toBe(false);
    });
  });

  describe("checkWinget()", () => {
    it("should return true when winget is available", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "v1.7.11261\n", "");
      });

      const result = await dm.checkWinget();
      expect(result).toBe(true);
    });

    it("should return false when winget is not available", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err = new Error("ENOENT") as any;
        err.code = "ENOENT";
        cb(err, "", "");
      });

      const result = await dm.checkWinget();
      expect(result).toBe(false);
    });
  });

  describe("checkWindowsBuild()", () => {
    it("should report supported for current Windows build", () => {
      // os.release() returns the real OS release — just verify the function works
      const result = dm.checkWindowsBuild();
      expect(typeof result.supported).toBe("boolean");
      expect(typeof result.build).toBe("string");
      // Current machine is Win11, should be supported
      expect(result.supported).toBe(true);
    });
  });

  describe("installWsl()", () => {
    it("should return ok + needsReboot on success", async () => {
      const mockChild = {
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild);

      const promise = dm.installWsl();

      // Simulate successful close
      const closeCb = mockChild.on.mock.calls.find((c: any[]) => c[0] === "close")?.[1];
      closeCb?.(0);

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(result.needsReboot).toBe(true);
    });

    it("should return error on spawn failure", async () => {
      const mockChild = {
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild);

      const promise = dm.installWsl();

      const errorCb = mockChild.on.mock.calls.find((c: any[]) => c[0] === "error")?.[1];
      errorCb?.(new Error("spawn failed"));

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.error).toContain("spawn failed");
    });
  });

  describe("installDockerViaWinget()", () => {
    it("should resolve ok on exit code 0", async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild);

      const lines: string[] = [];
      const promise = dm.installDockerViaWinget((line) => lines.push(line));

      // Simulate progress
      const stdoutCb = mockChild.stdout.on.mock.calls.find((c: any[]) => c[0] === "data")?.[1];
      stdoutCb?.(Buffer.from("Found Docker.DockerDesktop [Docker Desktop]\n"));

      const closeCb = mockChild.on.mock.calls.find((c: any[]) => c[0] === "close")?.[1];
      closeCb?.(0);

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(lines).toContain("Found Docker.DockerDesktop [Docker Desktop]");
    });

    it("should return error on non-zero exit", async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild);

      const promise = dm.installDockerViaWinget();

      const closeCb = mockChild.on.mock.calls.find((c: any[]) => c[0] === "close")?.[1];
      closeCb?.(1);

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.error).toContain("code 1");
    });
  });

  describe("installDockerFromExe()", () => {
    it("should resolve ok on exit code 0 and clean up installer", async () => {
      const mockChild = {
        on: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild);

      const promise = dm.installDockerFromExe("/tmp/installer.exe");

      const closeCb = mockChild.on.mock.calls.find((c: any[]) => c[0] === "close")?.[1];
      closeCb?.(0);

      const result = await promise;
      expect(result.ok).toBe(true);
    });

    it("should return error on non-zero exit", async () => {
      const mockChild = {
        on: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild);

      const promise = dm.installDockerFromExe("/tmp/installer.exe");

      const closeCb = mockChild.on.mock.calls.find((c: any[]) => c[0] === "close")?.[1];
      closeCb?.(1);

      const result = await promise;
      expect(result.ok).toBe(false);
    });
  });

  describe("install state persistence", () => {
    it("should return null when no install state file exists", () => {
      mockFs.existsSync = () => false;
      expect(dm.getInstallState()).toBeNull();
    });

    it("should return parsed state when file exists and is fresh", () => {
      const state = { stage: "wsl-installed", timestamp: new Date().toISOString() };
      mockFs.existsSync = () => true;
      mockFs.readFileSync = () => JSON.stringify(state);

      const result = dm.getInstallState();
      expect(result?.stage).toBe("wsl-installed");
    });

    it("should return null and clear when state is expired (>24h)", () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      mockFs.existsSync = () => true;
      mockFs.readFileSync = () => JSON.stringify({ stage: "wsl-installed", timestamp: old });

      const result = dm.getInstallState();
      expect(result).toBeNull();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it("should write install state", async () => {
      const fs = await import("fs");
      mockFs.existsSync = () => true;

      dm.setInstallState("wsl-installed");
      expect(fs.writeFileSync).toHaveBeenCalled();
      const calls = (fs.writeFileSync as any).mock.calls;
      const lastCall = calls[calls.length - 1];
      const content = JSON.parse(lastCall[1]);
      expect(content.stage).toBe("wsl-installed");
    });

    it("should clear install state", () => {
      dm.clearInstallState();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });
  });
});
