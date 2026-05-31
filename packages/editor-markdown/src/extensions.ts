import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  insertMarkdownLink,
  toggleEmphasis,
  toggleHeading,
  toggleInlineCode,
  toggleStrong,
  toggleTaskListItem,
} from "./commands";
import { transformPastedMarkdownText } from "./clipboard";
import type { MarkdownMode, MarkdownOptions } from "./options";
import type { MarkdownEditorHost } from "./plugin";
import { markdownWysiwym } from "./wysiwym";

export interface MarkdownExtensionOptions {
  mode: MarkdownMode;
  markdown: MarkdownOptions;
  readOnly: boolean;
  host: MarkdownEditorHost;
  onChange?: (value: string) => void;
}

export function markdownEditorExtensions(
  options: MarkdownExtensionOptions,
): Extension[] {
  return [
    EditorState.readOnly.of(options.readOnly),
    EditorView.editable.of(!options.readOnly),

    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),

    markdown({
      base: markdownLanguage,
      codeLanguages: markdownCodeLanguages(),
    }),

    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    syntaxHighlighting(markdownHighlightStyle()),

    options.mode === "live"
      ? markdownWysiwym({
          hideSyntaxOnInactiveLines: true,
          renderTaskCheckboxes:
            options.markdown.parse.constructs.gfmTaskListItem,
        })
      : [],

    keymap.of([
      { key: "Mod-b", run: toggleStrong },
      { key: "Mod-i", run: toggleEmphasis },
      { key: "Mod-e", run: toggleInlineCode },
      { key: "Mod-k", run: insertMarkdownLink },
      { key: "Mod-Alt-1", run: toggleHeading(1) },
      { key: "Mod-Alt-2", run: toggleHeading(2) },
      { key: "Mod-Alt-3", run: toggleHeading(3) },
      { key: "Mod-Enter", run: toggleTaskListItem },
      indentWithTab,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
    ]),

    EditorView.lineWrapping,

    EditorView.domEventHandlers({
      paste(event, view) {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;

        const transformed = transformPastedMarkdownText(text);
        if (transformed === text) return false;

        event.preventDefault();

        view.dispatch(
          view.state.changeByRange((range) => ({
            changes: { from: range.from, to: range.to, insert: transformed },
            range: EditorSelection.cursor(range.from + transformed.length),
          })),
          { scrollIntoView: true },
        );

        return true;
      },
    }),

    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      options.onChange?.(update.state.doc.toString());
    }),

    markdownEditorTheme(),
    options.host.initialExtension(),
  ];
}

function markdownCodeLanguages(): LanguageDescription[] {
  return [
    LanguageDescription.of({
      name: "JavaScript",
      alias: ["js", "jsx", "mjs", "cjs"],
      extensions: ["js", "jsx", "mjs", "cjs"],
      support: javascript({ jsx: true }),
    }),
    LanguageDescription.of({
      name: "TypeScript",
      alias: ["ts", "tsx"],
      extensions: ["ts", "tsx"],
      support: javascript({ typescript: true, jsx: true }),
    }),
    LanguageDescription.of({
      name: "CSS",
      extensions: ["css"],
      support: css(),
    }),
    LanguageDescription.of({
      name: "HTML",
      alias: ["html"],
      extensions: ["html", "htm"],
      support: html(),
    }),
    LanguageDescription.of({
      name: "JSON",
      extensions: ["json"],
      support: json(),
    }),
    LanguageDescription.of({
      name: "Python",
      alias: ["py"],
      extensions: ["py"],
      support: python(),
    }),
    LanguageDescription.of({
      name: "Rust",
      alias: ["rs"],
      extensions: ["rs"],
      support: rust(),
    }),
    LanguageDescription.of({
      name: "SQL",
      extensions: ["sql"],
      support: sql(),
    }),
    LanguageDescription.of({
      name: "XML",
      extensions: ["xml", "svg"],
      support: xml(),
    }),
    LanguageDescription.of({
      name: "YAML",
      alias: ["yml"],
      extensions: ["yaml", "yml"],
      support: yaml(),
    }),
  ];
}

function markdownHighlightStyle(): HighlightStyle {
  return HighlightStyle.define([
    { tag: tags.keyword, color: "#8fb6ff" },
    { tag: [tags.atom, tags.bool, tags.number], color: "#f0b46a" },
    {
      tag: [tags.string, tags.special(tags.string)],
      color: "var(--nb-foreground)",
    },
    { tag: [tags.comment, tags.quote], color: "var(--nb-muted)" },
    { tag: [tags.variableName, tags.propertyName], color: "#c8d0f0" },
    {
      tag: [tags.definition(tags.variableName), tags.function(tags.variableName)],
      color: "#79c7ff",
    },
    { tag: [tags.typeName, tags.className], color: "#c5a3ff" },
    { tag: tags.operator, color: "#aeb6d6" },
    { tag: [tags.punctuation, tags.bracket], color: "#7f849d" },
    { tag: tags.invalid, color: "#ff8b8b" },
  ]);
}

function markdownEditorTheme(): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      color: "var(--nb-foreground)",
      backgroundColor: "var(--nb-surface)",
      fontSize: "15px",
    },

    ".cm-scroller": {
      fontFamily:
        'Lato, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      lineHeight: "1.6",
    },

    ".cm-content": {
      padding: "28px 36px 48px",
      maxWidth: "920px",
      margin: "0 auto",
      caretColor: "var(--nb-bright, #ffffff)",
    },

    ".cm-line": {
      padding: "0 2px",
    },

    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--nb-bright, #ffffff) !important",
      borderLeftWidth: "2px",
    },

    ".cm-focused .cm-cursor": {
      borderLeftColor: "var(--nb-bright, #ffffff) !important",
    },

    ".cm-activeLine": {
      backgroundColor: "transparent",
    },

    ".cm-selectionBackground": {
      backgroundColor: "var(--nb-accent-soft) !important",
    },

    ".cm-gutters": {
      backgroundColor: "var(--nb-surface)",
      color: "var(--nb-muted)",
      borderRight: "1px solid var(--nb-border)",
    },

    ".cm-tooltip": {
      backgroundColor: "var(--nb-toolbar)",
      color: "var(--nb-foreground)",
      border: "1px solid var(--nb-border)",
      borderRadius: "8px",
      boxShadow: "0 18px 50px rgba(0, 0, 0, 0.35)",
    },
  });
}
