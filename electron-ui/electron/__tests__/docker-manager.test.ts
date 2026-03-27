import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock electron's app module before importing DockerManager
vi.mock("electron", () => ({
  app: {
    getPath: () => os.tmpdir(),
  },
}));

// Mock child_process
const mockExecFile = vi.fn();
const mockSpawn = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import { DockerManager } from "../docker-manager";

describe("DockerManager", () => {
  let manager: DockerManager;
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "foampilot-test-"));
    manager = new DockerManager(dataDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe("checkDocker", () => {
    it("returns installed + running when docker info succeeds", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "24.0.7\n", "");
      });

      const status = await manager.checkDocker();
      expect(status.installed).toBe(true);
      expect(status.running).toBe(true);
      expect(status.version).toBe("24.0.7");
    });

    it("returns not installed when docker binary not found", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err = new Error("ENOENT") as any;
        err.code = "ENOENT";
        cb(err, "", "");
      });

      const status = await manager.checkDocker();
      expect(status.installed).toBe(false);
      expect(status.running).toBe(false);
    });

    it("returns installed but not running when daemon is down", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err = new Error("Cannot connect to Docker daemon") as any;
        err.code = 1;
        cb(err, "", "Cannot connect to the Docker daemon");
      });

      const status = await manager.checkDocker();
      expect(status.installed).toBe(true);
      expect(status.running).toBe(false);
    });
  });

  describe("checkCompose", () => {
    it("returns true when docker compose is available", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "Docker Compose version v2.24.0\n", "");
      });

      const result = await manager.checkCompose();
      expect(result).toBe(true);
    });

    it("returns false when docker compose is not available", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error("not found"), "", "");
      });

      const result = await manager.checkCompose();
      expect(result).toBe(false);
    });
  });

  describe("ensureDataDir", () => {
    it("creates data directory and subdirectories", async () => {
      await manager.ensureDataDir();

      expect(fs.existsSync(path.join(dataDir, "cases"))).toBe(true);
      expect(fs.existsSync(path.join(dataDir, "templates"))).toBe(true);
    });

    it("writes default .env if not present", async () => {
      await manager.ensureDataDir();

      const envPath = path.join(dataDir, ".env");
      expect(fs.existsSync(envPath)).toBe(true);
      const content = fs.readFileSync(envPath, "utf-8");
      expect(content).toContain("FOAMPILOT_VERSION=latest");
      expect(content).toContain("FOAMPILOT_PORT=8000");
    });
  });

  describe("writeEnvFile / readEnvFile", () => {
    it("round-trips config correctly", async () => {
      const config = {
        foampilotVersion: "2.0.0",
        foampilotPort: 9000,
        foamCores: 8,
        dockerCpus: 6,
        dockerMemory: "16g",
        casesPath: "/home/user/cases",
        templatesPath: "/home/user/templates",
      };

      await manager.writeEnvFile(config);
      const read = manager.readEnvFile();

      expect(read.foampilotVersion).toBe("2.0.0");
      expect(read.foampilotPort).toBe(9000);
      expect(read.foamCores).toBe(8);
      expect(read.dockerCpus).toBe(6);
      expect(read.dockerMemory).toBe("16g");
      expect(read.casesPath).toBe("/home/user/cases");
      expect(read.templatesPath).toBe("/home/user/templates");
    });

    it("handles Windows paths with backslashes", async () => {
      const config = {
        foampilotVersion: "1.0.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "C:\\Users\\Test\\foampilot\\cases",
        templatesPath: "C:\\Users\\Test\\foampilot\\templates",
      };

      await manager.writeEnvFile(config);
      const read = manager.readEnvFile();

      expect(read.casesPath).toBe("C:\\Users\\Test\\foampilot\\cases");
    });

    it("returns defaults when .env does not exist", () => {
      const read = manager.readEnvFile();
      expect(read.foampilotVersion).toBe("latest");
      expect(read.foampilotPort).toBe(8000);
    });
  });

  describe("up", () => {
    it("calls docker compose up -d with env vars", async () => {
      // Write .env first so loadEnvVars works
      await manager.writeEnvFile({
        foampilotVersion: "1.0.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      await manager.up();

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "-f", manager.getComposeFile(), "up", "-d"],
        expect.objectContaining({ env: expect.any(Object) }),
        expect.any(Function),
      );
    });
  });

  describe("down", () => {
    it("calls docker compose down", async () => {
      await manager.writeEnvFile({
        foampilotVersion: "1.0.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      await manager.down();

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "-f", manager.getComposeFile(), "down"],
        expect.objectContaining({ env: expect.any(Object) }),
        expect.any(Function),
      );
    });
  });

  describe("status", () => {
    it("returns 'running' when container is running", async () => {
      await manager.writeEnvFile({
        foampilotVersion: "1.0.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, '{"Name":"foampilot","State":"running"}\n', "");
      });

      const result = await manager.status();
      expect(result).toBe("running");
    });

    it("returns 'stopped' when container exists but is not running", async () => {
      await manager.writeEnvFile({
        foampilotVersion: "1.0.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, '{"Name":"foampilot","State":"exited"}\n', "");
      });

      const result = await manager.status();
      expect(result).toBe("stopped");
    });

    it("returns 'not_found' when no output", async () => {
      await manager.writeEnvFile({
        foampilotVersion: "1.0.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      const result = await manager.status();
      expect(result).toBe("not_found");
    });

    it("returns 'not_found' when command fails", async () => {
      await manager.writeEnvFile({
        foampilotVersion: "1.0.0",
        foampilotPort: 8000,
        foamCores: 4,
        dockerCpus: 4,
        dockerMemory: "8g",
        casesPath: "/cases",
        templatesPath: "/templates",
      });

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error("compose not running"), "", "");
      });

      const result = await manager.status();
      expect(result).toBe("not_found");
    });
  });

  describe("checkPort", () => {
    it("returns true when port is free", async () => {
      // Use a high random port that's very likely free
      const result = await manager.checkPort(59999);
      expect(result).toBe(true);
    });

    it("returns false when port is in use", async () => {
      const net = await import("net");
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(59998, "127.0.0.1", resolve));

      try {
        const result = await manager.checkPort(59998);
        expect(result).toBe(false);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe("healthCheck", () => {
    it("returns false when endpoint is unreachable within timeout", async () => {
      // Use a port nothing is listening on
      const result = await manager.healthCheck("http://localhost:59997/health", 1000);
      expect(result).toBe(false);
    }, 5000);
  });
});
