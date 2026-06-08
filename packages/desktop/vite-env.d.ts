/// <reference types="./forge.env.d.ts" />

declare module "*.css";

declare module "*.svg?raw" {
  const content: string;
  export default content;
}

interface VersionsApi {
  chrome: () => string;
}

interface WindowApi {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

interface OsApi {
  selectFolder?: () => Promise<string | undefined>;
}

interface Space {
  name: string;
  path: string;
  displayPath: string;
  xplorerExpandedIds?: string[];
}

interface SpaceItem {
  id: string;
  name: string;
  kind: "folder" | "file";
  children?: SpaceItem[];
}

interface SpacesApi {
  list: () => Promise<Space[]>;
  selected: () => Promise<Space | undefined>;
  items: () => Promise<SpaceItem[]>;
  setXplorerExpandedIds: (ids: string[]) => Promise<void>;
  readItem: (itemPath: string) => Promise<string>;
  writeItem: (itemPath: string, value: string) => Promise<void>;
  create: (directoryPath: string) => Promise<Space>;
  select: (directoryPath: string) => Promise<Space>;
}

interface Window {
  os: OsApi;
  spaces: SpacesApi;
  win: WindowApi;
  versions: VersionsApi;
}
