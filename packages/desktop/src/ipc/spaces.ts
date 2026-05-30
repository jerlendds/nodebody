import { ipcMain } from "electron";
import {
  createSpace,
  formatHomePathForDisplay,
  readSpacesStore,
  selectSpace,
  type Space,
} from "../utils";

export interface DisplaySpace extends Space {
  displayPath: string;
}

export function registerSpacesIpc() {
  ipcMain.handle("spaces:list", async () => {
    const store = await readSpacesStore();
    return store.spaces.map(withDisplayPath);
  });

  ipcMain.handle("spaces:selected", async () => {
    const store = await readSpacesStore();
    const selected = store.spaces.find(
      (space) => space.path === store.selectedSpacePath,
    );
    return selected ? withDisplayPath(selected) : undefined;
  });

  ipcMain.handle("spaces:create", async (_event, directoryPath: string) => {
    return withDisplayPath(await createSpace(directoryPath));
  });

  ipcMain.handle("spaces:select", async (_event, directoryPath: string) => {
    return withDisplayPath(await selectSpace(directoryPath));
  });
}

function withDisplayPath(space: Space): DisplaySpace {
  return {
    ...space,
    displayPath: formatHomePathForDisplay(space.path),
  };
}
