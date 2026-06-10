import type { Component } from "@nodebody/ui";
import { disposable, el } from "@nodebody/ui";
import PreviewBuildWorker from "./web-project-preview.worker?worker";

type ProjectLanguage =
  | "typescript"
  | "javascript"
  | "html"
  | "css"
  | "json";

interface ProjectFile {
  path: string;
  language: ProjectLanguage;
  content: string;
  dirty: boolean;
}

interface ProjectState {
  files: Record<string, ProjectFile>;
  entry: string;
  dependencies: Record<string, string>;
}

interface WebProjectPreviewOptions {
  rootPath: string;
}

interface BuildDiagnostic {
  text: string;
  location?: string;
}

interface BuildOutput {
  html: string;
  css: string;
  diagnostics: BuildDiagnostic[];
}

type WorkerResponse =
  | { type: "success"; requestId: number; output: BuildOutput }
  | { type: "failure"; requestId: number; diagnostics: BuildDiagnostic[] };

type PreviewMessage =
  | { source: "preview-runtime"; type: "ready" }
  | {
      source: "preview-runtime";
      type: "console";
      level: "log" | "warn" | "error";
      args: string[];
    }
  | {
      source: "preview-runtime";
      type: "runtime-error";
      message: string;
      stack?: string;
    };

const supportedExtensions = new Set([
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
]);

export function createWebProjectPreview(
  options: WebProjectPreviewOptions,
): Component {
  return {
    mount(root, scope) {
      const shell = el("div", "nb-web-project nb-web-project--preview-only");
      const preview = el(
        "iframe",
        "nb-web-project__iframe",
      ) as HTMLIFrameElement;
      const diagnostics = el("div", "nb-web-project__diagnostics");
      const status = el("div", "nb-web-project__status", "Loading preview...");
      const consoleOutput = el("div", "nb-web-project__console-output");

      preview.sandbox.add("allow-scripts");
      preview.referrerPolicy = "no-referrer";
      shell.append(preview, diagnostics, status, consoleOutput);
      root.replaceChildren(shell);

      const buildWorker = new PreviewBuildWorker();
      let buildRequestId = 0;
      scope.add(disposable(() => buildWorker.terminate()));

      buildWorker.addEventListener(
        "message",
        (event: MessageEvent<WorkerResponse>) => {
          const response = event.data;
          if (response.requestId !== buildRequestId) return;
          if (response.type === "failure") {
            renderDiagnostics(response.diagnostics);
            status.textContent = "Preview build failed";
            return;
          }
          renderDiagnostics(response.output.diagnostics);
          preview.srcdoc = response.output.html;
          status.textContent = "Preview ready";
        },
      );

      const onPreviewMessage = (event: MessageEvent) => {
        if (event.source !== preview.contentWindow) return;
        if (!isPreviewMessage(event.data)) return;
        if (event.data.type === "runtime-error") {
          renderDiagnostics([
            { text: event.data.stack ?? event.data.message, location: "runtime" },
          ]);
        }
        if (event.data.type === "console" && event.data.level === "error") {
          appendConsole(event.data.args.join(" "));
        }
      };
      window.addEventListener("message", onPreviewMessage);
      scope.add(
        disposable(() => window.removeEventListener("message", onPreviewMessage)),
      );

      void loadAndBuild();

      async function loadAndBuild() {
        try {
          const project = await readProjectState(options.rootPath);
          buildRequestId += 1;
          status.textContent = "Building preview...";
          buildWorker.postMessage({
            type: "build",
            requestId: buildRequestId,
            project,
            mode: "full",
          });
        } catch (error) {
          status.textContent = "Preview build failed";
          renderDiagnostics([{ text: errorMessage(error) }]);
        }
      }

      function renderDiagnostics(items: readonly BuildDiagnostic[]) {
        diagnostics.replaceChildren();
        for (const item of items) {
          const row = el("div", "nb-web-project__diagnostic");
          row.textContent = item.location
            ? `${item.location}: ${item.text}`
            : item.text;
          diagnostics.append(row);
        }
      }

      function appendConsole(text: string) {
        const row = el("div", "nb-web-project__console-row is-error");
        row.textContent = text;
        consoleOutput.append(row);
      }
    },
  };
}

async function readProjectState(rootPath: string): Promise<ProjectState> {
  const items = await window.spaces.items();
  const rootNode = findNode(items, rootPath);
  if (!rootNode || rootNode.kind !== "folder") {
    throw new Error(`Web folder not found: ${rootPath}`);
  }

  const files: Record<string, ProjectFile> = {};
  for (const item of flattenFiles(rootNode.children ?? [])) {
    if (!supportedExtensions.has(fileExtension(item.name))) continue;
    const virtualPath = toVirtualPath(relativePath(rootPath, item.id));
    files[virtualPath] = {
      path: virtualPath,
      language: languageForPath(item.name),
      content: await window.spaces.readItem(item.id),
      dirty: false,
    };
  }

  const dependencies = dependenciesFromPackageJson(files["/package.json"]?.content);
  return {
    files,
    entry: pickEntry(files),
    dependencies,
  };
}

function flattenFiles(items: readonly SpaceItem[]): SpaceItem[] {
  const files: SpaceItem[] = [];
  for (const item of items) {
    if (item.kind === "file") files.push(item);
    else files.push(...flattenFiles(item.children ?? []));
  }
  return files;
}

function findNode(nodes: readonly SpaceItem[], id: string): SpaceItem | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children ?? [], id);
    if (child) return child;
  }
  return undefined;
}

function dependenciesFromPackageJson(content: string | undefined) {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Object.fromEntries(
      Object.entries({
        ...(parsed.dependencies ?? {}),
        ...(parsed.devDependencies ?? {}),
      }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function pickEntry(files: Record<string, ProjectFile>) {
  const preferred = [
    "/index.html",
    "/src/main.tsx",
    "/src/main.jsx",
    "/src/main.ts",
    "/src/main.js",
    "/main.tsx",
    "/main.jsx",
    "/main.ts",
    "/main.js",
  ];
  return preferred.find((path) => files[path]) ?? Object.keys(files)[0] ?? "/";
}

function languageForPath(fileName: string): ProjectLanguage {
  const extension = fileExtension(fileName);
  if (extension === ".html") return "html";
  if (extension === ".css") return "css";
  if (extension === ".json") return "json";
  if (extension === ".ts" || extension === ".tsx") return "typescript";
  return "javascript";
}

function fileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function relativePath(root: string, path: string) {
  const normalizedRoot = normalizePath(root).replace(/\/$/, "");
  const normalizedPath = normalizePath(path);
  if (normalizedPath === normalizedRoot) return "";
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function toVirtualPath(path: string) {
  return `/${normalizePath(path).replace(/^\/+/, "")}`;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

function isPreviewMessage(value: unknown): value is PreviewMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { source?: unknown }).source === "preview-runtime",
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
