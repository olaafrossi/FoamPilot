import { app, BrowserWindow, ipcMain, shell, dialog, Menu, Notification } from "electron";
import * as path from "path";
import * as fs from "fs";
import { DockerManager } from "./docker-manager";
import { UpdateManager } from "./update-manager";

let mainWindow: BrowserWindow | null = null;
let dockerManager: DockerManager;
let updateManager: UpdateManager;

// Load config from settings.json next to the executable (or project root in dev)
function loadConfig(): { backendUrl: string; localCasesPath: string; paraViewPath: string; cores: number } {
  const defaults = {
    backendUrl: "http://127.0.0.1:8000",
    localCasesPath: path.join(path.dirname(app.getAppPath()), "..", "cases"),
    paraViewPath: "C:\\Program Files\\ParaView 6.0.1\\bin\\paraview.exe",
    cores: 10,
  };

  try {
    const settingsPath = path.join(app.getAppPath(), "..", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      // Fix legacy localhost URLs (IPv6 breaks Docker on Windows)
      if (data.backendUrl?.includes("localhost")) {
        data.backendUrl = data.backendUrl.replace("localhost", "127.0.0.1");
      }
      return { ...defaults, ...data };
    }
  } catch {}
  return defaults;
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "FoamPilot",
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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

// ── Existing IPC handlers ─────────────────────────────────────────────
ipcMain.handle("get-config", () => loadConfig());

ipcMain.handle("open-paraview", async (_, casePath: string) => {
  const config = loadConfig();
  const foamFile = path.join(casePath, path.basename(casePath) + ".foam");

  if (!fs.existsSync(foamFile)) {
    fs.writeFileSync(foamFile, "");
  }

  try {
    const { execFile } = require("child_process");
    execFile(config.paraViewPath, [foamFile]);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("open-folder", async (_, folderPath: string) => {
  shell.openPath(folderPath);
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
    const notification = new Notification({ title, body });
    notification.show();
    return true;
  }
  return false;
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
