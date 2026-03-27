import { execFile, spawn, ChildProcess } from "child_process";
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
  backendUrl: string;
  localCasesPath: string;
  paraViewPath: string;
  cores: number;
  dockerMemory?: string;
  dockerCpus?: string;
}

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

  /** Check if Docker is installed and the daemon is running. */
  async checkDocker(): Promise<DockerStatus> {
    try {
      const version = await this.exec("docker", ["info", "--format", "{{.ServerVersion}}"]);
      return { installed: true, version: version.trim(), running: true };
    } catch (err: any) {
      // Docker installed but daemon not running
      if (err.code !== "ENOENT") {
        return { installed: true, running: false };
      }
      return { installed: false, running: false };
    }
  }

  /** Check if Docker Compose (V2 plugin) is available. */
  async checkCompose(): Promise<boolean> {
    try {
      await this.exec("docker", ["compose", "version"]);
      return true;
    } catch {
      return false;
    }
  }

  /** Ensure the user data directory and compose file exist. */
  async ensureDataDir(): Promise<void> {
    const dirs = [
      this.dataDir,
      path.join(this.dataDir, "cases"),
      path.join(this.dataDir, "templates"),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Copy docker-compose.yml from extraResources if missing
    if (!fs.existsSync(this.composeFile)) {
      const resourceCompose = this.getResourceComposePath();
      if (resourceCompose && fs.existsSync(resourceCompose)) {
        fs.copyFileSync(resourceCompose, this.composeFile);
      }
    }
  }

  /** Write the .env file used by docker compose. */
  async writeEnvFile(config: Partial<AppConfig>): Promise<void> {
    const casesPath = path.join(this.dataDir, "cases");
    const templatesPath = path.join(this.dataDir, "templates");
    const version = this.getStoredVersion() || "latest";

    const lines = [
      `FOAMPILOT_VERSION=${version}`,
      `FOAMPILOT_PORT=8000`,
      `FOAMPILOT_CASES=${casesPath}`,
      `FOAMPILOT_TEMPLATES=${templatesPath}`,
      `FOAM_CORES=${config.cores ?? 4}`,
      `DOCKER_CPUS=${config.dockerCpus ?? "4"}`,
      `DOCKER_MEMORY=${config.dockerMemory ?? "8g"}`,
    ];
    fs.writeFileSync(this.envFile, lines.join("\n") + "\n", "utf-8");
  }

  /** Pull the container image (streams stdout lines via callback). */
  pull(tag?: string, onProgress?: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (tag) {
        // Update .env with the new tag before pulling
        this.updateEnvVersion(tag);
      }

      const child = spawn("docker", [
        "compose", "-f", this.composeFile, "--env-file", this.envFile, "pull",
      ], { stdio: ["ignore", "pipe", "pipe"] });

      child.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        lines.forEach((line) => onProgress?.(line));
      });
      child.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        lines.forEach((line) => onProgress?.(line));
      });

      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`docker compose pull exited with code ${code}`));
      });
      child.on("error", reject);
    });
  }

  /** Start the container in detached mode. */
  async up(): Promise<void> {
    await this.exec("docker", [
      "compose", "-f", this.composeFile, "--env-file", this.envFile, "up", "-d",
    ]);
  }

  /** Stop and remove the container. */
  async down(): Promise<void> {
    try {
      await this.exec("docker", [
        "compose", "-f", this.composeFile, "--env-file", this.envFile, "down",
      ]);
    } catch {
      // Ignore errors on shutdown (container may already be stopped)
    }
  }

  /** Get the current container status. */
  async status(): Promise<"running" | "stopped" | "not_found"> {
    try {
      const output = await this.exec("docker", [
        "compose", "-f", this.composeFile, "--env-file", this.envFile,
        "ps", "--format", "json",
      ]);
      if (!output.trim()) return "not_found";
      try {
        const parsed = JSON.parse(output.trim());
        const containers = Array.isArray(parsed) ? parsed : [parsed];
        if (containers.length === 0) return "not_found";
        const isRunning = containers.some(
          (c: any) => c.State === "running" || c.Status?.startsWith("Up"),
        );
        return isRunning ? "running" : "stopped";
      } catch {
        // Fallback: if JSON parsing fails, check for "running" in output
        return output.includes("running") ? "running" : "stopped";
      }
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

  /** Health check: poll the backend /health endpoint with retries. */
  async healthCheck(url: string = "http://localhost:8000/health", timeoutMs: number = 30000): Promise<boolean> {
    const start = Date.now();
    let delay = 500;

    while (Date.now() - start < timeoutMs) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) return true;
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 3000);
    }
    return false;
  }

  /** Get the stored container version from .env file. */
  getStoredVersion(): string | null {
    try {
      if (!fs.existsSync(this.envFile)) return null;
      const content = fs.readFileSync(this.envFile, "utf-8");
      const match = content.match(/^FOAMPILOT_VERSION=(.+)$/m);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /** Update the version tag in the .env file. */
  private updateEnvVersion(tag: string): void {
    if (!fs.existsSync(this.envFile)) return;
    let content = fs.readFileSync(this.envFile, "utf-8");
    content = content.replace(/^FOAMPILOT_VERSION=.+$/m, `FOAMPILOT_VERSION=${tag}`);
    fs.writeFileSync(this.envFile, content, "utf-8");
  }

  /** Get the path to docker-compose.yml bundled in extraResources. */
  private getResourceComposePath(): string | null {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "docker-compose.yml");
    }
    // Dev mode: look relative to the project
    const devPath = path.join(__dirname, "..", "..", "docker", "docker-compose.prod.yml");
    if (fs.existsSync(devPath)) return devPath;
    return null;
  }

  /** Promisified execFile wrapper. */
  private exec(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 60000 }, (err, stdout, stderr) => {
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
}
