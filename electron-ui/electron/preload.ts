import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("foamPilot", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  openParaView: (casePath: string) => ipcRenderer.invoke("open-paraview", casePath),
  openFolder: (folderPath: string) => ipcRenderer.invoke("open-folder", folderPath),
  selectFile: (filters: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke("select-file", filters),
  readFile: (filePath: string) => ipcRenderer.invoke("read-file", filePath),

  // Docker lifecycle
  docker: {
    getStatus: () => ipcRenderer.invoke("docker:status"),
    pull: (tag?: string) => ipcRenderer.invoke("docker:pull", tag),
    start: () => ipcRenderer.invoke("docker:start"),
    stop: () => ipcRenderer.invoke("docker:stop"),
    getContainerStatus: () => ipcRenderer.invoke("docker:container-status"),
    getImageVersion: () => ipcRenderer.invoke("docker:image-version"),
    onProgress: (cb: (msg: string) => void) => {
      const handler = (_: any, msg: string) => cb(msg);
      ipcRenderer.on("docker:progress", handler);
      return () => { ipcRenderer.removeListener("docker:progress", handler); };
    },
    onStatusChange: (cb: (status: any) => void) => {
      const handler = (_: any, s: any) => cb(s);
      ipcRenderer.on("docker:status-change", handler);
      return () => { ipcRenderer.removeListener("docker:status-change", handler); };
    },
  },

  // Updates
  updates: {
    checkContainer: () => ipcRenderer.invoke("update:check-container"),
    checkElectron: () => ipcRenderer.invoke("update:check-electron"),
    onAvailable: (cb: (info: any) => void) => {
      const handler = (_: any, info: any) => cb(info);
      ipcRenderer.on("update:available", handler);
      return () => { ipcRenderer.removeListener("update:available", handler); };
    },
  },
});
