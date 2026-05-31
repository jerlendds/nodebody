import { el } from "../base/dom";
import { html, render } from "../base/html";
import { disposable, type Scope } from "../base/disposable";
import { mount } from "../base/component";
import type { PaneModel } from "./types";
import { plusIcon, xIcon } from "./icons";
import { layoutFromLegacyPanes } from "../layout/legacy";
import { createLayoutSurface } from "../layout/render";

export interface PaneGroupActions {
  addTab?: (paneId: string) => void;
  activateTab?: (paneId: string, tabId: string) => void;
  closeTab?: (paneId: string, tabId: string) => void;
}

/// Create a group of editor panes. The current version lays panes out
/// side-by-side; later split-tree rendering can keep this API shape.
export function createPaneGroup(
  panes: PaneModel[],
  scope: Scope,
  actions: PaneGroupActions = {}
) {
  const doc = layoutFromLegacyPanes(panes);
  const paneByStack = new Map<string, string>(
    panes.map((pane) => [`stack:${pane.id}`, pane.id] as const),
  );
  const surface = createLayoutSurface(doc, scope, {
    addTab(stackId) {
      const paneId = paneByStack.get(stackId);
      if (paneId) actions.addTab?.(paneId);
    },
    dispatch(tx) {
      if (tx.type !== "activateTab" && tx.type !== "closeTab") return;
      const paneId = paneByStack.get(tx.stackId);
      if (!paneId) return;
      if (tx.type === "activateTab") actions.activateTab?.(paneId, tx.tabId);
      else actions.closeTab?.(paneId, tx.tabId);
    },
  });
  surface.classList.add("nb-pane-group");
  surface.setAttribute("aria-label", "Editor panes");
  return surface;
}

/// Create one tabbed pane and mount its active view, if provided.
export function createPane(
  model: PaneModel,
  scope: Scope,
  actions: PaneGroupActions = {}
) {
  const pane = el("section", "nb-pane");
  pane.dataset.pane = model.id;

  const tabbar = el("div", "nb-tabbar");
  const tabs = el("div", "nb-tabs");
  tabs.setAttribute("role", "tablist");
  let activeTab: HTMLElement | undefined;
  for (const tab of model.tabs) {
    const tabEl = el("div", `nb-tab${tab.active ? " is-active" : ""}`);
    tabEl.draggable = true;
    tabEl.tabIndex = 0;
    tabEl.dataset.tab = tab.id;
    tabEl.dataset.pane = model.id;
    tabEl.setAttribute("role", "tab");
    tabEl.setAttribute("aria-selected", String(Boolean(tab.active)));
    tabEl.append(el("span", "nb-tab__label", tab.title));

    const close = el("button", "nb-tab__close");
    close.type = "button";
    render(close, xIcon);
    close.title = `Close ${tab.title}`;
    close.setAttribute("aria-label", `Close ${tab.title}`);
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.closeTab?.(model.id, tab.id);
    });

    tabEl.append(close);
    tabEl.addEventListener("click", () =>
      actions.activateTab?.(model.id, tab.id)
    );
    tabEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ")
        actions.activateTab?.(model.id, tab.id);
    });
    if (tab.active) activeTab = tabEl;
    tabs.append(tabEl);
  }
  const add = el("button", "nb-tab-add");
  add.type = "button";
  render(add, plusIcon);
  add.title = "New tab";
  add.dataset.pane = model.id;
  add.setAttribute("aria-label", "New tab");
  add.addEventListener("click", () => actions.addTab?.(model.id));
  tabs.append(add);
  tabbar.append(tabs);
  bindTabScroller(tabs, scope);
  scrollActiveTabIntoView(activeTab);

  const surface = el("div", "nb-pane__surface");
  const active = model.tabs.find((tab) => tab.active) ?? model.tabs[0];
  if (active?.view) scope.add(mount(active.view, surface));
  else surface.append(createEmptyState());

  pane.append(tabbar, surface);
  return pane;
}

/// Translate vertical wheel motion over an overflowing tab strip into
/// direct horizontal scrolling.
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

// Empty panes still render a real surface so split and iframe hosts
// can later replace the content without changing the surrounding DOM.
function createEmptyState() {
  const empty = el("div", "nb-empty");
  render(
    empty,
    html`<strong>No resource open</strong>
      <span>Select a resource or run a command to open a view.</span>`
  );
  return empty;
}
