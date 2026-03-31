import { app, BrowserWindow, ipcMain, shell, dialog, Menu, Notification, nativeImage } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { DockerManager } from "./docker-manager.ts";
import { UpdateManager } from "./update-manager.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In dev mode, electron runs from electron/main.ts so __dirname = electron/.
// The compiled preload.js lives in electron-dist/.
// In production, both main.js and preload.js are in electron-dist/.
const isDev = __dirname.endsWith("electron");
const preloadPath = isDev
  ? path.join(__dirname, "..", "electron-dist", "preload.js")
  : path.join(__dirname, "preload.js");

// Resolve the build/ directory (icons live here)
const buildDir = isDev
  ? path.join(__dirname, "..", "build")
  : path.join(__dirname, "..", "build");
// Use PNG for nativeImage (works better cross-platform; ICO is for electron-builder only)
const appIcon = path.join(buildDir, "icon.png");

// Set app name and model ID for taskbar / notifications (overrides "Electron" in dev)
app.setName("FoamPilot");
if (process.platform === "win32") {
  app.setAppUserModelId("com.foampilot.app");
}

let mainWindow: BrowserWindow | null = null;
let dockerManager: DockerManager;
let updateManager: UpdateManager;

function settingsJsonPath(): string {
  return path.join(app.getAppPath(), "..", "settings.json");
}

// Load config from settings.json next to the executable (or project root in dev)
function loadConfig(): {
  backendUrl: string; localCasesPath: string; paraViewPath: string;
  cores: number; dockerCpus: number; dockerMemory: number;
} {
  const defaults = {
    backendUrl: "http://127.0.0.1:8000",
    localCasesPath: path.join(path.dirname(app.getAppPath()), "..", "cases"),
    paraViewPath: "C:\\Program Files\\ParaView 6.0.1\\bin\\paraview.exe",
    cores: 4,
    dockerCpus: 4,
    dockerMemory: 8,
  };

  try {
    const sp = settingsJsonPath();
    if (fs.existsSync(sp)) {
      const data = JSON.parse(fs.readFileSync(sp, "utf-8"));
      // Fix legacy localhost URLs (IPv6 breaks Docker on Windows)
      if (data.backendUrl?.includes("localhost")) {
        data.backendUrl = data.backendUrl.replace("localhost", "127.0.0.1");
      }
      return { ...defaults, ...data };
    }
  } catch {}
  return defaults;
}

function saveConfig(config: Record<string, unknown>): void {
  const sp = settingsJsonPath();
  const dir = path.dirname(sp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sp, JSON.stringify(config, null, 2), "utf-8");
}

function createWindow() {
  Menu.setApplicationMenu(null);

  // Load icon as nativeImage — more reliable for Windows taskbar than path string
  const icon = nativeImage.createFromPath(appIcon);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "FoamPilot",
    icon,
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Explicitly set icon after creation (Windows sometimes ignores the constructor option)
  mainWindow.setIcon(icon);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// ── Config IPC handlers ──────────────────────────────────────────────
ipcMain.handle("get-config", () => loadConfig());

ipcMain.handle("save-config", async (_, config: Record<string, unknown>) => {
  try {
    saveConfig(config);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("open-paraview", async (_, casePath: string) => {
  const config = loadConfig();
  const normalizedPath = path.normalize(casePath);
  const foamFile = path.join(normalizedPath, path.basename(normalizedPath) + ".foam");

  if (!fs.existsSync(normalizedPath)) {
    return { ok: false, error: `Case folder not found: ${normalizedPath}` };
  }

  if (!fs.existsSync(foamFile)) {
    fs.writeFileSync(foamFile, "");
  }

  if (!fs.existsSync(config.paraViewPath)) {
    return { ok: false, error: `ParaView not found at: ${config.paraViewPath}` };
  }

  try {
    execFile(config.paraViewPath, [foamFile]);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("open-folder", async (_, folderPath: string) => {
  const normalizedPath = path.normalize(folderPath);
  if (!fs.existsSync(normalizedPath)) {
    return { ok: false, error: `Folder not found: ${normalizedPath}` };
  }
  const errMsg = await shell.openPath(normalizedPath);
  if (errMsg) {
    return { ok: false, error: errMsg };
  }
  return { ok: true };
});

ipcMain.handle("select-file", async (_, filters: { name: string; extensions: string[] }[]) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    filters,
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("read-file", async (_, filePath: string) => {
  return fs.readFileSync(filePath);
});

ipcMain.handle("show-notification", async (_, title: string, body: string) => {
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body, icon: appIcon });
    notification.show();
    return true;
  }
  return false;
});

// ── Tutorial status IPC handlers ──────────────────────────────────────

function tutorialsJsonPath(): string {
  const config = loadConfig();
  return path.join(config.localCasesPath, ".foampilot", "tutorials.json");
}

function readTutorialsJson(): Record<string, unknown> {
  const fp = tutorialsJsonPath();
  if (!fs.existsSync(fp)) return {};
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return {};
  }
}

function writeTutorialsJson(data: Record<string, unknown>): void {
  const fp = tutorialsJsonPath();
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

ipcMain.handle("tutorial:get-status", () => readTutorialsJson());

ipcMain.handle("tutorial:set-completed", (_, key: string) => {
  const data = readTutorialsJson();
  data[key] = true;
  if (!data.onboarding_completed) data.onboarding_completed = true;
  writeTutorialsJson(data);
  return true;
});

// ── Docker IPC handlers ───────────────────────────────────────────────

ipcMain.handle("docker:status", async () => {
  const docker = await dockerManager.checkDocker();
  const compose = await dockerManager.checkCompose();
  const container = await dockerManager.status();
  return { ...docker, composeAvailable: compose, container };
});

ipcMain.handle("docker:pull", async (_, tag?: string) => {
  try {
    await dockerManager.pull(tag, (line) => {
      sendToRenderer("docker:progress", line);
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("docker:start", async () => {
  try {
    // Check port availability first
    const portFree = await dockerManager.checkPort(8000);
    if (!portFree) {
      return { ok: false, error: "Port 8000 is already in use by another process" };
    }
    await dockerManager.up();
    // Wait for health
    const healthy = await dockerManager.healthCheck();
    sendToRenderer("docker:status-change", { container: healthy ? "running" : "unhealthy" });
    return { ok: true, healthy };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("docker:stop", async () => {
  try {
    await dockerManager.down();
    sendToRenderer("docker:status-change", { container: "stopped" });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("docker:ensure-setup", async () => {
  try {
    await dockerManager.ensureDataDir();
    const config = loadConfig();
    await dockerManager.writeEnvFile(config);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("docker:health", async () => {
  return dockerManager.healthCheck();
});

ipcMain.handle("docker:diagnostics", async () => {
  return dockerManager.runDiagnostics();
});

/** Fast single-shot health ping (no retries, 3s timeout) for status bar polling. */
ipcMain.handle("docker:ping", async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("http://127.0.0.1:8000/health", { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
});

ipcMain.handle("docker:get-system-resources", () => {
  return dockerManager.getSystemResources();
});

ipcMain.handle("docker:update-resources", async (_, config: Record<string, unknown>) => {
  try {
    await dockerManager.writeEnvFile(config as any);
    await dockerManager.down();
    const portFree = await dockerManager.checkPort(8000);
    if (!portFree) {
      return { ok: false, error: "Port 8000 is already in use by another process" };
    }
    await dockerManager.up();
    const healthy = await dockerManager.healthCheck();
    sendToRenderer("docker:status-change", { container: healthy ? "running" : "unhealthy" });
    return { ok: true, healthy };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// ── Docker auto-install IPC handlers ─────────────────────────────────

ipcMain.handle("docker:check-wsl", () => dockerManager.checkWsl());
ipcMain.handle("docker:check-winget", () => dockerManager.checkWinget());
ipcMain.handle("docker:check-windows-build", () => dockerManager.checkWindowsBuild());

ipcMain.handle("docker:install-wsl", async () => {
  const result = await dockerManager.installWsl();
  if (result.ok && result.needsReboot) {
    dockerManager.setInstallState("wsl-installed");
  }
  return result;
});

ipcMain.handle("docker:install-docker", async () => {
  // Try winget first, fall back to direct download
  const hasWinget = await dockerManager.checkWinget();

  if (hasWinget) {
    sendToRenderer("docker:install-progress", { type: "status", line: "Installing Docker via winget..." });
    const result = await dockerManager.installDockerViaWinget((line) => {
      sendToRenderer("docker:install-progress", { type: "winget", line });
    });
    if (result.ok) {
      dockerManager.clearInstallState();
      return result;
    }
    // winget failed — fall through to direct download
    sendToRenderer("docker:install-progress", { type: "status", line: "winget failed, trying direct download..." });
  }

  // Fallback: direct download + silent install
  try {
    sendToRenderer("docker:install-progress", { type: "status", line: "Downloading Docker Desktop..." });
    const installerPath = await dockerManager.downloadDockerInstaller((pct, mb) => {
      sendToRenderer("docker:install-progress", { type: "download", percent: pct, mb });
    });

    sendToRenderer("docker:install-progress", { type: "status", line: "Installing Docker Desktop..." });
    const result = await dockerManager.installDockerFromExe(installerPath);
    if (result.ok) {
      dockerManager.clearInstallState();
    }
    return result;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("docker:start-desktop", () => dockerManager.startDockerDesktop());
ipcMain.handle("docker:get-install-state", () => dockerManager.getInstallState());
ipcMain.handle("docker:clear-install-state", () => dockerManager.clearInstallState());

// ── Update IPC handlers ──────────────────────────────────────────────

ipcMain.handle("update:check", async () => {
  const containerUpdate = await updateManager.checkForContainerUpdate();
  return { container: containerUpdate };
});

ipcMain.handle("update:apply-container", async (_, tag: string) => {
  try {
    await updateManager.applyContainerUpdate(tag, (line) => {
      sendToRenderer("docker:progress", line);
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("update:app-version", () => {
  return app.getVersion();
});

// ── App lifecycle ─────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();

  // Initialize Docker manager
  dockerManager = new DockerManager();
  updateManager = new UpdateManager(dockerManager);

  // Forward update events to renderer
  updateManager.on("electron-update-available", (info) => {
    sendToRenderer("update:available", { type: "electron", ...info });
  });
  updateManager.on("electron-update-downloaded", (info) => {
    sendToRenderer("update:downloaded", info);
  });
  updateManager.on("container-update-available", (info) => {
    sendToRenderer("update:available", { type: "container", ...info });
  });

  // Run startup sequence (non-blocking — renderer shows setup UI)
  try {
    await dockerManager.ensureDataDir();
    const config = loadConfig();
    await dockerManager.writeEnvFile(config);
  } catch {
    // Setup page will handle this
  }

  // Check for updates (non-blocking)
  updateManager.checkForElectronUpdate();
  updateManager.checkForContainerUpdate();
});

app.on("will-quit", async (e) => {
  e.preventDefault();
  try {
    await dockerManager.down();
  } catch {
    // Best effort
  }
  app.exit(0);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
