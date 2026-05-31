import type { PaneModel, TabModel } from "../components/types";
import type { LayoutContent, LayoutDocument } from "./model";

export function layoutFromLegacyPanes(
  panes: readonly PaneModel[],
): LayoutDocument {
  const nodes: LayoutDocument["nodes"] = {};
  const tabs: LayoutDocument["tabs"] = {};
  const contents: LayoutDocument["contents"] = {};

  const stackIds = panes.map((pane) => {
    const stackId = `stack:${pane.id}`;
    const tabIds = pane.tabs.map((tab) => {
      const tabId = tab.id;
      const contentId = `content:${tab.id}`;
      const pageId = `page:${tab.id}`;

      contents[contentId] = legacyContent(tab, contentId);
      nodes[pageId] = { kind: "content", id: pageId, contentId };

      tabs[tabId] = {
        id: tabId,
        title: tab.title,
        resource: tab.resource,
        page: pageId,
        closable: true,
        metadata: tab.layout ? { layout: tab.layout } : undefined,
      };

      return tabId;
    });

    nodes[stackId] = {
      kind: "stack",
      id: stackId,
      tabIds,
      activeTabId: pane.tabs.find((tab) => tab.active)?.id ?? pane.tabs[0]?.id,
    };

    return stackId;
  });

  const root = stackIds.length === 1 ? stackIds[0] : "root:split";

  if (stackIds.length > 1) {
    nodes[root] = {
      kind: "split",
      id: root,
      axis: "horizontal",
      childIds: stackIds,
      ratios: stackIds.map(() => 1 / stackIds.length),
    };
  }

  if (stackIds.length === 0) {
    nodes["root:empty"] = {
      kind: "stack",
      id: "root:empty",
      tabIds: [],
    };
  }

  return {
    version: 1,
    root: stackIds.length === 0 ? "root:empty" : root,
    nodes,
    tabs,
    contents,
  };
}

function legacyContent(tab: TabModel, id: string): LayoutContent {
  return {
    id,
    kind: tab.kind === "markdown" || tab.kind === "pdf" || tab.kind === "web"
      ? tab.kind
      : "empty",
    resource: tab.resource,
    view: tab.view,
    minWidth: tab.layout?.minWidth,
    minHeight: tab.layout?.minHeight,
    preferredWidth: tab.layout?.preferredWidth,
    preferredHeight: tab.layout?.preferredHeight,
  };
}
