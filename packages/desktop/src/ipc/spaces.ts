import { ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createSpace,
  formatHomePathForDisplay,
  readSpacesStore,
  selectSpace,
  updateSpaceXplorerExpandedIds,
  type Space,
} from "../utils";

export interface DisplaySpace extends Space {
  displayPath: string;
}

export interface SpaceItem {
  id: string;
  name: string;
  kind: "folder" | "file";
  children?: SpaceItem[];
}

let activeSpacePath: string | undefined;

export function registerSpacesIpc() {
  ipcMain.handle("spaces:list", async () => {
    const store = await readSpacesStore();
    return store.spaces.map(withDisplayPath);
  });

  ipcMain.handle("spaces:selected", async () => {
    const store = await readSpacesStore();
    const selected = store.spaces.find(
      (space) => space.path === activeSpacePath,
    );
    return selected ? withDisplayPath(selected) : undefined;
  });

  ipcMain.handle("spaces:create", async (_event, directoryPath: string) => {
    const space = await createSpace(directoryPath);
    activeSpacePath = space.path;
    return withDisplayPath(space);
  });

  ipcMain.handle("spaces:select", async (_event, directoryPath: string) => {
    const space = await selectSpace(directoryPath);
    activeSpacePath = space.path;
    return withDisplayPath(space);
  });

  ipcMain.handle("spaces:items", async () => {
    if (!activeSpacePath) return [];
    return listSpaceItems(activeSpacePath);
  });

  ipcMain.handle("spaces:setXplorerExpandedIds", async (_event, ids: string[]) => {
    if (!activeSpacePath) return;
    await updateSpaceXplorerExpandedIds(activeSpacePath, ids);
  });

  ipcMain.handle("spaces:readItem", async (_event, itemPath: string) => {
    const resolved = assertActiveSpaceItemPath(itemPath);
    return fs.readFile(resolved, "utf8");
  });

  ipcMain.handle(
    "spaces:writeItem",
    async (_event, itemPath: string, value: string) => {
      const resolved = assertActiveSpaceItemPath(itemPath);
      await fs.writeFile(resolved, value, "utf8");
    },
  );
}

function withDisplayPath(space: Space): DisplaySpace {
  return {
    ...space,
    displayPath: formatHomePathForDisplay(space.path),
  };
}

async function listSpaceItems(spacePath: string): Promise<SpaceItem[]> {
  const entries = await fs.readdir(spacePath, { withFileTypes: true });
  const items = entries
    .filter((entry) => entry.name !== ".nb")
    .map(async (entry): Promise<SpaceItem> => {
      const id = path.join(spacePath, entry.name);
      if (!entry.isDirectory()) {
        return { id, name: entry.name, kind: "file" };
      }
      return {
        id,
        name: entry.name,
        kind: "folder",
        children: await listSpaceItems(id),
      };
    });

  return (await Promise.all(items)).sort(compareSpaceItems);
}

function compareSpaceItems(a: SpaceItem, b: SpaceItem) {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function assertActiveSpaceItemPath(itemPath: string) {
  if (!activeSpacePath) throw new Error("Please select a space");

  const spacePath = path.resolve(activeSpacePath);
  const resolved = path.resolve(itemPath);
  const relative = path.relative(spacePath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the active space: ${itemPath}`);
  }

  return resolved;
}
