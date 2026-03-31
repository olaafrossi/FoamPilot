import { execFile, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as os from "os";
import * as https from "https";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { app } from "electron";

export interface DockerStatus {
  installed: boolean;
  version?: string;
  running?: boolean;
  composeAvailable?: boolean;
}

export interface WslStatus {
  installed: boolean;
  version?: string;
}

export interface InstallState {
  stage: string;
  timestamp: string;
}

export interface DiagnosticCheck {
  name: string;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
}

export interface DiagnosticResult {
  passed: boolean;
  checks: DiagnosticCheck[];
}

export interface AppConfig {
  backendUrl: string;
  localCasesPath: string;
  paraViewPath: string;
  cores: number;
  dockerCpus: number;
  dockerMemory: number;  // GB
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

  /** Return host CPU count and total memory for UI validation bounds. */
  getSystemResources(): { cpus: number; memoryGB: number } {
    return {
      cpus: Math.max(1, os.cpus().length),
      memoryGB: Math.max(2, Math.floor(os.totalmem() / (1024 ** 3))),
    };
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

    const cores = config.cores ?? 4;
    const cpus = config.dockerCpus ?? 4;
    const memGB = config.dockerMemory ?? 8;

    const lines = [
      `FOAMPILOT_VERSION=${version}`,
      `FOAMPILOT_PORT=8000`,
      `FOAMPILOT_CASES=${casesPath}`,
      `FOAMPILOT_TEMPLATES=${templatesPath}`,
      `FOAM_CORES=${cores}`,
      `DOCKER_CPUS=${cpus}`,
      `DOCKER_MEMORY=${memGB}g`,
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
  async healthCheck(url: string = "http://127.0.0.1:8000/health", timeoutMs: number = 30000): Promise<boolean> {
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

  /** Run a full suite of Docker environment diagnostics. */
  async runDiagnostics(): Promise<DiagnosticResult> {
    const checks: DiagnosticCheck[] = [];

    // 1. Docker installed
    let dockerVersionRaw: string | null = null;
    try {
      dockerVersionRaw = await this.execWithTimeout("docker", ["--version"], 5000);
      checks.push({
        name: "Docker Installed",
        status: "pass",
        message: `Docker found: ${dockerVersionRaw.trim()}`,
      });
    } catch {
      checks.push({
        name: "Docker Installed",
        status: "fail",
        message: "Docker Desktop is not installed.",
      });
    }

    // 2. Docker daemon running
    try {
      await this.execWithTimeout("docker", ["info"], 5000);
      checks.push({
        name: "Docker Daemon",
        status: "pass",
        message: "Docker daemon is running.",
      });
    } catch {
      checks.push({
        name: "Docker Daemon",
        status: "fail",
        message: "Docker Desktop is not running. Please start Docker Desktop.",
      });
    }

    // 3. WSL2 status (Windows only)
    if (process.platform === "win32") {
      try {
        await this.execWithTimeout("wsl", ["--status"], 5000);
        checks.push({
          name: "WSL2",
          status: "pass",
          message: "WSL2 is enabled.",
        });
      } catch {
        checks.push({
          name: "WSL2",
          status: "fail",
          message: "WSL2 is not enabled. Docker Desktop requires WSL2 on Windows.",
        });
      }
    } else {
      checks.push({
        name: "WSL2",
        status: "skip",
        message: "WSL2 check skipped (not Windows).",
      });
    }

    // 4. Disk space
    try {
      const freeMB = this.getFreeDiskSpaceMB();
      const freeGB = freeMB / 1024;
      if (freeGB < 5) {
        checks.push({
          name: "Disk Space",
          status: "warn",
          message: `Low disk space. FoamPilot needs at least 5 GB free. Available: ${freeGB.toFixed(1)} GB.`,
        });
      } else {
        checks.push({
          name: "Disk Space",
          status: "pass",
          message: `Disk space OK: ${freeGB.toFixed(1)} GB free.`,
        });
      }
    } catch {
      checks.push({
        name: "Disk Space",
        status: "warn",
        message: "Could not determine free disk space.",
      });
    }

    // 5. Docker version compatibility (minimum 20.10)
    if (dockerVersionRaw) {
      try {
        const versionMatch = dockerVersionRaw.match(/(\d+)\.(\d+)/);
        if (versionMatch) {
          const major = parseInt(versionMatch[1], 10);
          const minor = parseInt(versionMatch[2], 10);
          if (major > 20 || (major === 20 && minor >= 10)) {
            checks.push({
              name: "Docker Version",
              status: "pass",
              message: `Docker version ${major}.${minor} meets minimum requirement (20.10).`,
            });
          } else {
            checks.push({
              name: "Docker Version",
              status: "fail",
              message: "Docker version is too old. Please update Docker Desktop.",
            });
          }
        } else {
          checks.push({
            name: "Docker Version",
            status: "warn",
            message: "Could not parse Docker version string.",
          });
        }
      } catch {
        checks.push({
          name: "Docker Version",
          status: "warn",
          message: "Could not determine Docker version.",
        });
      }
    } else {
      checks.push({
        name: "Docker Version",
        status: "skip",
        message: "Skipped version check because Docker is not installed.",
      });
    }

    const passed = checks.every((c) => c.status === "pass" || c.status === "skip");
    return { passed, checks };
  }

  // ── Windows Docker auto-install ──────────────────────────────────────

  /** Check if WSL2 is installed (Windows only). */
  async checkWsl(): Promise<WslStatus> {
    if (process.platform !== "win32") return { installed: true };
    try {
      const output = await this.execWithTimeout("wsl", ["--status"], 5000);
      return { installed: true, version: output.trim().split("\n")[0] };
    } catch {
      return { installed: false };
    }
  }

  /** Check if winget is available. */
  async checkWinget(): Promise<boolean> {
    try {
      await this.execWithTimeout("winget", ["--version"], 5000);
      return true;
    } catch {
      return false;
    }
  }

  /** Check if Windows build supports Docker Desktop (>= 10.0.19044). */
  checkWindowsBuild(): { supported: boolean; build: string } {
    const release = os.release(); // e.g. "10.0.22631"
    const parts = release.split(".");
    const build = parseInt(parts[2] || "0", 10);
    return { supported: build >= 19044, build: release };
  }

  /** Install WSL2 via elevated PowerShell. Returns whether reboot is needed. */
  installWsl(): Promise<{ ok: boolean; needsReboot: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn("powershell", [
        "-Command",
        "Start-Process", "wsl", "-ArgumentList", "'--install --no-distribution'",
        "-Verb", "RunAs", "-Wait",
      ], { shell: true, stdio: ["ignore", "pipe", "pipe"] });

      let stderr = "";
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      child.on("close", async (code) => {
        if (code !== 0) {
          // Verify if WSL was actually installed despite non-zero exit
          const wsl = await this.checkWsl();
          if (wsl.installed) {
            resolve({ ok: true, needsReboot: true });
          } else {
            resolve({ ok: false, needsReboot: false, error: stderr || "WSL installation failed. You may have denied the admin prompt." });
          }
          return;
        }
        // WSL install typically requires a reboot
        resolve({ ok: true, needsReboot: true });
      });

      child.on("error", (err) => {
        resolve({ ok: false, needsReboot: false, error: err.message });
      });
    });
  }

  /** Install Docker Desktop via winget (primary path). Streams progress lines. */
  installDockerViaWinget(onProgress?: (line: string) => void): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn("winget", [
        "install", "Docker.DockerDesktop",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--silent",
      ], { stdio: ["ignore", "pipe", "pipe"] });

      const timeout = setTimeout(() => {
        child.kill();
        resolve({ ok: false, error: "Docker installation timed out after 15 minutes." });
      }, 15 * 60 * 1000);

      child.stdout?.on("data", (data: Buffer) => {
        data.toString().split("\n").filter(Boolean).forEach((line) => onProgress?.(line));
      });
      child.stderr?.on("data", (data: Buffer) => {
        data.toString().split("\n").filter(Boolean).forEach((line) => onProgress?.(line));
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: `winget install exited with code ${code}` });
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: err.message });
      });
    });
  }

  /**
   * Download Docker Desktop installer (fallback when winget unavailable).
   * Streams progress as { percent, downloadedMB }.
   */
  downloadDockerInstaller(onProgress?: (pct: number, downloadedMB: number) => void): Promise<string> {
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const url = `https://desktop.docker.com/win/main/${arch}/Docker%20Desktop%20Installer.exe`;
    const dest = path.join(os.tmpdir(), "DockerDesktopInstaller.exe");

    return new Promise((resolve, reject) => {
      const follow = (targetUrl: string, redirects = 0) => {
        if (redirects > 5) { reject(new Error("Too many redirects")); return; }

        https.get(targetUrl, { headers: { "User-Agent": "FoamPilot" } }, (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            follow(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }

          const total = parseInt(res.headers["content-length"] || "0", 10);
          let downloaded = 0;
          const file = fs.createWriteStream(dest);

          res.on("data", (chunk: Buffer) => {
            downloaded += chunk.length;
            const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
            const mb = Math.round(downloaded / (1024 * 1024));
            onProgress?.(pct, mb);
          });

          res.pipe(file);
          file.on("finish", () => { file.close(); resolve(dest); });
          file.on("error", (err) => {
            fs.unlink(dest, () => {});
            reject(err);
          });
        }).on("error", (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      };
      follow(url);
    });
  }

  /** Install Docker Desktop from a downloaded .exe (fallback path). */
  installDockerFromExe(installerPath: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn("powershell", [
        "-Command",
        `Start-Process '${installerPath}' -ArgumentList 'install','--quiet','--accept-license','--backend=wsl-2' -Verb RunAs -Wait`,
      ], { shell: true, stdio: ["ignore", "pipe", "pipe"] });

      const timeout = setTimeout(() => {
        child.kill();
        resolve({ ok: false, error: "Docker installation timed out after 10 minutes." });
      }, 10 * 60 * 1000);

      child.on("close", (code) => {
        clearTimeout(timeout);
        // Clean up installer
        fs.unlink(installerPath, () => {});
        if (code === 0) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: `Docker installer exited with code ${code}. You may have denied the admin prompt.` });
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        fs.unlink(installerPath, () => {});
        resolve({ ok: false, error: err.message });
      });
    });
  }

  /** Start Docker Desktop and wait for the daemon to respond. */
  async startDockerDesktop(): Promise<{ ok: boolean; error?: string }> {
    const candidates = [
      path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Docker", "Docker", "Docker Desktop.exe"),
    ];

    const exePath = candidates.find((p) => fs.existsSync(p));
    if (!exePath) {
      return { ok: false, error: "Docker Desktop executable not found." };
    }

    // Launch Docker Desktop (non-blocking)
    spawn(exePath, [], { detached: true, stdio: "ignore" }).unref();

    // Poll docker info with exponential backoff up to 120s
    const start = Date.now();
    let delay = 2000;
    while (Date.now() - start < 120_000) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        await this.execWithTimeout("docker", ["info"], 5000);
        return { ok: true };
      } catch {
        delay = Math.min(delay * 1.5, 5000);
      }
    }
    return { ok: false, error: "Docker Desktop started but the daemon did not respond within 120 seconds." };
  }

  // ── Install state persistence ──────────────────────────────────────

  private get installStatePath(): string {
    return path.join(this.dataDir, "install-state.json");
  }

  getInstallState(): InstallState | null {
    try {
      if (!fs.existsSync(this.installStatePath)) return null;
      const raw = JSON.parse(fs.readFileSync(this.installStatePath, "utf-8"));
      // Expire after 24h
      if (Date.now() - new Date(raw.timestamp).getTime() > 24 * 60 * 60 * 1000) {
        this.clearInstallState();
        return null;
      }
      return raw;
    } catch {
      return null;
    }
  }

  setInstallState(stage: string): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    fs.writeFileSync(this.installStatePath, JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
    }), "utf-8");
  }

  clearInstallState(): void {
    try { fs.unlinkSync(this.installStatePath); } catch { /* ignore */ }
  }

  /** Get free disk space in MB for the drive containing the data directory. */
  private getFreeDiskSpaceMB(): number {
    // os.freemem() returns RAM; we need disk. Use statfsSync (Node 18.15+).
    // Fall back to a conservative estimate if not available.
    if (typeof fs.statfsSync === "function") {
      const stats = fs.statfsSync(this.dataDir);
      return (stats.bavail * stats.bsize) / (1024 * 1024);
    }
    // Fallback: use os.freemem as a rough proxy (not ideal, but won't crash)
    return os.freemem() / (1024 * 1024);
  }

  /** Promisified execFile with a custom timeout. */
  private execWithTimeout(command: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
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
