import type { Component } from "@nodebody/ui";
import { disposable, el } from "@nodebody/ui";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

interface WebFileEditorOptions {
  filePath: string;
  title: string;
  initialText: string;
  reveal?: {
    line: number;
    column: number;
  };
  setSaving: (saving: boolean) => void;
}

const autosaveDebounceMs = 600;
const editorThemeName = "tokyo-night";
let monacoConfigured = false;

const tokyoNightTheme: monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "c0caf5", background: "1a1b26" },
    { token: "invalid", foreground: "f7768e" },
    { token: "comment", foreground: "565f89", fontStyle: "italic" },
    { token: "keyword", foreground: "bb9af7" },
    { token: "keyword.flow", foreground: "bb9af7" },
    { token: "operator", foreground: "89ddff" },
    { token: "text", foreground: "c0caf5" },
    { token: "string", foreground: "9ece6a" },
    { token: "string.key.json", foreground: "7aa2f7" },
    { token: "string.value.json", foreground: "9ece6a" },
    { token: "number", foreground: "ff9e64" },
    { token: "regexp", foreground: "b4f9f8" },
    { token: "type", foreground: "2ac3de" },
    { token: "type.identifier", foreground: "7aa2f7" },
    { token: "class name", foreground: "7aa2f7" },
    { token: "enum name", foreground: "7aa2f7" },
    { token: "interface name", foreground: "2ac3de" },
    { token: "module name", foreground: "7aa2f7" },
    { token: "type alias name", foreground: "2ac3de" },
    { token: "type parameter name", foreground: "2ac3de" },
    { token: "class", foreground: "7aa2f7" },
    { token: "function", foreground: "7aa2f7" },
    { token: "variable", foreground: "c0caf5" },
    { token: "variable.parameter", foreground: "e0af68" },
    { token: "parameter name", foreground: "e0af68" },
    { token: "constant", foreground: "ff9e64" },
    { token: "delimiter", foreground: "89ddff" },
    { token: "delimiter.bracket", foreground: "89ddff" },
    { token: "delimiter.parenthesis", foreground: "89ddff" },
    { token: "delimiter.html", foreground: "565f89" },
    { token: "delimiter.xml", foreground: "565f89" },
    { token: "tag", foreground: "f7768e" },
    { token: "meta.tag", foreground: "f7768e" },
    { token: "metatag", foreground: "f7768e" },
    { token: "metatag.content.html", foreground: "c0caf5" },
    { token: "metatag.html", foreground: "f7768e" },
    { token: "metatag.xml", foreground: "f7768e" },
    { token: "jsxOpenTagName", foreground: "f7768e" },
    { token: "jsxCloseTagName", foreground: "f7768e" },
    { token: "jsxSelfClosingTagName", foreground: "f7768e" },
    { token: "jsx open tag name", foreground: "f7768e" },
    { token: "jsx close tag name", foreground: "f7768e" },
    { token: "jsx self closing tag name", foreground: "f7768e" },
    { token: "jsx text", foreground: "c0caf5" },
    { token: "attribute.name", foreground: "7aa2f7" },
    { token: "attribute.value", foreground: "9ece6a" },
    { token: "jsxAttribute", foreground: "7aa2f7" },
    { token: "jsxAttributeStringLiteralValue", foreground: "9ece6a" },
    { token: "jsx attribute", foreground: "7aa2f7" },
    { token: "jsx attribute string literal value", foreground: "9ece6a" },
    { token: "attribute.value.number.css", foreground: "ff9e64" },
    { token: "attribute.value.unit.css", foreground: "ff9e64" },
    { token: "attribute.value.hex.css", foreground: "bb9af7" },
    { token: "key", foreground: "7aa2f7" },
  ],
  colors: {
    "editor.background": "#1a1b26",
    "editor.foreground": "#c0caf5",
    "editor.lineHighlightBackground": "#292e42",
    "editor.selectionBackground": "#33467c",
    "editor.inactiveSelectionBackground": "#292e42",
    "editorCursor.foreground": "#c0caf5",
    "editorIndentGuide.activeBackground1": "#737aa2",
    "editorIndentGuide.background1": "#3b4261",
    "editorLineNumber.activeForeground": "#737aa2",
    "editorLineNumber.foreground": "#3b4261",
    "editorSuggestWidget.background": "#1f2335",
    "editorSuggestWidget.border": "#3b4261",
    "editorSuggestWidget.foreground": "#c0caf5",
    "editorSuggestWidget.selectedBackground": "#283457",
    "editorWhitespace.foreground": "#3b4261",
    "editorWidget.background": "#1f2335",
    "editorWidget.border": "#3b4261",
    "input.background": "#1f2335",
    "input.border": "#3b4261",
    "input.foreground": "#c0caf5",
  },
};

const reactTypes = `
declare module "react" {
  export type ReactNode = unknown;
  export type CSSProperties = Record<string, string | number | undefined>;
  export type JSXElementConstructor<P> = (props: P) => ReactNode;
  export interface Attributes {
    key?: string | number;
  }
  export interface RefAttributes<T> extends Attributes {
    ref?: unknown;
  }
  export type ComponentProps<T> = T extends JSXElementConstructor<infer P> ? P : never;
  export const Fragment: unique symbol;
  export const StrictMode: unique symbol;
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: unknown[]): T;
  export function useRef<T>(initialValue: T): { current: T };
  export function useState<T>(initialValue: T): [T, (value: T | ((current: T) => T)) => void];
  const React: {
    Fragment: typeof Fragment;
    StrictMode: typeof StrictMode;
    createElement: typeof createElement;
    useEffect: typeof useEffect;
    useMemo: typeof useMemo;
    useRef: typeof useRef;
    useState: typeof useState;
  };
  export default React;
}

declare module "react/jsx-runtime" {
  export function jsx(type: unknown, props: unknown, key?: string): unknown;
  export function jsxs(type: unknown, props: unknown, key?: string): unknown;
  export const Fragment: unique symbol;
  export namespace JSX {
    interface Element {}
    interface ElementClass {}
    interface ElementChildrenAttribute {
      children: {};
    }
    interface IntrinsicAttributes {
      key?: string | number;
    }
    interface IntrinsicElements {
      [elemName: string]: Record<string, unknown>;
    }
  }
}

declare module "react-dom/client" {
  export interface Root {
    render(children: unknown): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}
`;

export function createWebFileEditor(options: WebFileEditorOptions): Component {
  return {
    mount(root, scope) {
      configureMonaco();

      const host = el("div", "nb-web-file-editor");
      root.replaceChildren(host);

      const initialText = stripWebFileArtifacts(options.initialText);
      let saveTimer: number | undefined;
      let saving = false;
      let pendingText: string | undefined;
      let lastSavedText = initialText;

      if (initialText !== options.initialText) {
        options.setSaving(true);
        void window.spaces.writeItem(options.filePath, initialText).finally(() => {
          options.setSaving(false);
        });
      }

      const model = monaco.editor.createModel(
        initialText,
        languageForPath(options.title),
        monaco.Uri.file(options.filePath),
      );
      scope.add(disposable(() => model.dispose()));

      const editor = monaco.editor.create(host, {
        automaticLayout: true,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        minimap: { enabled: false },
        model,
        scrollBeyondLastLine: false,
        "semanticHighlighting.enabled": true,
        theme: editorThemeName,
      });
      scope.add(disposable(() => editor.dispose()));
      revealLocation(editor, options.reveal);

      const flush = () => {
        if (saving) return;
        const value =
          pendingText === undefined ? undefined : stripWebFileArtifacts(pendingText);
        pendingText = undefined;
        if (value === undefined || value === lastSavedText) {
          options.setSaving(false);
          return;
        }

        saving = true;
        void window.spaces
          .writeItem(options.filePath, value)
          .then(() => {
            lastSavedText = value;
            window.dispatchEvent(
              new CustomEvent("nb:web-file-saved", {
                detail: { filePath: options.filePath },
              }),
            );
          })
          .finally(() => {
            saving = false;
            if (pendingText !== undefined && pendingText !== lastSavedText) {
              saveTimer = window.setTimeout(flush, 0);
            } else {
              pendingText = undefined;
              options.setSaving(false);
            }
          });
      };

      const change = model.onDidChangeContent(() => {
        const nextText = model.getValue();
        const sanitizedText = stripWebFileArtifacts(nextText);
        if (sanitizedText !== nextText) {
          const position = editor.getPosition();
          model.pushEditOperations(
            editor.getSelections(),
            [
              {
                range: model.getFullModelRange(),
                text: sanitizedText,
              },
            ],
            () => null,
          );
          if (position) editor.setPosition(position);
          return;
        }

        pendingText = sanitizedText;
        options.setSaving(true);
        if (saveTimer !== undefined) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(flush, autosaveDebounceMs);
      });
      scope.add(disposable(() => change.dispose()));

      scope.add(
        disposable(() => {
          if (saveTimer !== undefined) window.clearTimeout(saveTimer);
          flush();
        }),
      );

      const onReveal = (event: Event) => {
        const detail = (
          event as CustomEvent<{
            filePath?: string;
            line?: number;
            column?: number;
          }>
        ).detail;
        if (detail?.filePath !== options.filePath) return;
        revealLocation(editor, {
          line: detail.line ?? 1,
          column: detail.column ?? 1,
        });
      };
      window.addEventListener("nb:web-file-reveal", onReveal);
      scope.add(
        disposable(() => window.removeEventListener("nb:web-file-reveal", onReveal)),
      );
    },
  };
}

function configureMonaco() {
  if (monacoConfigured) return;
  monacoConfigured = true;

  (
    globalThis as typeof globalThis & {
      MonacoEnvironment: { getWorker(_workerId: string, label: string): Worker };
    }
  ).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "json") return new JsonWorker();
      if (label === "css" || label === "scss" || label === "less") {
        return new CssWorker();
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new HtmlWorker();
      }
      if (label === "typescript" || label === "javascript") return new TsWorker();
      return new EditorWorker();
    },
  };

  monaco.editor.defineTheme(editorThemeName, tokyoNightTheme);
  monaco.editor.setTheme(editorThemeName);
  registerTsxSemanticTokens();

  const typescriptLanguage = (
    monaco.languages as typeof monaco.languages & {
      typescript: {
        JsxEmit: { ReactJSX: unknown };
        ModuleKind: { ESNext: unknown };
        ModuleResolutionKind: { NodeJs: unknown };
        ScriptTarget: { ES2020: unknown };
        javascriptDefaults: TypeScriptLanguageDefaults;
        typescriptDefaults: TypeScriptLanguageDefaults;
      };
    }
  ).typescript;

  const compilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    jsx: typescriptLanguage.JsxEmit.ReactJSX,
    jsxImportSource: "react",
    module: typescriptLanguage.ModuleKind.ESNext,
    moduleResolution: typescriptLanguage.ModuleResolutionKind.NodeJs,
    noEmit: true,
    resolveJsonModule: true,
    target: typescriptLanguage.ScriptTarget.ES2020,
  };

  typescriptLanguage.typescriptDefaults.setCompilerOptions(compilerOptions);
  typescriptLanguage.javascriptDefaults.setCompilerOptions({
    ...compilerOptions,
    checkJs: false,
  });
  typescriptLanguage.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  typescriptLanguage.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  addTypeLibrary(
    typescriptLanguage.typescriptDefaults,
    reactTypes,
    "file:///node_modules/@types/react/index.d.ts",
  );
  addTypeLibrary(
    typescriptLanguage.javascriptDefaults,
    reactTypes,
    "file:///node_modules/@types/react/index.d.ts",
  );
}

function stripWebFileArtifacts(value: string) {
  return value.replace(
    /web-(?:file|project):%2F[^\s"'<>`)]*?\$\d+/g,
    "",
  );
}

const tsxSemanticTokenTypes = ["tag", "attribute.name", "attribute.value", "text"];

function registerTsxSemanticTokens() {
  const provider: monaco.languages.DocumentSemanticTokensProvider = {
    getLegend() {
      return {
        tokenModifiers: [],
        tokenTypes: tsxSemanticTokenTypes,
      };
    },
    provideDocumentSemanticTokens(model) {
      if (!isJsxLikePath(model.uri.path)) return { data: new Uint32Array() };
      return {
        data: encodeSemanticTokens(model, collectJsxSemanticTokens(model.getValue())),
      };
    },
    releaseDocumentSemanticTokens() {},
  };

  monaco.languages.registerDocumentSemanticTokensProvider(
    { exclusive: true, language: "typescript", pattern: "**/*.tsx" },
    provider,
  );
  monaco.languages.registerDocumentSemanticTokensProvider(
    { exclusive: true, language: "javascript", pattern: "**/*.jsx" },
    provider,
  );
}

interface SemanticTokenRange {
  start: number;
  length: number;
  tokenType: number;
}

function collectJsxSemanticTokens(source: string) {
  const tokens: SemanticTokenRange[] = [];
  const length = source.length;
  let index = 0;
  let jsxDepth = 0;
  let jsxTextStart: number | undefined;

  const flushText = (end: number) => {
    if (jsxTextStart === undefined || jsxTextStart >= end) return;
    pushTextTokens(tokens, source, jsxTextStart, end);
    jsxTextStart = undefined;
  };

  while (index < length) {
    const char = source[index];

    if (char === "<" && isLikelyJsxTagStart(source, index)) {
      flushText(index);
      const tag = collectJsxTagTokens(source, index, tokens);
      index = tag.end;

      if (tag.kind === "close") {
        jsxDepth = Math.max(0, jsxDepth - 1);
      } else if (tag.kind === "open") {
        jsxDepth += 1;
      }

      jsxTextStart = jsxDepth > 0 ? index : undefined;
      continue;
    }

    if (jsxTextStart !== undefined && char === "{") {
      flushText(index);
      index = skipBalanced(source, index, "{", "}");
      jsxTextStart = index;
      continue;
    }

    index += 1;
  }

  flushText(length);
  return tokens.sort((a, b) => a.start - b.start || a.length - b.length);
}

function collectJsxTagTokens(
  source: string,
  start: number,
  tokens: SemanticTokenRange[],
) {
  let index = start + 1;
  let kind: "open" | "close" | "self" = "open";
  if (source[index] === "/") {
    kind = "close";
    index += 1;
  }

  if (source[index] === ">") return { end: index + 1, kind: "self" as const };

  const tagStart = index;
  while (index < source.length && isJsxNameChar(source[index])) index += 1;
  if (index > tagStart) pushToken(tokens, tagStart, index, 0);

  let quote: string | undefined;
  let braceDepth = 0;

  while (index < source.length) {
    const char = source[index];

    if (quote) {
      const valueStart = index - 1;
      while (index < source.length) {
        if (source[index] === "\\" && index + 1 < source.length) {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          pushToken(tokens, valueStart, index, 2);
          quote = undefined;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      index += 1;
      continue;
    }

    if (braceDepth === 0 && char === ">") {
      if (source[index - 1] === "/" && kind === "open") kind = "self";
      return { end: index + 1, kind };
    }

    if (
      braceDepth === 0 &&
      isJsxNameStart(char) &&
      isAttributeBoundary(source[index - 1])
    ) {
      const attrStart = index;
      index += 1;
      while (index < source.length && isJsxNameChar(source[index])) index += 1;
      const attrEnd = index;
      let next = index;
      while (next < source.length && /\s/.test(source[next])) next += 1;
      if (source[next] === "=") pushToken(tokens, attrStart, attrEnd, 1);
      continue;
    }

    index += 1;
  }

  return { end: index, kind };
}

function pushTextTokens(
  tokens: SemanticTokenRange[],
  source: string,
  start: number,
  end: number,
) {
  const textPattern = /\S+/g;
  textPattern.lastIndex = start;

  let match: RegExpExecArray | null;
  while ((match = textPattern.exec(source)) && match.index < end) {
    const tokenStart = match.index;
    const tokenEnd = Math.min(tokenStart + match[0].length, end);
    pushToken(tokens, tokenStart, tokenEnd, 3);
  }
}

function pushToken(
  tokens: SemanticTokenRange[],
  start: number,
  end: number,
  tokenType: number,
) {
  if (end <= start) return;
  tokens.push({ start, length: end - start, tokenType });
}

function encodeSemanticTokens(
  model: monaco.editor.ITextModel,
  tokens: SemanticTokenRange[],
) {
  const data = new Uint32Array(tokens.length * 5);
  let previousLine = 0;
  let previousCharacter = 0;

  tokens.forEach((token, index) => {
    const position = model.getPositionAt(token.start);
    const line = position.lineNumber - 1;
    const character = position.column - 1;
    const dataIndex = index * 5;

    data[dataIndex] = line - previousLine;
    data[dataIndex + 1] = line === previousLine ? character - previousCharacter : character;
    data[dataIndex + 2] = token.length;
    data[dataIndex + 3] = token.tokenType;
    data[dataIndex + 4] = 0;

    previousLine = line;
    previousCharacter = character;
  });

  return data;
}

function isJsxLikePath(path: string) {
  return path.endsWith(".tsx") || path.endsWith(".jsx");
}

function isLikelyJsxTagStart(source: string, index: number) {
  const next = source[index + 1];
  if (next === ">") return true;
  if (next === "/") return isJsxNameStart(source[index + 2] ?? "");
  return isJsxNameStart(next ?? "");
}

function isJsxNameStart(char: string) {
  return /[A-Za-z]/.test(char);
}

function isJsxNameChar(char: string) {
  return /[A-Za-z0-9_$:.-]/.test(char);
}

function isAttributeBoundary(char: string | undefined) {
  return char === undefined || /\s/.test(char) || char === "<" || char === "/";
}

function skipBalanced(source: string, start: number, open: string, close: string) {
  let depth = 0;
  let quote: string | undefined;
  let index = start;

  while (index < source.length) {
    const char = source[index];

    if (quote) {
      if (char === "\\" && index + 1 < source.length) {
        index += 2;
        continue;
      }
      if (char === quote) quote = undefined;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      index += 1;
      continue;
    }

    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth <= 0) return index + 1;
    }

    index += 1;
  }

  return index;
}

interface TypeScriptLanguageDefaults {
  addExtraLib(content: string, filePath?: string): { dispose(): void };
  setCompilerOptions(options: Record<string, unknown>): void;
  setDiagnosticsOptions(options: {
    noSemanticValidation?: boolean;
    noSyntaxValidation?: boolean;
  }): void;
}

function addTypeLibrary(
  defaults: TypeScriptLanguageDefaults,
  content: string,
  filePath: string,
) {
  defaults.addExtraLib(content, filePath);
}

function languageForPath(fileName: string) {
  switch (fileExtension(fileName)) {
    case ".css":
      return "css";
    case ".scss":
      return "scss";
    case ".html":
    case ".htm":
      return "html";
    case ".json":
      return "json";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    default:
      return "plaintext";
  }
}

function fileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function revealLocation(
  editor: monaco.editor.IStandaloneCodeEditor,
  location: WebFileEditorOptions["reveal"],
) {
  if (!location) return;
  const position = {
    lineNumber: Math.max(1, location.line),
    column: Math.max(1, location.column),
  };
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
}
