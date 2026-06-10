import { mount, type Component } from "../base/component";
import { el } from "../base/dom";
import { disposable, Scope, type Disposable } from "../base/disposable";
import { html, render } from "../base/html";
import { plusIcon, xIcon } from "../components/icons";
import type {
  ContentNode,
  LayoutContent,
  LayoutDocument,
  LayoutNodeId,
  LayoutTabId,
  SplitNode,
  StackNode,
} from "./model";
import type { LayoutTransaction } from "./transactions";

const tabDragMime = "application/x-interfacez-layout-tab";

interface DraggedTabPayload {
  stackId: LayoutNodeId;
  tabId: LayoutTabId;
}

type DropSide = "left" | "right" | "top" | "bottom";

export interface LayoutSurfaceActions {
  dispatch(tx: LayoutTransaction): void;
  addTab?: (stackId: LayoutNodeId) => void;
  resolveContent?(content: LayoutContent): Component | undefined;
}

export class LayoutRenderer implements Disposable {
  readonly element = el("section", "nb-layout-surface");

  private frameScope = new Scope();
  private readonly contentScopes = new Map<string, Scope>();
  private readonly contentElements = new Map<string, HTMLElement>();
  private disposed = false;

  constructor(private readonly actions: LayoutSurfaceActions) {
    this.element.setAttribute("aria-label", "Workspace layout");
  }

  update(doc: LayoutDocument): void {
    if (this.disposed) return;

    this.frameScope.dispose();
    this.frameScope = new Scope();
    this.element.dataset.layoutRoot = doc.root;
    this.element.replaceChildren();

    const mountedContentIds = new Set<string>();
    renderNode(this.element, doc.root, doc, this.frameScope, this.actions, {
      contentScopes: this.contentScopes,
      contentElements: this.contentElements,
      mountedContentIds,
    });

    for (const contentId of this.contentElements.keys()) {
      if (doc.contents[contentId]) continue;
      this.contentElements.get(contentId)?.remove();
      this.contentElements.delete(contentId);
      this.contentScopes.get(contentId)?.dispose();
      this.contentScopes.delete(contentId);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.frameScope.dispose();
    for (const scope of this.contentScopes.values()) scope.dispose();
    this.contentScopes.clear();
    this.contentElements.clear();
    this.element.remove();
  }
}

export function createLayoutSurface(
  doc: LayoutDocument,
  scope: Scope,
  actions: LayoutSurfaceActions,
): HTMLElement {
  const renderer = scope.add(new LayoutRenderer(actions));
  renderer.update(doc);
  return renderer.element;
}

interface RenderCache {
  contentScopes: Map<string, Scope>;
  contentElements: Map<string, HTMLElement>;
  mountedContentIds: Set<string>;
}

function renderNode(
  host: HTMLElement,
  nodeId: LayoutNodeId,
  doc: LayoutDocument,
  scope: Scope,
  actions: LayoutSurfaceActions,
  cache?: RenderCache,
  currentStackId?: LayoutNodeId,
) {
  const node = doc.nodes[nodeId];
  if (!node) throw new Error(`Missing layout node: ${nodeId}`);

  if (node.kind === "stack")
    renderStack(host, node, doc, scope, actions, cache);
  else if (node.kind === "split") {
    renderSplit(host, node, doc, scope, actions, cache, currentStackId);
  } else renderContent(host, node, doc, scope, actions, cache, currentStackId);
}

function renderStack(
  host: HTMLElement,
  node: StackNode,
  doc: LayoutDocument,
  scope: Scope,
  actions: LayoutSurfaceActions,
  cache?: RenderCache,
) {
  const stack = el("section", "nb-stack");
  stack.dataset.layoutNode = node.id;
  stack.dataset.stack = node.id;
  if (node.chrome?.tabbar === "hidden") stack.dataset.tabbar = "hidden";

  if (node.chrome?.tabbar !== "hidden") {
    const tabbar = el("div", "nb-tabbar");
    const tabs = el("div", "nb-tabs");
    tabs.setAttribute("role", "tablist");
    bindTabbarDropTarget(tabbar, node.id, scope, actions);

    let activeTabEl: HTMLElement | undefined;
    for (const tabId of node.tabIds) {
      const tab = doc.tabs[tabId];
      if (!tab) continue;

      const isActive = tabId === activeTabId(node);
      const tabEl = el("div", `nb-tab${isActive ? " is-active" : ""}`);
      tabEl.draggable = true;
      tabEl.tabIndex = 0;
      tabEl.dataset.stack = node.id;
      tabEl.dataset.tab = tab.id;
      tabEl.setAttribute("role", "tab");
      tabEl.setAttribute("aria-selected", String(isActive));
      tabEl.append(el("span", "nb-tab__label", tab.title));
      bindTabDrag(tabEl, node.id, tab.id, scope);

      if (tab.closable !== false) {
        const close = el("button", "nb-tab__close");
        close.type = "button";
        render(close, xIcon);
        close.title = `Close ${tab.title}`;
        close.setAttribute("aria-label", `Close ${tab.title}`);
        close.addEventListener("click", (event) => {
          event.stopPropagation();
          actions.dispatch({ type: "closeTab", stackId: node.id, tabId });
        });
        tabEl.append(close);
      }

      const activate = () =>
        actions.dispatch({ type: "activateTab", stackId: node.id, tabId });
      tabEl.addEventListener("click", activate);
      tabEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") activate();
      });

      if (isActive) activeTabEl = tabEl;
      tabs.append(tabEl);
    }

    if (node.chrome?.addButton !== false) {
      const add = el("button", "nb-tab-add");
      add.type = "button";
      render(add, plusIcon);
      add.title = "New tab";
      add.dataset.stack = node.id;
      add.setAttribute("aria-label", "New tab");
      add.addEventListener("click", () => actions.addTab?.(node.id));
      tabs.append(add);
    }

    tabbar.append(tabs);

    if (isStackClosable(doc, node.id)) {
      const closeStack = el("button", "nb-tab-add nb-stack-close");
      closeStack.type = "button";
      render(closeStack, xIcon);
      closeStack.title = "Close split pane";
      closeStack.setAttribute("aria-label", "Close split pane");
      closeStack.addEventListener("click", () => {
        actions.dispatch({ type: "closeStack", stackId: node.id });
      });
      tabbar.append(closeStack);
    }

    bindTabScroller(tabs, scope);
    scrollActiveTabIntoView(activeTabEl);
    stack.append(tabbar);
  }

  const page = el("div", "nb-tab-page");
  const activeTab = doc.tabs[activeTabId(node)];
  if (activeTab)
    renderNode(page, activeTab.page, doc, scope, actions, cache, node.id);
  else page.append(createEmptyState());

  stack.append(page);
  host.append(stack);
}

function renderSplit(
  host: HTMLElement,
  node: SplitNode,
  doc: LayoutDocument,
  scope: Scope,
  actions: LayoutSurfaceActions,
  cache?: RenderCache,
  currentStackId?: LayoutNodeId,
) {
  const split = el("section", `nb-split nb-split--${node.axis}`);
  split.dataset.layoutNode = node.id;
  split.style.setProperty("--nb-split-count", String(node.childIds.length));
  const ratios = normalizedRatios(node.ratios, node.childIds.length);
  if (node.axis === "horizontal") {
    split.style.gridTemplateColumns = splitTrackTemplate(ratios);
  } else {
    split.style.gridTemplateRows = splitTrackTemplate(ratios);
  }

  node.childIds.forEach((childId, index) => {
    const child = el("div", "nb-split__child");
    child.dataset.splitChild = childId;
    child.style.setProperty("--nb-split-ratio", String(ratios[index] ?? 1));
    renderNode(child, childId, doc, scope, actions, cache, currentStackId);
    split.append(child);

    if (index < node.childIds.length - 1) {
      const gutter = el("div", "nb-split__gutter");
      gutter.dataset.split = node.id;
      gutter.dataset.splitGutter = String(index);
      gutter.setAttribute("role", "separator");
      gutter.setAttribute(
        "aria-orientation",
        node.axis === "horizontal" ? "vertical" : "horizontal",
      );
      bindSplitGutter(gutter, split, node, ratios, index, scope, actions);
      split.append(gutter);
    }
  });

  host.append(split);
}

function renderContent(
  host: HTMLElement,
  node: ContentNode,
  doc: LayoutDocument,
  scope: Scope,
  actions: LayoutSurfaceActions,
  cache?: RenderCache,
  currentStackId?: LayoutNodeId,
) {
  const content = doc.contents[node.contentId];
  let surface = cache?.contentElements.get(node.contentId);
  if (!surface) {
    surface = el("section", "nb-content-surface nb-pane__surface");
    cache?.contentElements.set(node.contentId, surface);
    const contentScope = cache ? new Scope() : scope;
    if (cache) cache.contentScopes.set(node.contentId, contentScope);

    const component =
      content && (actions.resolveContent?.(content) ?? content.view);
    if (component) contentScope.add(mount(component, surface));
    else surface.append(createEmptyState());
  }

  surface.dataset.layoutNode = node.id;
  surface.dataset.splitTarget = currentStackId ?? node.id;
  surface.dataset.content = node.contentId;
  surface.dataset.resource = content?.resource ?? "";
  bindContentDropTarget(surface, currentStackId ?? node.id, scope, actions);
  cache?.mountedContentIds.add(node.contentId);

  host.append(surface);
}

function bindTabDrag(
  tabEl: HTMLElement,
  stackId: LayoutNodeId,
  tabId: LayoutTabId,
  scope: Scope,
) {
  const onDragStart = (event: DragEvent) => {
    if (!event.dataTransfer) return;
    const payload = JSON.stringify({
      stackId,
      tabId,
    } satisfies DraggedTabPayload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(tabDragMime, payload);
    event.dataTransfer.setData("text/plain", tabId);
    tabEl.classList.add("is-dragging");
  };

  const onDragEnd = () => {
    tabEl.classList.remove("is-dragging");
    clearDropIndicators(document);
  };

  tabEl.addEventListener("dragstart", onDragStart);
  tabEl.addEventListener("dragend", onDragEnd);
  scope.add(
    disposable(() => {
      tabEl.removeEventListener("dragstart", onDragStart);
      tabEl.removeEventListener("dragend", onDragEnd);
    }),
  );
}

function bindContentDropTarget(
  surface: HTMLElement,
  targetNodeId: LayoutNodeId,
  scope: Scope,
  actions: LayoutSurfaceActions,
) {
  const onDragOver = (event: DragEvent) => {
    if (!hasDraggedTab(event)) return;

    event.preventDefault();
    event.dataTransfer!.dropEffect = "move";
    surface.dataset.dropSide = dropSide(surface, event);
  };

  const onDragLeave = (event: DragEvent) => {
    if (surface.contains(event.relatedTarget as Node | null)) return;
    delete surface.dataset.dropSide;
  };

  const onDrop = (event: DragEvent) => {
    const payload = draggedTabPayload(event);
    if (!payload) return;

    event.preventDefault();
    const side = dropSide(surface, event);
    delete surface.dataset.dropSide;
    actions.dispatch({
      type: "splitTab",
      fromStackId: payload.stackId,
      tabId: payload.tabId,
      targetNodeId,
      axis: side === "top" || side === "bottom" ? "vertical" : "horizontal",
      position: side === "left" || side === "top" ? "before" : "after",
    });
  };

  surface.addEventListener("dragover", onDragOver);
  surface.addEventListener("dragleave", onDragLeave);
  surface.addEventListener("drop", onDrop);
  scope.add(
    disposable(() => {
      surface.removeEventListener("dragover", onDragOver);
      surface.removeEventListener("dragleave", onDragLeave);
      surface.removeEventListener("drop", onDrop);
    }),
  );
}

function bindTabbarDropTarget(
  tabbar: HTMLElement,
  targetStackId: LayoutNodeId,
  scope: Scope,
  actions: LayoutSurfaceActions,
) {
  const onDragOver = (event: DragEvent) => {
    if (!hasDraggedTab(event)) return;

    event.preventDefault();
    event.dataTransfer!.dropEffect = "move";
    tabbar.dataset.dropStack = "true";
  };

  const onDragLeave = (event: DragEvent) => {
    if (tabbar.contains(event.relatedTarget as Node | null)) return;
    delete tabbar.dataset.dropStack;
  };

  const onDrop = (event: DragEvent) => {
    const payload = draggedTabPayload(event);
    if (!payload || payload.stackId === targetStackId) return;

    event.preventDefault();
    delete tabbar.dataset.dropStack;
    actions.dispatch({
      type: "moveTab",
      fromStackId: payload.stackId,
      toStackId: targetStackId,
      tabId: payload.tabId,
      activate: true,
    });
  };

  tabbar.addEventListener("dragover", onDragOver);
  tabbar.addEventListener("dragleave", onDragLeave);
  tabbar.addEventListener("drop", onDrop);
  scope.add(
    disposable(() => {
      tabbar.removeEventListener("dragover", onDragOver);
      tabbar.removeEventListener("dragleave", onDragLeave);
      tabbar.removeEventListener("drop", onDrop);
    }),
  );
}

function hasDraggedTab(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(tabDragMime);
}

function draggedTabPayload(event: DragEvent): DraggedTabPayload | undefined {
  const raw = event.dataTransfer?.getData(tabDragMime);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<DraggedTabPayload>;
    if (!parsed.stackId || !parsed.tabId) return undefined;
    return { stackId: parsed.stackId, tabId: parsed.tabId };
  } catch {
    return undefined;
  }
}

function dropSide(surface: HTMLElement, event: DragEvent): DropSide {
  const rect = surface.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const verticalBand = Math.min(96, rect.height * 0.34);

  if (y <= verticalBand) return "top";
  if (y >= rect.height - verticalBand) return "bottom";

  const distances = [
    ["left", x],
    ["right", rect.width - x],
  ] as const;

  return distances.reduce((nearest, candidate) => {
    return candidate[1] < nearest[1] ? candidate : nearest;
  })[0];
}

function clearDropIndicators(root: ParentNode) {
  for (const surface of root.querySelectorAll<HTMLElement>(
    "[data-drop-side]",
  )) {
    delete surface.dataset.dropSide;
  }
  for (const tabbar of root.querySelectorAll<HTMLElement>(
    "[data-drop-stack]",
  )) {
    delete tabbar.dataset.dropStack;
  }
}

function normalizedRatios(
  ratios: readonly number[] | undefined,
  count: number,
): number[] {
  return Array.from({ length: count }, (_, index) => {
    const ratio = ratios?.[index] ?? 1;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  });
}

function splitTrackTemplate(ratios: readonly number[]): string {
  return ratios
    .flatMap((ratio, index) =>
      index === ratios.length - 1 ? [`${ratio}fr`] : [`${ratio}fr`, "3px"],
    )
    .join(" ");
}

function bindSplitGutter(
  gutter: HTMLElement,
  split: HTMLElement,
  node: SplitNode,
  ratios: readonly number[],
  gutterIndex: number,
  scope: Scope,
  actions: LayoutSurfaceActions,
) {
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;

    event.preventDefault();
    gutter.setPointerCapture(event.pointerId);
    split.classList.add("is-resizing");

    const startX = event.clientX;
    const startY = event.clientY;
    const start = [...ratios];
    const total = start.reduce((sum, ratio) => sum + ratio, 0);
    const rect = split.getBoundingClientRect();
    const size = node.axis === "horizontal" ? rect.width : rect.height;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaPx =
        node.axis === "horizontal"
          ? moveEvent.clientX - startX
          : moveEvent.clientY - startY;
      const deltaRatio = size > 0 ? (deltaPx / size) * total : 0;
      const next = [...start];
      const left = Math.max(0.08, start[gutterIndex] + deltaRatio);
      const right = Math.max(0.08, start[gutterIndex + 1] - deltaRatio);
      const pairTotal = start[gutterIndex] + start[gutterIndex + 1];
      const pairScale = pairTotal / (left + right);

      next[gutterIndex] = left * pairScale;
      next[gutterIndex + 1] = right * pairScale;
      actions.dispatch({ type: "resizeSplit", splitId: node.id, ratios: next });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      gutter.releasePointerCapture(upEvent.pointerId);
      split.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  gutter.addEventListener("pointerdown", onPointerDown);
  scope.add(
    disposable(() => gutter.removeEventListener("pointerdown", onPointerDown)),
  );
}

function bindTabScroller(tabs: HTMLElement, scope: Scope) {
  const onWheel = (event: WheelEvent) => {
    if (tabs.scrollWidth <= tabs.clientWidth) return;
    event.preventDefault();
    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    tabs.scrollLeft += delta * 1.6;
  };
  tabs.addEventListener("wheel", onWheel, { passive: false });
  scope.add(disposable(() => tabs.removeEventListener("wheel", onWheel)));
}

function scrollActiveTabIntoView(tab: HTMLElement | undefined) {
  if (!tab) return;
  requestAnimationFrame(() => {
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function activeTabId(node: StackNode): LayoutTabId {
  return node.activeTabId ?? node.tabIds[0] ?? "";
}

function isStackClosable(doc: LayoutDocument, stackId: LayoutNodeId): boolean {
  return Object.values(doc.nodes).some((node) => {
    return node.kind === "split" && node.childIds.includes(stackId);
  });
}

function createEmptyState() {
  const empty = el("div", "nb-empty");
  render(
    empty,
    html`<strong>No resource open</strong>
      <span>Select a resource or run a command to open a view.</span>`,
  );
  return empty;
}
