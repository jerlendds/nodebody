import { contextBridge, ipcRenderer } from "electron";
import type { ContextMenuAction } from "@nodebody/ui";

/// custom titlebar bridge
contextBridge.exposeInMainWorld("win", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
});

/// metadata
contextBridge.exposeInMainWorld("versions", {
  chrome: () => process.versions.chrome,
});

contextBridge.exposeInMainWorld("os", {
  selectFolder: () => ipcRenderer.invoke("os:selectFolder"),
});

contextBridge.exposeInMainWorld("spaces", {
  list: () => ipcRenderer.invoke("spaces:list"),
  selected: () => ipcRenderer.invoke("spaces:selected"),
  create: (directoryPath: string) =>
    ipcRenderer.invoke("spaces:create", directoryPath),
  select: (directoryPath: string) =>
    ipcRenderer.invoke("spaces:select", directoryPath),
});

contextBridge.exposeInMainWorld("contextMenu", {
  show(payload: {
    actions: readonly ContextMenuAction[];
    x: number;
    y: number;
  }) {
    return ipcRenderer.invoke("context-menu:show", payload);
  },
});
