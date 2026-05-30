import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

export interface Space {
  name: string;
  path: string;
}

export interface SpacesStore {
  spaces: Space[];
  selectedSpacePath?: string;
}

const NodebodyDirName = "nodebody";
const SpacesFileName = "spaces.json";

export function getNodebodyDataDir() {
  return path.join(app.getPath("appData"), NodebodyDirName);
}

export function getNodebodyDataFile(name: string) {
  return path.join(getNodebodyDataDir(), name);
}

export async function ensureNodebodyDataDir() {
  const dir = getNodebodyDataDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function readSpacesStore(): Promise<SpacesStore> {
  try {
    const raw = await fs.readFile(getNodebodyDataFile(SpacesFileName), "utf8");
    return normalizeSpacesStore(JSON.parse(raw));
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return { spaces: [] };
    }
    throw error;
  }
}

export async function writeSpacesStore(store: SpacesStore) {
  await ensureNodebodyDataDir();
  await fs.writeFile(
    getNodebodyDataFile(SpacesFileName),
    `${JSON.stringify(normalizeSpacesStore(store), null, 2)}\n`,
    "utf8",
  );
}

export async function createSpace(directoryPath: string): Promise<Space> {
  const spacePath = await normalizeDirectoryPath(directoryPath);
  const space: Space = {
    name: path.basename(spacePath),
    path: spacePath,
  };

  await fs.mkdir(path.join(spacePath, ".nb"), { recursive: true });
  await saveSpace(space);
  return space;
}

export async function selectSpace(directoryPath: string): Promise<Space> {
  const spacePath = await normalizeDirectoryPath(directoryPath);
  const metadata = path.join(spacePath, ".nb");
  const stat = await fs.stat(metadata);
  if (!stat.isDirectory()) {
    throw new Error(`Space metadata path is not a directory: ${metadata}`);
  }

  const space: Space = {
    name: path.basename(spacePath),
    path: spacePath,
  };
  await saveSpace(space);
  return space;
}

export function formatHomePathForDisplay(filePath: string) {
  const home = path.resolve(os.homedir());
  const resolved = path.resolve(filePath);
  const relative = path.relative(home, resolved);

  if (!relative) return "~";
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `~${path.sep}${relative}`;
  }

  return filePath;
}

async function saveSpace(space: Space) {
  const store = await readSpacesStore();
  const spaces = [
    space,
    ...store.spaces.filter((item) => item.path !== space.path),
  ];
  await writeSpacesStore({
    spaces,
    selectedSpacePath: space.path,
  });
}

async function normalizeDirectoryPath(directoryPath: string) {
  const trimmed = directoryPath.trim();
  if (!trimmed) throw new Error("A directory path is required.");

  const resolved = path.resolve(trimmed);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }
  return resolved;
}

function normalizeSpacesStore(value: unknown): SpacesStore {
  if (Array.isArray(value)) return { spaces: normalizeSpaces(value) };
  if (!value || typeof value !== "object") return { spaces: [] };

  const candidate = value as Partial<SpacesStore>;
  const selectedSpacePath =
    typeof candidate.selectedSpacePath === "string"
      ? candidate.selectedSpacePath
      : undefined;
  return {
    spaces: normalizeSpaces(candidate.spaces),
    ...(selectedSpacePath ? { selectedSpacePath } : {}),
  };
}

function normalizeSpaces(value: unknown) {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const spaces: Space[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const space = item as Partial<Space>;
    if (typeof space.name !== "string" || typeof space.path !== "string") {
      continue;
    }
    if (seen.has(space.path)) continue;
    seen.add(space.path);
    spaces.push({ name: space.name, path: space.path });
  }
  return spaces;
}

function isErrorWithCode(error: unknown, code: string) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
