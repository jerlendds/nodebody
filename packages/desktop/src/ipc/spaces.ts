import { ipcMain } from "electron";
import {
  createSpace,
  readSpacesStore,
  selectSpace,
  type Space,
} from "../utils";

export type { Space };

export function registerSpacesIpc() {
  ipcMain.handle("spaces:list", async () => {
    const store = await readSpacesStore();
    return store.spaces;
  });

  ipcMain.handle("spaces:selected", async () => {
    const store = await readSpacesStore();
    return (
      store.spaces.find((space) => space.path === store.selectedSpacePath) ??
      undefined
    );
  });

  ipcMain.handle("spaces:create", async (_event, directoryPath: string) => {
    return createSpace(directoryPath);
  });

  ipcMain.handle("spaces:select", async (_event, directoryPath: string) => {
    return selectSpace(directoryPath);
  });
}
