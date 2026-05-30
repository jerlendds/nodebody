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

contextBridge.exposeInMainWorld("contextMenu", {
  show(payload: {
    actions: readonly ContextMenuAction[];
    x: number;
    y: number;
  }) {
    return ipcRenderer.invoke("context-menu:show", payload);
  },
});
