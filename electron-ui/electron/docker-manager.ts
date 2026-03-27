import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import { app } from "electron";

export interface DockerStatus {
  installed: boolean;
  version?: string;
  running?: boolean;
  composeAvailable?: boolean;
}

export interface AppConfig {
  foampilotVersion: string;
  foampilotPort: number;
  foamCores: number;
  dockerCpus: number;
  dockerMemory: string;
  casesPath: string;
  templatesPath: string;
}

const DEFAULT_CONFIG: AppConfig = {
  foampilotVersion: "latest",
  foampilotPort: 8000,
  foamCores: 4,
  dockerCpus: 4,
  dockerMemory: "8g",
  casesPath: "",
  templatesPath: "",
};

export class DockerManager {
  private dataDir: string;
  private composeFile: string;
  private envFile: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? path.join(app.getPath("userData"), "foampilot");
    this.composeFile = path.join(this.dataDir, "docker-compose.yml");
    this.envFile = path.join(this.dataDir, ".env");
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getComposeFile(): string {
    return this.composeFile;
  }

  /** Check if Docker CLI is installed and daemon is running. */
  async checkDocker(): Promise<DockerStatus> {
    try {
      const version = await this.exec("docker", [
        "info",
        "--format",
        "{{.ServerVersion}}",
      ]);
      return { installed: true, version: version.trim(), running: true };
    } catch (err: any) {
      // ENOENT means docker binary not found
      if (err.code === "ENOENT") {
        return { installed: false, running: false };
      }
      // Other errors mean docker is installed but daemon isn't running
      return { installed: true, running: false };
    }
  }

  /** Check if docker compose (V2 plugin) is available. */
  async checkCompose(): Promise<boolean> {
    try {
      await this.exec("docker", ["compose", "version"]);
      return true;
    } catch {
      return false;
    }
  }

  /** Create data directory structure and copy compose file if needed. */
  async ensureDataDir(): Promise<void> {
    const dirs = [
      this.dataDir,
      path.join(this.dataDir, "cases"),
      path.join(this.dataDir, "templates"),
    ];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Copy docker-compose.yml from extraResources if it doesn't exist yet
    if (!fs.existsSync(this.composeFile)) {
      const candidates = [
        // Packaged app: extraResources are placed next to app.asar
        path.join(process.resourcesPath ?? "", "docker-compose.yml"),
        // Dev: relative to project root
        path.join(__dirname, "..", "..", "docker", "docker-compose.prod.yml"),
      ];
      for (const src of candidates) {
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, this.composeFile);
          break;
        }
      }
    }

    // Write default .env if missing
    if (!fs.existsSync(this.envFile)) {
      const cfg: AppConfig = {
        ...DEFAULT_CONFIG,
        casesPath: path.join(this.dataDir, "cases"),
        templatesPath: path.join(this.dataDir, "templates"),
      };
      await this.writeEnvFile(cfg);
    }
  }

  /** Write .env file for docker compose variable substitution. */
  async writeEnvFile(config: AppConfig): Promise<void> {
    const lines = [
      `FOAMPILOT_VERSION=${config.foampilotVersion}`,
      `FOAMPILOT_PORT=${config.foampilotPort}`,
      `FOAMPILOT_CASES=${config.casesPath}`,
      `FOAMPILOT_TEMPLATES=${config.templatesPath}`,
      `FOAM_CORES=${config.foamCores}`,
      `DOCKER_CPUS=${config.dockerCpus}`,
      `DOCKER_MEMORY=${config.dockerMemory}`,
    ];
    fs.writeFileSync(this.envFile, lines.join("\n") + "\n", "utf-8");
  }

  /** Read current config from .env file. */
  readEnvFile(): AppConfig {
    if (!fs.existsSync(this.envFile)) return { ...DEFAULT_CONFIG };
    const text = fs.readFileSync(this.envFile, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    return {
      foampilotVersion: vars.FOAMPILOT_VERSION ?? DEFAULT_CONFIG.foampilotVersion,
      foampilotPort: parseInt(vars.FOAMPILOT_PORT ?? "") || DEFAULT_CONFIG.foampilotPort,
      foamCores: parseInt(vars.FOAM_CORES ?? "") || DEFAULT_CONFIG.foamCores,
      dockerCpus: parseInt(vars.DOCKER_CPUS ?? "") || DEFAULT_CONFIG.dockerCpus,
      dockerMemory: vars.DOCKER_MEMORY ?? DEFAULT_CONFIG.dockerMemory,
      casesPath: vars.FOAMPILOT_CASES ?? "",
      templatesPath: vars.FOAMPILOT_TEMPLATES ?? "",
    };
  }

  /** Pull the container image. Yields progress lines from stdout/stderr. */
  async *pull(tag?: string): AsyncIterable<string> {
    if (tag) {
      // Update .env with new tag before pulling
      const cfg = this.readEnvFile();
      cfg.foampilotVersion = tag;
      await this.writeEnvFile(cfg);
    }

    const proc = spawn(
      "docker",
      ["compose", "-f", this.composeFile, "pull"],
      { env: { ...process.env, ...this.loadEnvVars() } },
    );

    const lines = this.streamLines(proc);
    for await (const line of lines) {
      yield line;
    }
  }

  /** Start containers in detached mode. */
  async up(): Promise<void> {
    await this.exec("docker", ["compose", "-f", this.composeFile, "up", "-d"], {
      env: { ...process.env, ...this.loadEnvVars() },
    });
  }

  /** Stop and remove containers. */
  async down(): Promise<void> {
    await this.exec(
      "docker",
      ["compose", "-f", this.composeFile, "down"],
      { env: { ...process.env, ...this.loadEnvVars() } },
    );
  }

  /** Get container status: 'running', 'stopped', or 'not_found'. */
  async status(): Promise<"running" | "stopped" | "not_found"> {
    try {
      const output = await this.exec(
        "docker",
        ["compose", "-f", this.composeFile, "ps", "--format", "json"],
        { env: { ...process.env, ...this.loadEnvVars() } },
      );
      if (!output.trim()) return "not_found";
      // docker compose ps --format json outputs one JSON object per line
      for (const line of output.trim().split("\n")) {
        try {
          const info = JSON.parse(line);
          if (info.State === "running") return "running";
          return "stopped";
        } catch {
          continue;
        }
      }
      return "not_found";
    } catch {
      return "not_found";
    }
  }

  /** Check if a port is available (not in use). */
  async checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  }

  /** Poll the backend health endpoint with exponential backoff. */
  async healthCheck(
    url: string = "http://localhost:8000/health",
    timeoutMs: number = 30000,
  ): Promise<boolean> {
    const start = Date.now();
    let delay = 500;

    while (Date.now() - start < timeoutMs) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) return true;
      } catch {
        // Backend not ready yet
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 4000);
    }
    return false;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private loadEnvVars(): Record<string, string> {
    if (!fs.existsSync(this.envFile)) return {};
    const text = fs.readFileSync(this.envFile, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    return vars;
  }

  private exec(
    cmd: string,
    args: string[],
    options?: { env?: NodeJS.ProcessEnv },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { env: options?.env }, (err, stdout, stderr) => {
        if (err) {
          const error = err as any;
          error.stderr = stderr;
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  private async *streamLines(
    proc: ReturnType<typeof spawn>,
  ): AsyncIterable<string> {
    const queue: string[] = [];
    let done = false;
    let resolve: (() => void) | null = null;

    const push = (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      queue.push(...lines);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    proc.stdout?.on("data", push);
    proc.stderr?.on("data", push);
    proc.on("close", () => {
      done = true;
      if (resolve) {
        resolve();
        resolve = null;
      }
    });

    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) break;
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
  }
}
