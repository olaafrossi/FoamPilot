import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("foamPilot", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (config: any) => ipcRenderer.invoke("save-config", config),
  openParaView: (casePath: string) => ipcRenderer.invoke("open-paraview", casePath),
  openFolder: (folderPath: string) => ipcRenderer.invoke("open-folder", folderPath),
  selectFile: (filters: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke("select-file", filters),
  readFile: (filePath: string) => ipcRenderer.invoke("read-file", filePath),
  showNotification: (title: string, body: string) => ipcRenderer.invoke("show-notification", title, body),

  // Tutorial status
  tutorials: {
    getStatus: () => ipcRenderer.invoke("tutorial:get-status"),
    setCompleted: (key: string) => ipcRenderer.invoke("tutorial:set-completed", key),
  },

  // Docker management
  docker: {
    getStatus: () => ipcRenderer.invoke("docker:status"),
    pull: (tag?: string) => ipcRenderer.invoke("docker:pull", tag),
    start: () => ipcRenderer.invoke("docker:start"),
    stop: () => ipcRenderer.invoke("docker:stop"),
    ensureSetup: () => ipcRenderer.invoke("docker:ensure-setup"),
    healthCheck: () => ipcRenderer.invoke("docker:health"),
    ping: () => ipcRenderer.invoke("docker:ping"),
    diagnostics: () => ipcRenderer.invoke("docker:diagnostics"),
    getSystemResources: () => ipcRenderer.invoke("docker:get-system-resources"),
    updateResources: (config: any) => ipcRenderer.invoke("docker:update-resources", config),
    onProgress: (cb: (msg: string) => void) => {
      const handler = (_: any, msg: string) => cb(msg);
      ipcRenderer.on("docker:progress", handler);
      return () => ipcRenderer.removeListener("docker:progress", handler);
    },
    onStatusChange: (cb: (status: any) => void) => {
      const handler = (_: any, s: any) => cb(s);
      ipcRenderer.on("docker:status-change", handler);
      return () => ipcRenderer.removeListener("docker:status-change", handler);
    },

    // Auto-install (Windows)
    checkWsl: () => ipcRenderer.invoke("docker:check-wsl"),
    checkWinget: () => ipcRenderer.invoke("docker:check-winget"),
    checkWindowsBuild: () => ipcRenderer.invoke("docker:check-windows-build"),
    installWsl: () => ipcRenderer.invoke("docker:install-wsl"),
    installDocker: () => ipcRenderer.invoke("docker:install-docker"),
    startDesktop: () => ipcRenderer.invoke("docker:start-desktop"),
    getInstallState: () => ipcRenderer.invoke("docker:get-install-state"),
    clearInstallState: () => ipcRenderer.invoke("docker:clear-install-state"),
    onInstallProgress: (cb: (data: any) => void) => {
      const handler = (_: any, data: any) => cb(data);
      ipcRenderer.on("docker:install-progress", handler);
      return () => ipcRenderer.removeListener("docker:install-progress", handler);
    },
  },

  // Update management
  updates: {
    check: () => ipcRenderer.invoke("update:check"),
    applyContainer: (tag: string) => ipcRenderer.invoke("update:apply-container", tag),
    getAppVersion: () => ipcRenderer.invoke("update:app-version"),
    onAvailable: (cb: (info: any) => void) => {
      const handler = (_: any, info: any) => cb(info);
      ipcRenderer.on("update:available", handler);
      return () => ipcRenderer.removeListener("update:available", handler);
    },
    onDownloaded: (cb: (info: any) => void) => {
      const handler = (_: any, info: any) => cb(info);
      ipcRenderer.on("update:downloaded", handler);
      return () => ipcRenderer.removeListener("update:downloaded", handler);
    },
  },
});
