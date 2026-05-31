import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { transformPastedMarkdownText } from "./clipboard";

export interface WysiwymOptions {
  hideSyntaxOnInactiveLines: boolean;
  renderTaskCheckboxes: boolean;
  revealSyntaxOnSelection: boolean;
}

const defaultOptions: WysiwymOptions = {
  hideSyntaxOnInactiveLines: true,
  renderTaskCheckboxes: true,
  revealSyntaxOnSelection: true,
};

const tableMinColumnWidth = 60;
const tableColumnWidths = new WeakMap<EditorView, Map<number, number[]>>();

export function markdownWysiwym(
  options: Partial<WysiwymOptions> = {},
): Extension {
  const config = { ...defaultOptions, ...options };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(private readonly view: EditorView) {
        this.decorations = buildDecorations(view, config);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.geometryChanged
        ) {
          this.decorations = buildDecorations(update.view, config);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

function buildDecorations(
  view: EditorView,
  options: WysiwymOptions,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const activeLines = collectActiveLines(view);

  decorateVisibleLines(view, activeLines, options, ranges);
  decorateSyntaxTree(view, activeLines, options, ranges);

  return Decoration.set(ranges, true);
}

function collectActiveLines(view: EditorView): Set<number> {
  const lines = new Set<number>();

  for (const range of view.state.selection.ranges) {
    const start = view.state.doc.lineAt(range.from);
    const end = view.state.doc.lineAt(range.to);

    for (let line = start.number; line <= end.number; line += 1) {
      lines.add(line);
    }
  }

  return lines;
}

function decorateVisibleLines(
  view: EditorView,
  activeLines: Set<number>,
  options: WysiwymOptions,
  ranges: Range<Decoration>[],
): void {
  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from);

    while (line.from <= visible.to) {
      const text = line.text;
      const active = activeLines.has(line.number);
      const tableRow = parseRenderableTableRow(view, line.number);
      const footnote = !active ? parseFootnoteDefinition(text) : undefined;

      decorateLineClass(line.from, text, active, tableRow, ranges);

      if (footnote) {
        decorateRenderedFootnote(line.from, line.to, footnote, ranges);
      } else if (tableRow) {
        if (tableRow.separator) {
          decorateCollapsedTableSeparator(line.from, line.to, ranges);
        } else {
          decorateRenderedTableRow(line.from, line.to, tableRow, ranges);
        }
      } else if (!active && options.hideSyntaxOnInactiveLines) {
        hideLineSyntax(view, line.from, text, ranges);

        decorateRenderedBlocks(line.from, text, ranges);

        if (options.renderTaskCheckboxes) {
          decorateTaskCheckbox(line.from, text, ranges);
        }
      }

      if (line.to >= visible.to || line.number >= view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
}

function decorateLineClass(
  lineFrom: number,
  text: string,
  active: boolean,
  tableRow: TableRowRenderModel | undefined,
  ranges: Range<Decoration>[],
): void {
  const heading = /^(#{1,6})(?:\s+|$)/.exec(text);

  if (heading) {
    const level = heading[1].length;
    ranges.push(
      Decoration.line({
        class: `cm-nb-md-line cm-nb-md-heading cm-nb-md-heading-${level}`,
      }).range(lineFrom),
    );
    return;
  }

  const quote = /^(\s*(?:>\s*)+)/.exec(text);
  if (quote) {
    const level = countQuoteLevel(quote[1]);
    ranges.push(
      Decoration.line({
        class: `cm-nb-md-line cm-nb-md-blockquote cm-nb-md-blockquote-${Math.min(
          level,
          6,
        )}`,
        attributes: { style: `--nb-md-quote-level: ${level}` },
      }).range(lineFrom),
    );
    return;
  }

  if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(text)) {
    ranges.push(
      Decoration.line({
        class: "cm-nb-md-line cm-nb-md-hr",
      }).range(lineFrom),
    );
    return;
  }

  if (/^\s*\|.+\|\s*$/.test(text)) {
    ranges.push(
      Decoration.line({
        class:
          tableRow?.separator === true
            ? "cm-nb-md-line cm-nb-md-table cm-nb-md-table-separator-rendered"
            : tableRow
              ? "cm-nb-md-line cm-nb-md-table cm-nb-md-table-rendered"
              : active
                ? "cm-nb-md-line cm-nb-md-table cm-nb-md-table-source"
                : "cm-nb-md-line cm-nb-md-table",
      }).range(lineFrom),
    );
  }
}

function hideLineSyntax(
  view: EditorView,
  lineFrom: number,
  text: string,
  ranges: Range<Decoration>[],
): void {
  const hide = Decoration.replace({ class: "cm-nb-md-hidden-syntax" });

  const heading = /^(#{1,6})(\s+)/.exec(text);
  if (heading) {
    ranges.push(
      hide.range(lineFrom, lineFrom + heading[1].length + heading[2].length),
    );
  }

  const quote = /^(\s*(?:>\s*)+)/.exec(text);
  if (quote) {
    ranges.push(hide.range(lineFrom, lineFrom + quote[1].length));
  }

  decorateInlineRegex(
    text,
    lineFrom,
    /\*\*([^*\n]+)\*\*/g,
    [
      [0, 2],
      [-2, 0],
    ],
    ranges,
  );

  decorateInlineRegex(
    text,
    lineFrom,
    /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
    [
      [1, 2],
      [-1, 0],
    ],
    ranges,
  );

  decorateInlineRegex(
    text,
    lineFrom,
    /~~([^~\n]+)~~/g,
    [
      [0, 2],
      [-2, 0],
    ],
    ranges,
  );

  decorateInlineRegex(
    text,
    lineFrom,
    /`([^`\n]+)`/g,
    [
      [0, 1],
      [-1, 0],
    ],
    ranges,
  );

  decorateLinks(text, lineFrom, ranges);
}

function decorateRenderedBlocks(
  lineFrom: number,
  text: string,
  ranges: Range<Decoration>[],
): void {
  decorateQuoteBars(lineFrom, text, ranges);
  decorateHorizontalRule(lineFrom, text, ranges);
}

interface FootnoteRenderModel {
  id: string;
  body: string;
}

function parseFootnoteDefinition(text: string): FootnoteRenderModel | undefined {
  const match = /^\s*\[\^([^\]\n]+)\]:\s*(.+?)\s*$/.exec(text);
  if (!match) return undefined;

  return {
    id: match[1],
    body: match[2],
  };
}

function decorateRenderedFootnote(
  lineFrom: number,
  lineTo: number,
  footnote: FootnoteRenderModel,
  ranges: Range<Decoration>[],
): void {
  ranges.push(
    Decoration.replace({
      widget: new FootnoteDefinitionWidget(footnote),
      inclusive: false,
    }).range(lineFrom, Math.max(lineFrom, lineTo)),
  );
}

function decorateQuoteBars(
  lineFrom: number,
  text: string,
  ranges: Range<Decoration>[],
): void {
  const quote = /^(\s*(?:>\s*)+)/.exec(text);
  if (!quote) return;

  const level = countQuoteLevel(quote[1]);
  ranges.push(
    Decoration.widget({
      widget: new QuoteBarsWidget(level),
      side: -1,
    }).range(lineFrom),
  );
}

function countQuoteLevel(markers: string): number {
  return [...markers].filter((char) => char === ">").length;
}

interface TableRowRenderModel {
  cells: string[];
  separator: boolean;
  tableStartLine: number;
}

function decorateRenderedTableRow(
  lineFrom: number,
  lineTo: number,
  row: TableRowRenderModel,
  ranges: Range<Decoration>[],
): void {
  ranges.push(
    Decoration.replace({
      widget: new TableRowWidget(
        row.cells,
        row.separator,
        lineFrom,
        row.tableStartLine,
      ),
      inclusive: false,
    }).range(lineFrom, Math.max(lineFrom, lineTo)),
  );
}

function decorateCollapsedTableSeparator(
  lineFrom: number,
  lineTo: number,
  ranges: Range<Decoration>[],
): void {
  ranges.push(
    Decoration.replace({
      widget: new CollapsedTableSeparatorWidget(),
      inclusive: false,
    }).range(lineFrom, Math.max(lineFrom, lineTo)),
  );
}

function parseTableRow(text: string): TableRowRenderModel | undefined {
  if (!isTableRow(text)) return undefined;

  const cells = splitTableCells(text).map((cell) => cell.trim());
  if (cells.length === 0) return undefined;

  return {
    cells,
    separator: cells.every(isTableSeparatorCell),
    tableStartLine: 0,
  };
}

function parseRenderableTableRow(
  view: EditorView,
  lineNumber: number,
): TableRowRenderModel | undefined {
  const tableStartLine = completeTableStartLine(view, lineNumber);
  if (tableStartLine == null) return undefined;

  const row = parseTableRow(view.state.doc.line(lineNumber).text);
  if (!row) return undefined;

  return { ...row, tableStartLine };
}

function completeTableStartLine(
  view: EditorView,
  lineNumber: number,
): number | undefined {
  const doc = view.state.doc;
  if (lineNumber < 1 || lineNumber > doc.lines) return undefined;

  let first = lineNumber;
  while (first > 1 && isTableRow(doc.line(first - 1).text)) {
    first -= 1;
  }

  if (first + 1 > doc.lines) return false;

  const header = parseTableRow(doc.line(first).text);
  const separator = parseTableRow(doc.line(first + 1).text);

  return header && separator?.separator ? first : undefined;
}

function splitTableCells(text: string): string[] {
  const cells: string[] = [];
  let start = 0;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char !== "|") continue;

    cells.push(text.slice(start, index).replaceAll("\\|", "|"));
    start = index + 1;
  }

  cells.push(text.slice(start).replaceAll("\\|", "|"));

  if (cells[0]?.trim() === "") cells.shift();
  if (cells[cells.length - 1]?.trim() === "") cells.pop();

  return cells;
}

function isTableRow(text: string): boolean {
  const pipes = collectTablePipeIndexes(text);
  return pipes.length >= 2 && /^\s*\|/.test(text) && /\|\s*$/.test(text);
}

function collectTablePipeIndexes(text: string): number[] {
  const indexes: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "|") continue;
    if (index > 0 && text[index - 1] === "\\") continue;
    indexes.push(index);
  }

  return indexes;
}

function isTableSeparatorCell(text: string): boolean {
  return /^\s*:?-{3,}:?\s*$/.test(text);
}

function decorateHorizontalRule(
  lineFrom: number,
  text: string,
  ranges: Range<Decoration>[],
): void {
  if (!/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(text)) return;

  ranges.push(
    Decoration.replace({
      widget: new HorizontalRuleWidget(),
      block: false,
      inclusive: false,
    }).range(lineFrom, lineFrom + text.length),
  );
}

function decorateInlineRegex(
  text: string,
  lineFrom: number,
  regex: RegExp,
  markerSlices: readonly (readonly [startOffset: number, endOffset: number])[],
  ranges: Range<Decoration>[],
): void {
  const hide = Decoration.replace({ class: "cm-nb-md-hidden-syntax" });

  for (const match of text.matchAll(regex)) {
    if (match.index == null) continue;

    const from = lineFrom + match.index;
    const to = from + match[0].length;

    for (const [startOffset, endOffset] of markerSlices) {
      const markerFrom =
        startOffset >= 0 ? from + startOffset : to + startOffset;
      const markerTo = endOffset > 0 ? from + endOffset : to + endOffset;
      if (markerFrom < markerTo) ranges.push(hide.range(markerFrom, markerTo));
    }
  }
}

function decorateLinks(
  text: string,
  lineFrom: number,
  ranges: Range<Decoration>[],
): void {
  const hide = Decoration.replace({ class: "cm-nb-md-hidden-syntax" });
  const linkText = Decoration.mark({ class: "cm-nb-md-link-text" });
  const link = /!?\[([^\]\n]+)\]\(([^)\n]+)\)/g;

  for (const match of text.matchAll(link)) {
    if (match.index == null) continue;

    const fullFrom = lineFrom + match.index;
    const image = match[0].startsWith("!");
    const labelFrom = fullFrom + (image ? 2 : 1);
    const labelTo = labelFrom + match[1].length;
    const closeBracket = labelTo;
    const destinationFrom = closeBracket + 1;
    const fullTo = fullFrom + match[0].length;

    ranges.push(linkText.range(labelFrom, labelTo));
    ranges.push(hide.range(fullFrom, labelFrom));
    ranges.push(hide.range(closeBracket, fullTo));

    if (image) {
      ranges.push(
        Decoration.widget({
          widget: new ImageBadgeWidget(match[2]),
          side: 1,
        }).range(destinationFrom),
      );
    }
  }
}

function decorateTaskCheckbox(
  lineFrom: number,
  text: string,
  ranges: Range<Decoration>[],
): void {
  const task = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]/.exec(text);
  if (!task) return;

  const from = lineFrom + task[1].length;
  const checkPos = from + 1;
  const checked = task[2].toLowerCase() === "x";

  ranges.push(
    Decoration.replace({
      widget: new TaskCheckboxWidget(checked, checkPos),
      inclusive: false,
    }).range(from, from + 3),
  );
}

function decorateSyntaxTree(
  view: EditorView,
  activeLines: Set<number>,
  options: WysiwymOptions,
  ranges: Range<Decoration>[],
): void {
  const hide = Decoration.replace({ class: "cm-nb-md-hidden-syntax" });
  const inlineCode = Decoration.mark({ class: "cm-nb-md-inline-code" });
  const emphasis = Decoration.mark({ class: "cm-nb-md-emphasis" });
  const strong = Decoration.mark({ class: "cm-nb-md-strong" });
  const strike = Decoration.mark({ class: "cm-nb-md-strike" });

  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const name = node.name;
        const active = activeLines.has(view.state.doc.lineAt(node.from).number);

        if (name === "FencedCode" || name === "CodeBlock") {
          decorateLinesInRange(
            view,
            node.from,
            node.to,
            "cm-nb-md-line cm-nb-md-codeblock",
            ranges,
          );
        }

        if (name === "InlineCode") {
          ranges.push(inlineCode.range(node.from, node.to));
        } else if (name === "Emphasis") {
          ranges.push(emphasis.range(node.from, node.to));
        } else if (name === "StrongEmphasis") {
          ranges.push(strong.range(node.from, node.to));
        } else if (name === "Strikethrough") {
          ranges.push(strike.range(node.from, node.to));
        }

        if (!options.hideSyntaxOnInactiveLines || active) return;

        if (
          name.endsWith("Mark") ||
          name === "HeaderMark" ||
          name === "CodeMark" ||
          name === "LinkMark"
        ) {
          ranges.push(hide.range(node.from, node.to));
        }
      },
    });
  }
}

function decorateLinesInRange(
  view: EditorView,
  from: number,
  to: number,
  className: string,
  ranges: Range<Decoration>[],
): void {
  let line = view.state.doc.lineAt(from);

  while (line.from <= to) {
    ranges.push(Decoration.line({ class: className }).range(line.from));
    if (line.number >= view.state.doc.lines) break;
    line = view.state.doc.line(line.number + 1);
  }
}

class QuoteBarsWidget extends WidgetType {
  constructor(private readonly level: number) {
    super();
  }

  eq(other: QuoteBarsWidget): boolean {
    return other.level === this.level;
  }

  toDOM(): HTMLElement {
    const bars = document.createElement("span");
    bars.className = "cm-nb-md-quote-bars";
    bars.setAttribute("aria-hidden", "true");

    for (let index = 0; index < this.level; index += 1) {
      const bar = document.createElement("span");
      bar.className = "cm-nb-md-quote-bar";
      bars.append(bar);
    }

    return bars;
  }
}

class TableRowWidget extends WidgetType {
  constructor(
    private readonly cells: readonly string[],
    private readonly separator: boolean,
    private readonly lineFrom: number,
    private readonly tableStartLine: number,
  ) {
    super();
  }

  eq(other: TableRowWidget): boolean {
    return (
      other.separator === this.separator &&
      other.lineFrom === this.lineFrom &&
      other.tableStartLine === this.tableStartLine &&
      other.cells.length === this.cells.length &&
      other.cells.every((cell, index) => cell === this.cells[index])
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const lineNumber = view.state.doc.lineAt(this.lineFrom).number;
    const row = document.createElement("span");
    row.className = `cm-nb-md-table-row cm-nb-md-table-row-${Math.min(
      this.cells.length,
      6,
    )}${this.separator ? " cm-nb-md-table-separator-row" : ""}`;
    row.style.gridTemplateColumns = tableGridTemplate(
      view,
      this.tableStartLine,
      this.cells.length,
    );
    row.dataset.tableLine = String(lineNumber);
    row.dataset.tableStartLine = String(this.tableStartLine);

    const dragHandle = document.createElement("span");
    dragHandle.className = "cm-nb-md-table-row-drag";
    dragHandle.contentEditable = "false";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const activeCell = activeTableCell();
      if (activeCell) commitTableCellElement(view, activeCell);
      startTableRowDrag(view, row, lineNumber, this.tableStartLine, event);
    });
    row.append(dragHandle);

    for (const [index, text] of this.cells.entries()) {
      const cell = document.createElement("span");
      cell.className = "cm-nb-md-table-cell";
      cell.contentEditable = "true";
      cell.spellcheck = true;
      cell.dataset.tableLine = String(lineNumber);
      cell.dataset.tableCell = String(index);
      cell.dataset.raw = this.separator ? "" : text;
      cell.dataset.editing = "false";
      renderTableCellDisplay(cell);
      cell.setAttribute("role", "textbox");
      cell.setAttribute("aria-label", `Table cell ${index + 1}`);
      if (index < this.cells.length - 1) {
        const resizeHandle = document.createElement("span");
        resizeHandle.className = "cm-nb-md-table-resize";
        resizeHandle.contentEditable = "false";
        resizeHandle.setAttribute("aria-hidden", "true");
        resizeHandle.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          commitTableCellElement(view, cell);
          startTableColumnResize(
            view,
            row,
            this.tableStartLine,
            index,
            event,
          );
        });
        cell.append(resizeHandle);
      }
      cell.addEventListener("focus", () => {
        showRawTableCellSyntax(cell);
      });
      cell.addEventListener("mousedown", (event) => {
        const activeCell = activeTableCell();
        if (activeCell && activeCell !== cell) {
          event.preventDefault();
          event.stopPropagation();
          commitTableCellElement(view, activeCell);
          focusRenderedTableCell(view, lineNumber, index);
          return;
        }

        event.stopPropagation();
      });
      cell.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      cell.addEventListener("copy", (event) => {
        event.stopPropagation();
      });
      cell.addEventListener("cut", (event) => {
        event.stopPropagation();
        queueTableCellRawSync(cell);
      });
      cell.addEventListener("input", () => {
        syncTableCellRaw(cell);
      });
      cell.addEventListener("blur", () => {
        syncTableCellRaw(cell);
        commitTableCellElement(view, cell);
        renderTableCellDisplay(cell);
      });
      cell.addEventListener("keydown", (event) => {
        event.stopPropagation();

        if (event.key === "Enter") {
          event.preventDefault();
          syncTableCellRaw(cell);
          commitTableCellElement(view, cell);
          return;
        }

        if (event.key !== "Tab") return;

        event.preventDefault();
        syncTableCellRaw(cell);
        commitTableCellElement(view, cell);
        moveTableCellFocus(view, lineNumber, index, event.shiftKey);
      });
      cell.addEventListener("paste", (event) => {
        event.stopPropagation();

        const text = event.clipboardData?.getData("text/plain");
        if (!text) return;

        const transformed = transformPastedMarkdownText(text);
        event.preventDefault();
        insertTextIntoEditableCell(transformed);
        syncTableCellRaw(cell);
      });
      row.append(cell);
    }

    return row;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function tableGridTemplate(
  view: EditorView,
  tableStartLine: number,
  columns: number,
): string {
  const widths = tableColumnWidths.get(view)?.get(tableStartLine);
  if (widths?.length === columns) {
    return widths
      .map((width) => `${Math.max(tableMinColumnWidth, width)}px`)
      .join(" ");
  }

  if (columns <= 1) return "minmax(0, 1fr)";
  if (columns === 2) return "repeat(2, minmax(0, 1fr))";

  return `minmax(7.5rem, 0.55fr) repeat(${columns - 1}, minmax(0, 1.45fr))`;
}

function startTableColumnResize(
  view: EditorView,
  row: HTMLElement,
  tableStartLine: number,
  columnIndex: number,
  event: MouseEvent,
): void {
  const cells = [...row.querySelectorAll<HTMLElement>(".cm-nb-md-table-cell")];
  const left = cells[columnIndex];
  const right = cells[columnIndex + 1];
  if (!left || !right) return;

  const startX = event.clientX;
  const startWidths = cells.map((cell) => cell.getBoundingClientRect().width);
  const leftStart = startWidths[columnIndex];
  const rightStart = startWidths[columnIndex + 1];
  const pairWidth = leftStart + rightStart;
  const minWidth = tableMinColumnWidth;
  if (pairWidth < minWidth * 2) return;

  document.body.classList.add("nb-md-table-resizing");

  const onMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX;
    const leftWidth = clamp(leftStart + delta, minWidth, pairWidth - minWidth);
    const rightWidth = pairWidth - leftWidth;
    const widths = startWidths.slice();
    widths[columnIndex] = leftWidth;
    widths[columnIndex + 1] = rightWidth;
    setTableColumnWidths(view, tableStartLine, widths);
  };

  const onUp = () => {
    document.body.classList.remove("nb-md-table-resizing");
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
  };

  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
}

function setTableColumnWidths(
  view: EditorView,
  tableStartLine: number,
  widths: readonly number[],
): void {
  let editorTables = tableColumnWidths.get(view);
  if (!editorTables) {
    editorTables = new Map();
    tableColumnWidths.set(view, editorTables);
  }

  editorTables.set(tableStartLine, [...widths]);

  const template = widths
    .map((width) => `${Math.max(tableMinColumnWidth, width)}px`)
    .join(" ");
  for (const row of view.dom.querySelectorAll<HTMLElement>(
    `.cm-nb-md-table-row[data-table-start-line="${tableStartLine}"]`,
  )) {
    row.style.gridTemplateColumns = template;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface TableRowDropTarget {
  lineNumber: number;
  placement: "before" | "after";
  row: HTMLElement;
}

function startTableRowDrag(
  view: EditorView,
  row: HTMLElement,
  lineNumber: number,
  tableStartLine: number,
  event: MouseEvent,
): void {
  const indicator = tableDropIndicator();
  let target: TableRowDropTarget | undefined;

  row.classList.add("is-dragging");
  document.body.classList.add("nb-md-table-row-dragging");

  const onMove = (moveEvent: MouseEvent) => {
    target = tableRowDropTargetAtPoint(
      view,
      tableStartLine,
      lineNumber,
      moveEvent.clientX,
      moveEvent.clientY,
    );

    if (!target) {
      indicator.hidden = true;
      return;
    }

    positionTableDropIndicator(indicator, target);
  };

  const onUp = () => {
    row.classList.remove("is-dragging");
    document.body.classList.remove("nb-md-table-row-dragging");
    indicator.hidden = true;
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);

    if (target) reorderTableRow(view, lineNumber, target);
  };

  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
  onMove(event);
}

function tableRowDropTargetAtPoint(
  view: EditorView,
  tableStartLine: number,
  sourceLine: number,
  x: number,
  y: number,
): TableRowDropTarget | undefined {
  const candidates = document.elementsFromPoint(x, y);

  for (const candidate of candidates) {
    const row = candidate instanceof Element
      ? candidate.closest<HTMLElement>(".cm-nb-md-table-row")
      : null;
    if (!row || !view.dom.contains(row)) continue;
    if (Number(row.dataset.tableStartLine) !== tableStartLine) continue;

    const lineNumber = Number(row.dataset.tableLine);
    if (!Number.isInteger(lineNumber) || lineNumber === sourceLine) continue;

    const rect = row.getBoundingClientRect();
    const placement = y < rect.top + rect.height / 2 ? "before" : "after";
    return { lineNumber, placement, row };
  }

  return undefined;
}

function tableDropIndicator(): HTMLElement {
  let indicator = document.querySelector<HTMLElement>(
    ".cm-nb-md-table-drop-indicator",
  );

  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "cm-nb-md-table-drop-indicator";
    indicator.hidden = true;
    document.body.append(indicator);
  }

  return indicator;
}

function positionTableDropIndicator(
  indicator: HTMLElement,
  target: TableRowDropTarget,
): void {
  const rect = target.row.getBoundingClientRect();
  const y = target.placement === "before" ? rect.top : rect.bottom;

  indicator.hidden = false;
  indicator.style.left = `${rect.left}px`;
  indicator.style.top = `${Math.round(y)}px`;
  indicator.style.width = `${rect.width}px`;
}

function reorderTableRow(
  view: EditorView,
  sourceLineNumber: number,
  target: TableRowDropTarget,
): void {
  const doc = view.state.doc;
  if (
    sourceLineNumber < 1 ||
    sourceLineNumber > doc.lines ||
    target.lineNumber < 1 ||
    target.lineNumber > doc.lines
  ) {
    return;
  }

  const sourceLine = doc.line(sourceLineNumber);
  const sourceText = sourceLine.text;
  const removeFrom = sourceLine.from;
  const removeTo = sourceLine.to + (sourceLineNumber < doc.lines ? 1 : 0);

  let insertLineNumber =
    target.placement === "before" ? target.lineNumber : target.lineNumber + 1;

  if (insertLineNumber === sourceLineNumber || insertLineNumber === sourceLineNumber + 1) {
    return;
  }

  if (insertLineNumber > sourceLineNumber) insertLineNumber -= 1;

  const afterRemoval = doc.toString().slice(0, removeFrom) + doc.toString().slice(removeTo);
  const lines = afterRemoval.split("\n");
  const insertIndex = Math.max(0, Math.min(lines.length, insertLineNumber - 1));
  lines.splice(insertIndex, 0, sourceText);

  view.dispatch({
    changes: { from: 0, to: doc.length, insert: lines.join("\n") },
    scrollIntoView: true,
  });
}

function commitTableCell(
  view: EditorView,
  lineNumber: number,
  cellIndex: number,
  value: string,
): void {
  if (lineNumber < 1 || lineNumber > view.state.doc.lines) return;

  const line = view.state.doc.line(lineNumber);
  const row = parseTableRow(line.text);
  if (!row || row.separator || row.cells[cellIndex] == null) return;

  const nextCells = row.cells.slice();
  nextCells[cellIndex] = normalizeTableCellText(value);
  const nextLine = renderTableRow(nextCells);

  if (nextLine === line.text) return;

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: nextLine },
  });
}

function commitTableCellElement(view: EditorView, cell: HTMLElement): void {
  const lineNumber = Number(cell.dataset.tableLine);
  const cellIndex = Number(cell.dataset.tableCell);

  if (!Number.isInteger(lineNumber) || !Number.isInteger(cellIndex)) return;

  const value =
    cell.dataset.editing === "true"
      ? tableCellEditableText(cell)
      : (cell.dataset.raw ?? "");

  cell.dataset.raw = value;
  cell.dataset.editing = "false";

  commitTableCell(view, lineNumber, cellIndex, value);
}

function syncTableCellRaw(cell: HTMLElement): void {
  if (cell.dataset.editing !== "true") return;
  cell.dataset.raw = tableCellEditableText(cell);
}

function queueTableCellRawSync(cell: HTMLElement): void {
  requestAnimationFrame(() => syncTableCellRaw(cell));
}

function tableCellEditableText(cell: HTMLElement): string {
  const clone = cell.cloneNode(true) as HTMLElement;
  for (const handle of clone.querySelectorAll(".cm-nb-md-table-resize")) {
    handle.remove();
  }

  return clone.textContent ?? "";
}

function showRawTableCellSyntax(cell: HTMLElement): void {
  if (cell.dataset.editing === "true") return;

  const raw = cell.dataset.raw ?? "";
  const handle = detachTableResizeHandle(cell);
  cell.replaceChildren(document.createTextNode(raw));
  if (handle) cell.append(handle);
  cell.dataset.editing = "true";
}

function renderTableCellDisplay(cell: HTMLElement): void {
  const raw = cell.dataset.raw ?? "";
  const handle = detachTableResizeHandle(cell);
  cell.replaceChildren();
  appendRenderedInlineMarkdown(cell, raw);
  if (handle) cell.append(handle);
  cell.dataset.editing = "false";
}

function detachTableResizeHandle(cell: HTMLElement): HTMLElement | undefined {
  const handle = cell.querySelector<HTMLElement>(":scope > .cm-nb-md-table-resize");
  handle?.remove();
  return handle ?? undefined;
}

function appendRenderedInlineMarkdown(parent: HTMLElement, text: string): void {
  const token =
    /(\*\*[^*\n]+?\*\*|`[^`\n]+?`|\[[^\]\n]+?\]\([^) \n]+?\)|(?<!\*)\*[^*\n]+?\*(?!\*))/g;
  let index = 0;

  for (const match of text.matchAll(token)) {
    if (match.index == null) continue;

    appendText(parent, text.slice(index, match.index));
    appendMarkdownToken(parent, match[0]);
    index = match.index + match[0].length;
  }

  appendText(parent, text.slice(index));
}

function appendMarkdownToken(parent: HTMLElement, token: string): void {
  if (token.startsWith("**") && token.endsWith("**")) {
    const strong = document.createElement("strong");
    strong.className = "cm-nb-md-strong";
    strong.textContent = token.slice(2, -2);
    parent.append(strong);
    return;
  }

  if (token.startsWith("`") && token.endsWith("`")) {
    const code = document.createElement("code");
    code.className = "cm-nb-md-inline-code";
    code.textContent = token.slice(1, -1);
    parent.append(code);
    return;
  }

  const link = /^\[([^\]\n]+?)\]\(([^) \n]+?)\)$/.exec(token);
  if (link) {
    const anchor = document.createElement("span");
    anchor.className = "cm-nb-md-link-text";
    anchor.textContent = link[1];
    anchor.title = link[2];
    parent.append(anchor);
    return;
  }

  if (token.startsWith("*") && token.endsWith("*")) {
    const emphasis = document.createElement("em");
    emphasis.className = "cm-nb-md-emphasis";
    emphasis.textContent = token.slice(1, -1);
    parent.append(emphasis);
    return;
  }

  appendText(parent, token);
}

function appendText(parent: HTMLElement, text: string): void {
  if (!text) return;
  parent.append(document.createTextNode(text));
}

class FootnoteDefinitionWidget extends WidgetType {
  constructor(private readonly footnote: FootnoteRenderModel) {
    super();
  }

  eq(other: FootnoteDefinitionWidget): boolean {
    return (
      other.footnote.id === this.footnote.id &&
      other.footnote.body === this.footnote.body
    );
  }

  toDOM(): HTMLElement {
    const row = document.createElement("span");
    row.className = "cm-nb-md-footnote";

    const id = document.createElement("sup");
    id.className = "cm-nb-md-footnote-id";
    id.textContent = this.footnote.id;

    const body = document.createElement("span");
    body.className = "cm-nb-md-footnote-body";
    appendRenderedInlineMarkdown(body, this.footnote.body);

    row.append(id, body);
    return row;
  }
}

function insertTextIntoEditableCell(text: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    document.execCommand("insertText", false, text);
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function activeTableCell(): HTMLElement | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return undefined;
  if (!active.classList.contains("cm-nb-md-table-cell")) return undefined;
  return active;
}

function normalizeTableCellText(value: string): string {
  return value.replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
}

function renderTableRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function moveTableCellFocus(
  view: EditorView,
  lineNumber: number,
  cellIndex: number,
  backwards: boolean,
): void {
  const doc = view.state.doc;
  if (lineNumber < 1 || lineNumber > doc.lines) return;

  const line = doc.line(lineNumber);
  const row = parseTableRow(line.text);
  if (!row || row.separator) return;

  if (backwards) {
    const target = previousTableCell(view, line.number, cellIndex);
    if (target) focusRenderedTableCell(view, target.lineNumber, target.cellIndex);
    return;
  }

  if (cellIndex + 1 < row.cells.length) {
    focusRenderedTableCell(view, line.number, cellIndex + 1);
    return;
  }

  const target = nextTableCell(view, line.number);
  if (target) {
    focusRenderedTableCell(view, target.lineNumber, target.cellIndex);
    return;
  }

  insertLineAfterTable(view, line.number);
}

function previousTableCell(
  view: EditorView,
  lineNumber: number,
  cellIndex: number,
): { lineNumber: number; cellIndex: number } | undefined {
  if (cellIndex > 0) return { lineNumber, cellIndex: cellIndex - 1 };

  for (let index = lineNumber - 1; index >= 1; index -= 1) {
    const line = view.state.doc.line(index);
    const row = parseTableRow(line.text);
    if (!row) return undefined;
    if (row.separator) continue;
    return { lineNumber: index, cellIndex: Math.max(0, row.cells.length - 1) };
  }

  return undefined;
}

function nextTableCell(
  view: EditorView,
  lineNumber: number,
): { lineNumber: number; cellIndex: number } | undefined {
  for (let index = lineNumber + 1; index <= view.state.doc.lines; index += 1) {
    const line = view.state.doc.line(index);
    const row = parseTableRow(line.text);
    if (!row) return undefined;
    if (row.separator) continue;
    return { lineNumber: index, cellIndex: 0 };
  }

  return undefined;
}

function focusRenderedTableCell(
  view: EditorView,
  lineNumber: number,
  cellIndex: number,
): void {
  requestAnimationFrame(() => {
    const selector = `.cm-nb-md-table-cell[data-table-line="${lineNumber}"][data-table-cell="${cellIndex}"]`;
    const cell = view.dom.querySelector<HTMLElement>(selector);
    if (!cell) return;

    cell.focus();
    selectElementText(cell);
  });
}

function selectElementText(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertLineAfterTable(view: EditorView, lineNumber: number): void {
  let lastTableLine = lineNumber;

  for (let index = lineNumber + 1; index <= view.state.doc.lines; index += 1) {
    const line = view.state.doc.line(index);
    if (!parseTableRow(line.text)) break;
    lastTableLine = index;
  }

  const line = view.state.doc.line(lastTableLine);
  view.dispatch({
    changes: { from: line.to, insert: "\n" },
    selection: { anchor: line.to + 1 },
    scrollIntoView: true,
  });
  view.focus();
}

class CollapsedTableSeparatorWidget extends WidgetType {
  toDOM(): HTMLElement {
    const spacer = document.createElement("span");
    spacer.className = "cm-nb-md-table-separator-spacer";
    spacer.setAttribute("aria-hidden", "true");
    return spacer;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-nb-md-hr-rule";
    rule.setAttribute("aria-hidden", "true");
    return rule;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly checkPos: number,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.checkPos === this.checkPos;
  }

  toDOM(view: EditorView): HTMLElement {
    const label = document.createElement("label");
    label.className = "cm-nb-md-task";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.setAttribute(
      "aria-label",
      this.checked ? "Mark incomplete" : "Mark complete",
    );

    input.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    input.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.checkPos,
          to: this.checkPos + 1,
          insert: input.checked ? "x" : " ",
        },
      });
      view.focus();
    });

    label.append(input);
    return label;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class ImageBadgeWidget extends WidgetType {
  constructor(private readonly destination: string) {
    super();
  }

  eq(other: ImageBadgeWidget): boolean {
    return other.destination === this.destination;
  }

  toDOM(): HTMLElement {
    const badge = document.createElement("span");
    badge.className = "cm-nb-md-image-badge";
    badge.textContent = "image";
    badge.title = this.destination;
    return badge;
  }
}
