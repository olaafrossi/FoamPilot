import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
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
    backendUrl: "http://localhost:8000",
    localCasesPath: path.join(path.dirname(app.getAppPath()), "..", "cases"),
    paraViewPath: "C:\\Program Files\\ParaView 6.0.1\\bin\\paraview.exe",
    cores: 10,
  };

  try {
    const settingsPath = path.join(app.getAppPath(), "..", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      return { ...defaults, ...data };
    }
  } catch {}
  return defaults;
}

function createWindow() {
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

// ── Docker IPC handlers ───────────────────────────────────────────────

ipcMain.handle("docker:status", async () => {
  const status = await dockerManager.checkDocker();
  const composeAvailable = status.installed ? await dockerManager.checkCompose() : false;
  return { ...status, composeAvailable };
});

ipcMain.handle("docker:pull", async (_, tag?: string) => {
  for await (const line of dockerManager.pull(tag)) {
    sendToRenderer("docker:progress", line);
  }
  return { ok: true };
});

ipcMain.handle("docker:start", async () => {
  const port = dockerManager.readEnvFile().foampilotPort;
  const portFree = await dockerManager.checkPort(port);
  if (!portFree) {
    throw new Error(`Port ${port} is already in use by another process.`);
  }
  await dockerManager.up();
  const healthy = await dockerManager.healthCheck(`http://localhost:${port}/health`);
  if (!healthy) {
    throw new Error("Backend failed to start — health check timed out after 30 seconds.");
  }
  sendToRenderer("docker:status-change", { status: "running" });
  return { ok: true };
});

ipcMain.handle("docker:stop", async () => {
  await dockerManager.down();
  sendToRenderer("docker:status-change", { status: "stopped" });
  return { ok: true };
});

ipcMain.handle("docker:container-status", async () => {
  return dockerManager.status();
});

ipcMain.handle("docker:image-version", () => {
  return dockerManager.readEnvFile().foampilotVersion;
});

// ── Update IPC handlers ──────────────────────────────────────────────

ipcMain.handle("update:check-container", async () => {
  return updateManager.checkForContainerUpdate();
});

ipcMain.handle("update:check-electron", () => {
  updateManager.checkForElectronUpdate();
  return { ok: true };
});

// ── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Initialize Docker manager
  dockerManager = new DockerManager();
  updateManager = new UpdateManager(dockerManager);

  // Set up data directory
  await dockerManager.ensureDataDir();

  createWindow();

  // Check for updates (non-blocking)
  updateManager.checkForElectronUpdate();

  updateManager.on("electron-update-available", (info) => {
    sendToRenderer("update:available", { type: "electron", ...info });
  });

  updateManager.on("container-update-available", (info) => {
    sendToRenderer("update:available", { type: "container", ...info });
  });

  // Check for container updates in background
  updateManager.checkForContainerUpdate();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Stop container on quit
app.on("will-quit", async (e) => {
  if (!dockerManager) return;
  try {
    const status = await dockerManager.status();
    if (status === "running") {
      e.preventDefault();
      await dockerManager.down();
      app.quit();
    }
  } catch {
    // Don't block quit if docker down fails
  }
});
