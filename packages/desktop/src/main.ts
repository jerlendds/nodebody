import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import started from "electron-squirrel-startup";
import registerIpcHandlers from "./ipc/index";
// handle creating/removing shortcuts on install/uninstall (Windows)
if (started) {
  app.quit();
}

const preload = path.join(__dirname, "preload.js");

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: { preload },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// some APIs can only be used after this event occurs
app.on("ready", createWindow);

// register all ipc handlers at packages/desktop/src/ipc/
registerIpcHandlers();

// quit when all windows are closed (except macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // it's common to re-create a window on dock icon click (OS X)
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
