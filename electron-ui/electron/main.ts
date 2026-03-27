import { app, BrowserWindow, ipcMain, shell, dialog, Notification } from "electron";
import * as path from "path";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;

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

// IPC handlers
ipcMain.handle("get-config", () => loadConfig());

ipcMain.handle("open-paraview", async (_, casePath: string) => {
  const config = loadConfig();
  const foamFile = path.join(casePath, path.basename(casePath) + ".foam");

  // Create .foam file if it doesn't exist (ParaView needs it)
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
