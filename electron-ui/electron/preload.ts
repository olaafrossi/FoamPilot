import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("foamPilot", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  openParaView: (casePath: string) => ipcRenderer.invoke("open-paraview", casePath),
  openFolder: (folderPath: string) => ipcRenderer.invoke("open-folder", folderPath),
  selectFile: (filters: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke("select-file", filters),
  readFile: (filePath: string) => ipcRenderer.invoke("read-file", filePath),
});
