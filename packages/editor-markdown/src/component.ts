import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type {
  Component,
  LayoutContributionSink,
  LayoutPortSink,
  Scope,
} from "@interfacez/ui";
import { disposable, el } from "@interfacez/ui";
import { markdownEditorExtensions } from "./extensions";
import {
  defaultMarkdownOptions,
  type MarkdownChangeEvent,
  type MarkdownDocumentModel,
  type MarkdownMode,
  type MarkdownOptions,
} from "./options";
import { MarkdownEditorHost, type MarkdownEditorPlugin } from "./plugin";

export interface MarkdownEditorComponentOptions {
  document: MarkdownDocumentModel;
  mode?: MarkdownMode;
  markdown?: MarkdownOptions;
  plugins?: readonly MarkdownEditorPlugin[];
  allowPlugin?: (plugin: MarkdownEditorPlugin) => boolean;
  layout?: LayoutContributionSink;
  ports?: LayoutPortSink;
  onChange?: (event: MarkdownChangeEvent) => void;
  onSave?: (
    value: string,
    document: MarkdownDocumentModel,
  ) => void | Promise<void>;
}

export interface MarkdownEditorHandle {
  readonly host: MarkdownEditorHost;
  readonly view: EditorView;
  getText(): string;
  setText(value: string): void;
  focus(): void;
}

export function createMarkdownEditor(
  options: MarkdownEditorComponentOptions,
): Component {
  return {
    mount(root: Element, scope: Scope): void {
      const hostElement = el("section", "nb-md-editor");
      hostElement.dataset.document = options.document.id;
      hostElement.setAttribute("aria-label", options.document.title);
      root.append(hostElement);

      const markdown = options.markdown ?? defaultMarkdownOptions();
      const host = scope.add(
        new MarkdownEditorHost({
          document: options.document,
          options: markdown,
          plugins: options.plugins,
          allowPlugin: options.allowPlugin,
        }),
      );

      const view = new EditorView({
        parent: hostElement,
        state: EditorState.create({
          doc: options.document.initialText,
          extensions: markdownEditorExtensions({
            mode: options.mode ?? "live",
            markdown,
            readOnly: Boolean(options.document.readOnly),
            host,
            onChange: (value) => {
              options.onChange?.({
                document: options.document,
                value,
                reason: "input",
              });
            },
          }),
        }),
      });

      host.attach(view);

      scope.add(disposable(() => view.destroy()));

      requestAnimationFrame(() => view.focus());
    },
  };
}
