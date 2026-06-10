import { contextBridge, ipcRenderer } from "electron";
import type { ContextMenuAction } from "@interfacez/ui";

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
  items: () => ipcRenderer.invoke("spaces:items"),
  setXplorerExpandedIds: (ids: string[]) =>
    ipcRenderer.invoke("spaces:setXplorerExpandedIds", ids),
  setXplorerOpen: (open: boolean) =>
    ipcRenderer.invoke("spaces:setXplorerOpen", open),
  readDesignTokens: () => ipcRenderer.invoke("spaces:readDesignTokens"),
  writeDesignTokens: (value: string) =>
    ipcRenderer.invoke("spaces:writeDesignTokens", value),
  readItem: (itemPath: string) =>
    ipcRenderer.invoke("spaces:readItem", itemPath),
  readItemDataUrl: (itemPath: string) =>
    ipcRenderer.invoke("spaces:readItemDataUrl", itemPath),
  relativeItemPath: (itemPath: string) =>
    ipcRenderer.invoke("spaces:relativeItemPath", itemPath),
  createFile: (parentPath: string, name: string) =>
    ipcRenderer
      .invoke("spaces:createFile", parentPath, name)
      .then((itemPath) => {
        window.dispatchEvent(new CustomEvent("spaces:changed"));
        return itemPath;
      }),
  createFolder: (parentPath: string, name: string) =>
    ipcRenderer
      .invoke("spaces:createFolder", parentPath, name)
      .then((itemPath) => {
        window.dispatchEvent(new CustomEvent("spaces:changed"));
        return itemPath;
      }),
  createWebFolder: (parentPath: string, name: string) =>
    ipcRenderer
      .invoke("spaces:createWebFolder", parentPath, name)
      .then((itemPath) => {
        window.dispatchEvent(new CustomEvent("spaces:changed"));
        return itemPath;
      }),
  renameItem: (itemPath: string, name: string) =>
    ipcRenderer.invoke("spaces:renameItem", itemPath, name).then((nextPath) => {
      window.dispatchEvent(new CustomEvent("spaces:changed"));
      return nextPath;
    }),
  deleteItem: (itemPath: string) =>
    ipcRenderer.invoke("spaces:deleteItem", itemPath).then((trashPath) => {
      window.dispatchEvent(new CustomEvent("spaces:changed"));
      return trashPath;
    }),
  writeItem: (itemPath: string, value: string) =>
    ipcRenderer.invoke("spaces:writeItem", itemPath, value),
  create: (directoryPath: string) =>
    ipcRenderer.invoke("spaces:create", directoryPath).then((space) => {
      window.dispatchEvent(new CustomEvent("spaces:changed"));
      return space;
    }),
  select: (directoryPath: string) =>
    ipcRenderer.invoke("spaces:select", directoryPath).then((space) => {
      window.dispatchEvent(new CustomEvent("spaces:changed"));
      return space;
    }),
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
