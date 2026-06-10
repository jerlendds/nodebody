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
let monacoConfigured = false;

export function createWebFileEditor(options: WebFileEditorOptions): Component {
  return {
    mount(root, scope) {
      configureMonaco();

      const host = el("div", "nb-web-file-editor");
      root.replaceChildren(host);

      let saveTimer: number | undefined;
      let saving = false;
      let pendingText: string | undefined;
      let lastSavedText = options.initialText;

      const model = monaco.editor.createModel(
        options.initialText,
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
        theme: "vs-dark",
      });
      scope.add(disposable(() => editor.dispose()));
      revealLocation(editor, options.reveal);

      const flush = () => {
        if (saving) return;
        const value = pendingText;
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
        pendingText = model.getValue();
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
