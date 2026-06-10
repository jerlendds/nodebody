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
  onOpenSource?: (source: SourceLocation) => void;
}

interface BuildDiagnostic {
  text: string;
  location?: string;
}

interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

interface CssRuleOrigin {
  ruleId: string;
  file: string;
  selector: string;
  startLine: number;
  endLine: number;
  declarations: Record<string, string>;
}

interface BuildOutput {
  html: string;
  css: string;
  cssRules: CssRuleOrigin[];
  diagnostics: BuildDiagnostic[];
}

type WorkerResponse =
  | { type: "success"; requestId: number; output: BuildOutput }
  | { type: "failure"; requestId: number; diagnostics: BuildDiagnostic[] };

type PreviewMessage =
  | { source: "preview-runtime"; type: "ready" }
  | {
      source: "preview-runtime";
      type: "inspect-hover";
      selector: string;
      tag: string;
      box: PreviewBox;
    }
  | { source: "preview-runtime"; type: "inspect-hover-clear" }
  | {
      source: "preview-runtime";
      type: "inspect-select";
      payload: InspectedElementPayload;
    }
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

interface PreviewBox {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
}

interface MatchedCssRuleSummary {
  selector: string;
  declarations: Record<string, string>;
}

interface InspectedElementPayload {
  previewId?: string;
  selector: string;
  tagName: string;
  id?: string;
  classList: string[];
  attributes: Record<string, string>;
  textPreview?: string;
  source?: SourceLocation & { componentName?: string };
  box: PreviewBox;
  computedStyle: Record<string, string>;
  matchedRules?: MatchedCssRuleSummary[];
}

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
      const overlay = el("div", "nb-web-project__overlay");
      const hoverBox = el("div", "nb-web-project__inspect-box");
      const toolbar = el("div", "nb-web-project__toolbar");
      const inspectButton = el(
        "button",
        "nb-web-project__tool",
        "Inspect",
      ) as HTMLButtonElement;
      const inspectorPanel = el("aside", "nb-web-project__inspector");
      const diagnostics = el("div", "nb-web-project__diagnostics");
      const status = el("div", "nb-web-project__status", "Loading preview...");
      const consoleOutput = el("div", "nb-web-project__console-output");

      preview.sandbox.add("allow-scripts");
      preview.referrerPolicy = "no-referrer";
      toolbar.append(inspectButton);
      overlay.append(hoverBox);
      shell.append(
        preview,
        overlay,
        toolbar,
        inspectorPanel,
        diagnostics,
        status,
        consoleOutput,
      );
      root.replaceChildren(shell);

      const buildWorker = new PreviewBuildWorker();
      let buildRequestId = 0;
      let latestProject: ProjectState | undefined;
      let latestBuild: BuildOutput | undefined;
      let inspectMode = false;
      let selectedElement: InspectedElementPayload | undefined;
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
          latestBuild = response.output;
          renderDiagnostics(response.output.diagnostics);
          if (latestProject && response.output.css && pendingBuildMode === "css-only") {
            preview.contentWindow?.postMessage(
              { type: "css-update", css: response.output.css },
              "*",
            );
          } else {
            preview.srcdoc = response.output.html;
          }
          status.textContent = "Preview ready";
          pendingBuildMode = undefined;
        },
      );

      let pendingBuildMode: "full" | "css-only" | undefined;

      const toggleInspectMode = () => {
        inspectMode = !inspectMode;
        shell.classList.toggle("is-inspecting", inspectMode);
        inspectButton.classList.toggle("is-active", inspectMode);
        inspectButton.setAttribute(
          "aria-pressed",
          inspectMode ? "true" : "false",
        );
        preview.contentWindow?.postMessage(
          { type: inspectMode ? "inspector-enable" : "inspector-disable" },
          "*",
        );
        if (!inspectMode) {
          selectedElement = undefined;
          positionOverlay();
          renderInspectorPanel();
        }
      };
      inspectButton.type = "button";
      inspectButton.setAttribute("aria-pressed", "false");
      inspectButton.addEventListener("click", toggleInspectMode);
      scope.add(
        disposable(() => inspectButton.removeEventListener("click", toggleInspectMode)),
      );

      const onPreviewMessage = (event: MessageEvent) => {
        if (event.source !== preview.contentWindow) return;
        if (!isPreviewMessage(event.data)) return;
        if (event.data.type === "ready" && inspectMode) {
          preview.contentWindow?.postMessage({ type: "inspector-enable" }, "*");
        }
        if (event.data.type === "inspect-hover") {
          positionOverlay(event.data.box);
        }
        if (event.data.type === "inspect-hover-clear") {
          positionOverlay();
        }
        if (event.data.type === "inspect-select") {
          selectedElement = sanitizeInspectedPayload(event.data.payload);
          positionOverlay(selectedElement?.box);
          renderInspectorPanel();
        }
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

      const onWebFileSaved = (event: Event) => {
        const detail = (event as CustomEvent<{ filePath?: string }>).detail;
        const changedPath = detail?.filePath;
        if (!changedPath || !isPathInside(options.rootPath, changedPath)) return;
        void loadAndBuild(fileExtension(changedPath) === ".css" ? "css-only" : "full");
      };
      window.addEventListener("nb:web-file-saved", onWebFileSaved);
      scope.add(
        disposable(() =>
          window.removeEventListener("nb:web-file-saved", onWebFileSaved),
        ),
      );

      async function loadAndBuild(mode: "full" | "css-only" = "full") {
        try {
          const project = await readProjectState(options.rootPath);
          latestProject = project;
          buildRequestId += 1;
          pendingBuildMode = mode;
          status.textContent = "Building preview...";
          buildWorker.postMessage({
            type: "build",
            requestId: buildRequestId,
            project,
            mode,
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

      function positionOverlay(box?: PreviewBox) {
        if (!box || !inspectMode) {
          hoverBox.removeAttribute("style");
          hoverBox.hidden = true;
          return;
        }
        hoverBox.hidden = false;
        hoverBox.style.left = `${box.left}px`;
        hoverBox.style.top = `${box.top}px`;
        hoverBox.style.width = `${box.width}px`;
        hoverBox.style.height = `${box.height}px`;
      }

      function renderInspectorPanel() {
        inspectorPanel.replaceChildren();
        shell.classList.toggle("has-inspector-selection", Boolean(selectedElement));
        if (!selectedElement) return;

        const heading = el("div", "nb-web-project__inspector-heading");
        const title = el("div", "nb-web-project__inspector-title");
        title.textContent = elementLabel(selectedElement);
        const selector = el("div", "nb-web-project__inspector-subtitle");
        selector.textContent = selectedElement.selector;
        heading.append(title, selector);

        const sourceButton = el(
          "button",
          "nb-web-project__source-button",
        ) as HTMLButtonElement;
        sourceButton.type = "button";
        sourceButton.textContent = selectedElement.source
          ? `${selectedElement.source.file}:${selectedElement.source.line}`
          : "No source location";
        sourceButton.disabled = !selectedElement.source;
        sourceButton.addEventListener("click", () => {
          if (selectedElement?.source) options.onOpenSource?.(selectedElement.source);
        });

        const rules = matchedProjectRules(selectedElement, latestBuild?.cssRules ?? []);
        const ruleSection = el("section", "nb-web-project__inspector-section");
        const ruleTitle = el("h3", "nb-web-project__inspector-section-title", "Matched rules");
        const ruleList = el("div", "nb-web-project__rule-list");
        if (rules.length) {
          for (const rule of rules) {
            const row = el("div", "nb-web-project__rule-row");
            row.textContent = `${rule.selector}  ${rule.file}:${rule.startLine}`;
            ruleList.append(row);
          }
        } else {
          const empty = el("div", "nb-web-project__inspector-empty");
          empty.textContent = "No editable project CSS rule matched.";
          ruleList.append(empty);
        }
        ruleSection.append(ruleTitle, ruleList);

        const styleSection = el("section", "nb-web-project__inspector-section");
        const styleTitle = el("h3", "nb-web-project__inspector-section-title", "Styles");
        const styleGrid = el("div", "nb-web-project__style-grid");
        for (const property of editableStyleProperties) {
          const label = el("label", "nb-web-project__style-field");
          const name = el("span", "nb-web-project__style-name", property);
          const input = el("input", "nb-web-project__style-input") as HTMLInputElement;
          input.value = selectedElement.computedStyle[property] ?? "";
          input.addEventListener("change", () => {
            void patchSelectedCss(property, input.value);
          });
          label.append(name, input);
          styleGrid.append(label);
        }
        styleSection.append(styleTitle, styleGrid);

        inspectorPanel.append(heading, sourceButton, ruleSection, styleSection);
      }

      async function patchSelectedCss(property: string, value: string) {
        if (!selectedElement || !latestBuild) return;
        const patch = pickCssPatchTarget(
          selectedElement,
          latestBuild.cssRules,
          property,
          value,
        );
        if (!patch) {
          renderDiagnostics([
            {
              text: "Select an element with a class or matching CSS rule before editing styles.",
              location: "inspector",
            },
          ]);
          return;
        }

        const filePath = fromVirtualPath(options.rootPath, patch.file);
        const current = await window.spaces.readItem(filePath);
        const next = patchCssDeclaration(
          current,
          patch.selector,
          patch.property,
          patch.value,
        );
        await window.spaces.writeItem(filePath, next);
        window.dispatchEvent(
          new CustomEvent("nb:web-file-saved", {
            detail: { filePath },
          }),
        );
      }
    },
  };
}

const editableStyleProperties = [
  "display",
  "position",
  "margin",
  "padding",
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "borderRadius",
  "border",
  "gap",
  "flexDirection",
  "alignItems",
  "justifyContent",
  "gridTemplateColumns",
];

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
  if (!value || typeof value !== "object") return false;
  const message = value as { source?: unknown; type?: unknown };
  return message.source === "preview-runtime" && typeof message.type === "string";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeInspectedPayload(
  payload: InspectedElementPayload,
): InspectedElementPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (typeof payload.selector !== "string" || typeof payload.tagName !== "string") {
    return undefined;
  }
  return {
    previewId: optionalString(payload.previewId, 100),
    selector: payload.selector.slice(0, 300),
    tagName: payload.tagName.slice(0, 40),
    id: optionalString(payload.id, 120),
    classList: Array.isArray(payload.classList)
      ? payload.classList.filter((item) => typeof item === "string").slice(0, 100)
      : [],
    attributes: safeStringRecord(payload.attributes, 50, 500),
    textPreview: optionalString(payload.textPreview, 200),
    source: sanitizeSource(payload.source),
    box: sanitizeBox(payload.box),
    computedStyle: safeStringRecord(payload.computedStyle, 40, 500),
    matchedRules: Array.isArray(payload.matchedRules)
      ? payload.matchedRules
          .filter((rule) => rule && typeof rule.selector === "string")
          .slice(0, 20)
          .map((rule) => ({
            selector: rule.selector.slice(0, 300),
            declarations: safeStringRecord(rule.declarations, 80, 500),
          }))
      : [],
  };
}

function sanitizeSource(
  source: InspectedElementPayload["source"],
): InspectedElementPayload["source"] | undefined {
  if (!source || typeof source.file !== "string") return undefined;
  return {
    file: source.file.slice(0, 500),
    line: positiveInteger(source.line) ?? 1,
    column: positiveInteger(source.column) ?? 1,
    componentName: optionalString(source.componentName, 120),
  };
}

function sanitizeBox(box: PreviewBox): PreviewBox {
  return {
    x: finiteNumber(box?.x),
    y: finiteNumber(box?.y),
    width: finiteNumber(box?.width),
    height: finiteNumber(box?.height),
    top: finiteNumber(box?.top),
    left: finiteNumber(box?.left),
  };
}

function safeStringRecord(
  value: Record<string, string> | undefined,
  maxEntries: number,
  maxValueLength: number,
) {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value)
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
    )
    .slice(0, maxEntries)
    .map(([key, item]) => [key.slice(0, 120), item.slice(0, maxValueLength)]);
  return Object.fromEntries(entries);
}

function optionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : undefined;
}

function positiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function elementLabel(payload: InspectedElementPayload) {
  const id = payload.id ? `#${payload.id}` : "";
  const classes = payload.classList.slice(0, 3).map((item) => `.${item}`).join("");
  return `${payload.tagName}${id}${classes}`;
}

function matchedProjectRules(
  payload: InspectedElementPayload,
  rules: readonly CssRuleOrigin[],
) {
  const matchedSelectors = new Set(
    (payload.matchedRules ?? []).map((rule) => rule.selector),
  );
  return rules.filter((rule) => matchedSelectors.has(rule.selector));
}

function pickCssPatchTarget(
  payload: InspectedElementPayload,
  rules: readonly CssRuleOrigin[],
  property: string,
  value: string,
) {
  const matched = matchedProjectRules(payload, rules);
  const cssName = cssPropertyName(property);
  const existingDeclaration = matched.find((rule) => cssName in rule.declarations);
  const target = existingDeclaration ?? matched[0];
  if (target) {
    return { file: target.file, selector: target.selector, property, value };
  }

  const className = payload.classList.find(Boolean);
  const firstCssFile = rules[0]?.file ?? "/src/styles.css";
  if (!className) return undefined;
  return {
    file: firstCssFile,
    selector: `.${cssIdentifier(className)}`,
    property,
    value,
  };
}

function patchCssDeclaration(
  css: string,
  selector: string,
  property: string,
  value: string,
) {
  const selectorIndex = css.indexOf(selector);
  if (selectorIndex < 0) {
    return `${css.trimEnd()}\n\n${selector} {\n  ${cssPropertyName(property)}: ${value};\n}\n`;
  }

  const open = css.indexOf("{", selectorIndex);
  const close = open >= 0 ? css.indexOf("}", open) : -1;
  if (open < 0 || close < 0) {
    return `${css.trimEnd()}\n\n${selector} {\n  ${cssPropertyName(property)}: ${value};\n}\n`;
  }

  const before = css.slice(0, open + 1);
  const block = css.slice(open + 1, close);
  const after = css.slice(close);
  const cssName = cssPropertyName(property);
  const declarationPattern = new RegExp(
    `(^|;)\\s*${escapeRegExp(cssName)}\\s*:[^;]*`,
    "m",
  );
  const nextBlock = declarationPattern.test(block)
    ? block.replace(declarationPattern, (_match, prefix: string) => {
        return `${prefix}\n  ${cssName}: ${value}`;
      })
    : `${block.trimEnd()}\n  ${cssName}: ${value};\n`;
  return `${before}${nextBlock}${after}`;
}

function cssPropertyName(property: string) {
  return property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function cssIdentifier(value: string) {
  return value.replace(/[^_a-zA-Z0-9-]/g, "\\$&");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fromVirtualPath(rootPath: string, virtualPath: string) {
  const relative = normalizePath(virtualPath).replace(/^\/+/, "");
  return `${normalizePath(rootPath).replace(/\/$/, "")}/${relative}`;
}

function isPathInside(rootPath: string, filePath: string) {
  const root = normalizePath(rootPath).replace(/\/$/, "");
  const file = normalizePath(filePath);
  return file === root || file.startsWith(`${root}/`);
}
