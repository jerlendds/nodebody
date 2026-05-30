import { BrowserWindow, dialog, ipcMain, OpenDialogOptions } from "electron";

export function registerOsIpc() {
  ipcMain.handle("os:selectFolder", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Select a folder",
      properties: ["openDirectory"] as OpenDialogOptions["properties"],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? undefined : result.filePaths[0];
  });
}
