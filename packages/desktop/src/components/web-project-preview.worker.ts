import * as esbuild from "esbuild-wasm";
import wasmUrl from "esbuild-wasm/esbuild.wasm?url";

type ProjectLanguage =
  | "typescript"
  | "javascript"
  | "html"
  | "css"
  | "json";

type CdnProvider = "esm.sh" | "jsdelivr-esm" | "unpkg" | "jspm";

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

interface BuildRequest {
  type: "build";
  requestId: number;
  project: ProjectState;
  mode: "full" | "css-only";
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

const allowedScriptOrigins = new Set([
  "https://esm.sh",
  "https://esm.run",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://ga.jspm.io",
]);

let initializePromise: Promise<void> | undefined;

self.addEventListener("message", (event: MessageEvent<BuildRequest>) => {
  const request = event.data;
  if (request.type !== "build") return;
  void build(request);
});

async function build(request: BuildRequest) {
  try {
    await initializeEsbuild();
    const output = await buildPreview(request.project);
    postMessage({ type: "success", requestId: request.requestId, output });
  } catch (error) {
    postMessage({
      type: "failure",
      requestId: request.requestId,
      diagnostics: diagnosticsFromError(error),
    });
  }
}

function initializeEsbuild() {
  initializePromise ??= esbuild.initialize({
    wasmURL: wasmUrl,
    worker: false,
  });
  return initializePromise;
}

async function buildPreview(project: ProjectState): Promise<BuildOutput> {
  const entry = project.files[project.entry];
  const htmlEntry = entry?.language === "html" ? entry : undefined;
  const htmlModel = htmlEntry ? parseHtmlEntry(project, htmlEntry) : undefined;
  const jsEntryPath = htmlModel?.scriptPath ?? findScriptEntry(project);
  const css = collectCss(project);
  const importMap = buildImportMap(project.dependencies);
  const diagnostics: BuildDiagnostic[] = invalidDependencyDiagnostics(
    project.dependencies,
  );
  let script = "";
  let bundledCss = "";

  if (jsEntryPath) {
    const result = await bundleEntry(project, jsEntryPath);
    script = result.script;
    bundledCss = result.css;
    diagnostics.push(...result.diagnostics);
  }

  const finalCss = `${css}\n${bundledCss}`.trim();
  return {
    html: generatePreviewHtml({
      body: htmlModel?.body ?? '<div id="root"></div>',
      css: finalCss,
      importMap,
      script,
    }),
    css: finalCss,
    diagnostics,
  };
}

async function bundleEntry(project: ProjectState, entryPath: string) {
  const diagnostics: BuildDiagnostic[] = [];
  const result = await esbuild.build({
    absWorkingDir: "/",
    bundle: true,
    entryPoints: [entryPath],
    external: externalSpecifiers(project.dependencies),
    format: "esm",
    jsx: "automatic",
    logLevel: "silent",
    metafile: false,
    platform: "browser",
    outdir: "/nodebody-preview",
    sourcemap: "inline",
    target: ["es2020"],
    write: false,
    plugins: [virtualProjectPlugin(project)],
    loader: {
      ".js": "jsx",
      ".jsx": "jsx",
      ".ts": "ts",
      ".tsx": "tsx",
      ".css": "css",
      ".json": "json",
    },
  });

  diagnostics.push(...result.warnings.map(diagnosticFromMessage));

  let script = "";
  let css = "";
  for (const file of result.outputFiles) {
    if (file.path.endsWith(".css")) css += `\n${file.text}`;
    else script += `\n${file.text}`;
  }

  return { script, css, diagnostics };
}

function virtualProjectPlugin(project: ProjectState): esbuild.Plugin {
  return {
    name: "nodebody-virtual-project",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (isRemoteSpecifier(args.path)) return { path: args.path, external: true };
        if (isPackageSpecifier(args.path)) return { path: args.path, external: true };

        const resolved =
          args.kind === "entry-point"
            ? normalizeVirtualPath(args.path)
            : resolveVirtualImport(args.resolveDir || "/", args.path, project);

        if (!resolved) {
          return {
            errors: [
              {
                text: `Cannot resolve ${args.path}`,
                location: {
                  file: args.importer,
                  line: 1,
                  column: 0,
                  lineText: args.path,
                },
              },
            ],
          };
        }

        return {
          path: resolved,
          namespace: "nodebody-preview",
        };
      });

      build.onLoad(
        { filter: /.*/, namespace: "nodebody-preview" },
        (args) => {
          const file = project.files[normalizeVirtualPath(args.path)];
          if (!file) {
            return { errors: [{ text: `Missing virtual file: ${args.path}` }] };
          }
          return {
            contents: file.content,
            loader: loaderForFile(file.path),
            resolveDir: dirname(file.path),
          };
        },
      );
    },
  };
}

function parseHtmlEntry(project: ProjectState, file: ProjectFile) {
  const bodyMatch = file.content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodySource = bodyMatch?.[1] ?? file.content;
  const scriptMatch = bodySource.match(
    /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*><\/script>/i,
  );
  const body = bodySource.replace(/<script\b[\s\S]*?<\/script>/gi, "").trim();
  const scriptPath = scriptMatch?.[1]
    ? resolveVirtualImport(dirname(file.path), scriptMatch[1], project)
    : undefined;
  return {
    body: body || '<div id="root"></div>',
    scriptPath,
  };
}

function findScriptEntry(project: ProjectState) {
  const candidates = [
    project.entry,
    "/src/main.tsx",
    "/src/main.jsx",
    "/src/main.ts",
    "/src/main.js",
    "/main.tsx",
    "/main.jsx",
    "/main.ts",
    "/main.js",
  ];
  return candidates.find((path) => {
    const file = project.files[path];
    return file?.language === "typescript" || file?.language === "javascript";
  });
}

function collectCss(project: ProjectState) {
  return Object.values(project.files)
    .filter((file) => file.language === "css")
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `/* ${file.path} */\n${file.content}`)
    .join("\n\n");
}

function buildImportMap(dependencies: Record<string, string>) {
  const imports: Record<string, string> = {};
  for (const [name, version] of Object.entries(dependencies)) {
    if (!exactVersion(version)) continue;
    imports[name] = resolveDependency({
      name,
      version,
      provider: "esm.sh",
    });
    imports[`${name}/`] = resolveDependency({
      name,
      version,
      subpath: "/",
      provider: "esm.sh",
    });
    if (name === "react") {
      imports["react/jsx-runtime"] = resolveDependency({
        name,
        version,
        subpath: "/jsx-runtime",
        provider: "esm.sh",
      });
    }
  }
  return { imports };
}

function invalidDependencyDiagnostics(
  dependencies: Record<string, string>,
): BuildDiagnostic[] {
  return Object.entries(dependencies)
    .filter(([, version]) => !exactVersion(version))
    .map(([name, version]) => ({
      text: `Dependency ${name} must use an exact pinned version, got ${version}`,
      location: "package.json",
    }));
}

function resolveDependency(dep: {
  name: string;
  version: string;
  subpath?: string;
  provider: CdnProvider;
}) {
  const subpath = dep.subpath ?? "";
  switch (dep.provider) {
    case "esm.sh":
      return `https://esm.sh/${dep.name}@${dep.version}${subpath}`;
    case "jsdelivr-esm":
      return `https://esm.run/${dep.name}@${dep.version}${subpath}`;
    case "unpkg":
      return `https://unpkg.com/${dep.name}@${dep.version}${subpath}`;
    case "jspm":
      return `https://ga.jspm.io/npm:${dep.name}@${dep.version}${subpath}`;
  }
}

function generatePreviewHtml(input: {
  body: string;
  css: string;
  importMap: { imports: Record<string, string> };
  script: string;
}) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(buildPreviewCsp())}" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script type="importmap">${escapeScriptText(JSON.stringify(input.importMap, null, 2))}</script>
  <style id="__preview_css__">${escapeHtml(input.css)}</style>
</head>
<body>
  ${input.body}
  <script type="module">${escapeScriptText(generateRuntimeBridge())}</script>
  <script type="module">${escapeScriptText(input.script)}</script>
</body>
</html>`;
}

function buildPreviewCsp() {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' https://esm.sh https://esm.run https://cdn.jsdelivr.net https://unpkg.com https://ga.jspm.io",
    "style-src 'unsafe-inline' https:",
    "img-src data: blob: https:",
    "font-src data: https:",
    "connect-src https://esm.sh https://esm.run https://cdn.jsdelivr.net https://unpkg.com https://ga.jspm.io",
    "media-src blob: data: https:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function generateRuntimeBridge() {
  return `
(function () {
  const send = (message) => {
    window.parent.postMessage({ source: "preview-runtime", ...message }, "*");
  };

  ["log", "warn", "error"].forEach((level) => {
    const original = console[level];
    console[level] = (...args) => {
      send({ type: "console", level, args: args.map(String) });
      original.apply(console, args);
    };
  });

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "css-update") return;
    let style = document.getElementById("__preview_css__");
    if (!style) {
      style = document.createElement("style");
      style.id = "__preview_css__";
      document.head.appendChild(style);
    }
    style.textContent = event.data.css;
  });

  window.addEventListener("error", (event) => {
    send({ type: "runtime-error", message: event.message, stack: event.error?.stack });
  });

  window.addEventListener("unhandledrejection", (event) => {
    send({ type: "runtime-error", message: String(event.reason), stack: event.reason?.stack });
  });

  send({ type: "ready" });
})();
`;
}

function externalSpecifiers(dependencies: Record<string, string>) {
  const external = new Set<string>();
  for (const name of Object.keys(dependencies)) {
    external.add(name);
    external.add(`${name}/*`);
  }
  return Array.from(external);
}

function resolveVirtualImport(
  resolveDir: string,
  specifier: string,
  project: ProjectState,
) {
  const base = normalizeVirtualPath(
    specifier.startsWith("/") ? specifier : `${resolveDir}/${specifier}`,
  );
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}.json`,
    `${base}.css`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
    `${base}/index.jsx`,
    `${base}/index.js`,
  ];
  return candidates.find((candidate) => project.files[candidate]);
}

function isRemoteSpecifier(specifier: string) {
  try {
    const url = new URL(specifier);
    return allowedScriptOrigins.has(url.origin);
  } catch {
    return false;
  }
}

function isPackageSpecifier(specifier: string) {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

function loaderForFile(path: string): esbuild.Loader {
  const extension = fileExtension(path);
  if (extension === ".tsx") return "tsx";
  if (extension === ".ts") return "ts";
  if (extension === ".jsx" || extension === ".js") return "jsx";
  if (extension === ".css") return "css";
  if (extension === ".json") return "json";
  return "js";
}

function diagnosticsFromError(error: unknown): BuildDiagnostic[] {
  const buildError = error as {
    errors?: esbuild.Message[];
    warnings?: esbuild.Message[];
    message?: string;
  };
  const messages = [...(buildError.errors ?? []), ...(buildError.warnings ?? [])];
  if (messages.length) return messages.map(diagnosticFromMessage);
  return [{ text: buildError.message ?? String(error) }];
}

function diagnosticFromMessage(message: esbuild.Message): BuildDiagnostic {
  return {
    text: message.text,
    location: message.location
      ? `${message.location.file}:${message.location.line}:${message.location.column}`
      : undefined,
  };
}

function normalizeVirtualPath(path: string) {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function dirname(path: string) {
  const normalized = normalizeVirtualPath(path);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
}

function fileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function exactVersion(version: string) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeScriptText(value: string) {
  return value
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
}
