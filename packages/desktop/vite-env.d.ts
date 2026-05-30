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
}

interface SpacesApi {
  list: () => Promise<Space[]>;
  selected: () => Promise<Space | undefined>;
  create: (directoryPath: string) => Promise<Space>;
  select: (directoryPath: string) => Promise<Space>;
}

interface Window {
  os: OsApi;
  spaces: SpacesApi;
  win: WindowApi;
  versions: VersionsApi;
}
