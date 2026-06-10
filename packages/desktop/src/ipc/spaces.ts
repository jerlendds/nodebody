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

  ipcMain.handle("spaces:readItemDataUrl", async (_event, itemPath: string) => {
    const resolved = assertActiveSpaceItemPath(itemPath);
    const data = await fs.readFile(resolved);
    return `data:${mimeTypeForPath(resolved)};base64,${data.toString("base64")}`;
  });

  ipcMain.handle("spaces:relativeItemPath", async (_event, itemPath: string) => {
    const resolved = assertActiveSpaceItemPath(itemPath);
    return path.relative(path.resolve(activeSpacePath!), resolved);
  });

  ipcMain.handle(
    "spaces:createFile",
    async (_event, parentPath: string, name: string) => {
      const parent = assertActiveSpaceItemPath(parentPath);
      await assertDirectory(parent);
      const filePath = childPath(parent, name);
      await fs.writeFile(filePath, "", { flag: "wx" });
      return filePath;
    },
  );

  ipcMain.handle(
    "spaces:createFolder",
    async (_event, parentPath: string, name: string) => {
      const parent = assertActiveSpaceItemPath(parentPath);
      await assertDirectory(parent);
      const folderPath = childPath(parent, name);
      await fs.mkdir(folderPath);
      return folderPath;
    },
  );

  ipcMain.handle(
    "spaces:renameItem",
    async (_event, itemPath: string, name: string) => {
      const resolved = assertActiveSpaceItemPath(itemPath);
      const target = childPath(path.dirname(resolved), name);
      assertActiveSpaceItemPath(target);
      await assertAvailable(target);
      await fs.rename(resolved, target);
      return target;
    },
  );

  ipcMain.handle("spaces:deleteItem", async (_event, itemPath: string) => {
    try {
      const resolved = assertActiveSpaceItemPath(itemPath);
      const target = await trashItem(resolved);
      return target;
    } catch (error) {
      console.error("[spaces:deleteItem] failed", {
        itemPath,
        activeSpacePath,
        error,
      });
      throw error;
    }
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
    .filter((entry) => !isHiddenSpaceItem(entry.name))
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

function isHiddenSpaceItem(name: string) {
  return name.startsWith(".");
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

async function trashItem(itemPath: string) {
  if (!activeSpacePath) throw new Error("Please select a space");

  const trashPath = path.join(path.resolve(activeSpacePath), ".nb", "trash");
  const relative = path.relative(trashPath, itemPath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error("Item is already in Trash.");
  }

  const sourceBefore = await statSummary(itemPath);

  await fs.mkdir(trashPath, { recursive: true });
  const target = await availableTrashPath(trashPath, path.basename(itemPath));

  await moveToTrash(itemPath, target);
  const sourceAfter = await statSummary(itemPath);
  const targetAfter = await statSummary(target);

  if (sourceAfter.exists) {
    throw new Error(`Could not move item to Trash: ${itemPath}`);
  }
  return target;
}

async function moveToTrash(itemPath: string, target: string) {
  try {
    await fs.rename(itemPath, target);
  } catch (error) {
    console.error("[spaces:moveToTrash] rename failed", {
      itemPath,
      target,
      error,
    });
    if (!isErrorCode(error, "EXDEV")) throw error;
    console.warn("[spaces:moveToTrash] falling back after EXDEV", {
      itemPath,
      target,
    });
    await copyThenRemove(itemPath, target);
    return;
  }

  if (await isPathAvailable(itemPath)) return;
  console.warn("[spaces:moveToTrash] source still exists after rename", {
    itemPath,
    target,
  });
  await copyThenRemove(itemPath, target);
}

async function copyThenRemove(itemPath: string, target: string) {
  if (!(await isPathAvailable(target))) {
    throw new Error(`Trash target already exists: ${target}`);
  }
  await fs.cp(itemPath, target, { recursive: true, errorOnExist: true });
  await fs.rm(itemPath, { recursive: true, force: false });
}

async function availableTrashPath(trashPath: string, name: string) {
  const parsed = path.parse(name);
  let candidate = path.join(trashPath, name);
  let index = 1;

  while (!(await isPathAvailable(candidate))) {
    const suffix = ` ${index}`;
    candidate = path.join(
      trashPath,
      `${parsed.name}${suffix}${parsed.ext}`,
    );
    index += 1;
  }

  return candidate;
}

async function assertDirectory(itemPath: string) {
  const stat = await fs.stat(itemPath);
  if (!stat.isDirectory()) throw new Error(`Path is not a folder: ${itemPath}`);
}

async function assertAvailable(itemPath: string) {
  if (await isPathAvailable(itemPath)) return;
  throw new Error(`Path already exists: ${itemPath}`);
}

async function isPathAvailable(itemPath: string) {
  try {
    await fs.stat(itemPath);
  } catch (error) {
    if (isNotFoundError(error)) return true;
    throw error;
  }
  return false;
}

async function statSummary(itemPath: string) {
  try {
    const stat = await fs.stat(itemPath);
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { exists: false };
    }
    return {
      exists: "unknown",
      error,
    };
  }
}

function childPath(parentPath: string, name: string) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Name is required.");
  if (cleanName !== path.basename(cleanName)) {
    throw new Error(`Name cannot include path separators: ${name}`);
  }
  return path.join(parentPath, cleanName);
}

function isNotFoundError(error: unknown) {
  return isErrorCode(error, "ENOENT");
}

function isErrorCode(error: unknown, code: string) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === code;
}

function mimeTypeForPath(itemPath: string) {
  switch (path.extname(itemPath).toLowerCase()) {
    case ".apng":
      return "image/apng";
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".jpg":
    case ".jpeg":
    case ".jfif":
    case ".pjpeg":
    case ".pjp":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".3g2":
      return "video/3gpp2";
    case ".3gp":
      return "video/3gpp";
    case ".avi":
      return "video/x-msvideo";
    case ".m4v":
      return "video/x-m4v";
    case ".mkv":
      return "video/x-matroska";
    case ".mov":
      return "video/quicktime";
    case ".mp4":
      return "video/mp4";
    case ".mpeg":
    case ".mpg":
      return "video/mpeg";
    case ".ogm":
    case ".ogv":
      return "video/ogg";
    case ".webm":
      return "video/webm";
    case ".wmv":
      return "video/x-ms-wmv";
    default:
      return "application/octet-stream";
  }
}
