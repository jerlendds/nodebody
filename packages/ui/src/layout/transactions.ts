import type {
  LayoutDocument,
  LayoutNode,
  LayoutNodeId,
  LayoutTab,
  LayoutTabId,
  SplitAxis,
  StackNode,
  LayoutContent,
} from "./model";

export type LayoutTransaction =
  | ActivateTabTx
  | OpenTabTx
  | CloseTabTx
  | CloseStackTx
  | SplitNodeTx
  | SplitTabTx
  | ReplaceTabPageTx
  | MoveTabTx
  | ResizeSplitTx;

export interface ActivateTabTx {
  type: "activateTab";
  stackId: LayoutNodeId;
  tabId: LayoutTabId;
}

export interface OpenTabTx {
  type: "openTab";
  stackId: LayoutNodeId;
  tab: LayoutTab;
  page: LayoutNode;
  content?: LayoutContent;
  activate?: boolean;
}

export interface CloseTabTx {
  type: "closeTab";
  stackId: LayoutNodeId;
  tabId: LayoutTabId;
}

export interface CloseStackTx {
  type: "closeStack";
  stackId: LayoutNodeId;
}

export interface SplitNodeTx {
  type: "splitNode";
  targetNodeId: LayoutNodeId;
  axis: SplitAxis;
  newNode: LayoutNode;
  nodes?: readonly LayoutNode[];
  tabs?: readonly LayoutTab[];
  contents?: readonly LayoutContent[];
  position: "before" | "after";
}

export interface SplitTabTx {
  type: "splitTab";
  fromStackId: LayoutNodeId;
  tabId: LayoutTabId;
  targetNodeId: LayoutNodeId;
  axis: SplitAxis;
  position: "before" | "after";
}

export interface ReplaceTabPageTx {
  type: "replaceTabPage";
  tabId: LayoutTabId;
  page: LayoutNode;
}

export interface MoveTabTx {
  type: "moveTab";
  fromStackId: LayoutNodeId;
  toStackId: LayoutNodeId;
  tabId: LayoutTabId;
  index?: number;
  activate?: boolean;
}

export interface ResizeSplitTx {
  type: "resizeSplit";
  splitId: LayoutNodeId;
  ratios: number[];
}

export function applyLayoutTransaction(
  doc: LayoutDocument,
  tx: LayoutTransaction,
): LayoutDocument {
  switch (tx.type) {
    case "activateTab":
      return activateTab(doc, tx.stackId, tx.tabId);
    case "openTab":
      return openTab(doc, tx);
    case "closeTab":
      return closeTab(doc, tx.stackId, tx.tabId);
    case "closeStack":
      return closeStack(doc, tx.stackId);
    case "splitNode":
      return splitNode(doc, tx);
    case "splitTab":
      return splitTab(doc, tx);
    case "replaceTabPage":
      return replaceTabPage(doc, tx);
    case "moveTab":
      return moveTab(doc, tx);
    case "resizeSplit":
      return resizeSplit(doc, tx);
  }
}

export function activateTab(
  doc: LayoutDocument,
  stackId: LayoutNodeId,
  tabId: LayoutTabId,
): LayoutDocument {
  const stack = stackNode(doc, stackId);
  if (!stack || !stack.tabIds.includes(tabId)) return doc;

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [stackId]: { ...stack, activeTabId: tabId },
    },
  };
}

function openTab(doc: LayoutDocument, tx: OpenTabTx): LayoutDocument {
  const stack = stackNode(doc, tx.stackId);
  if (!stack || doc.tabs[tx.tab.id]) return doc;

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [tx.page.id]: tx.page,
      [tx.stackId]: {
        ...stack,
        tabIds: stack.tabIds.concat(tx.tab.id),
        activeTabId: tx.activate === false ? stack.activeTabId : tx.tab.id,
      },
    },
    tabs: { ...doc.tabs, [tx.tab.id]: tx.tab },
    contents: tx.content
      ? { ...doc.contents, [tx.content.id]: tx.content }
      : doc.contents,
  };
}

function closeTab(
  doc: LayoutDocument,
  stackId: LayoutNodeId,
  tabId: LayoutTabId,
): LayoutDocument {
  const stack = stackNode(doc, stackId);
  if (!stack || !stack.tabIds.includes(tabId)) return doc;

  const tabIds = stack.tabIds.filter((id) => id !== tabId);
  const nextActiveTabId =
    stack.activeTabId === tabId
      ? tabIds[Math.min(stack.tabIds.indexOf(tabId), tabIds.length - 1)]
      : stack.activeTabId;

  const tabs = { ...doc.tabs };
  delete tabs[tabId];

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [stackId]: { ...stack, tabIds, activeTabId: nextActiveTabId },
    },
    tabs,
  };
}

function closeStack(
  doc: LayoutDocument,
  stackId: LayoutNodeId,
): LayoutDocument {
  const stack = stackNode(doc, stackId);
  const parent = stack ? findParentSplit(doc, stackId) : undefined;
  if (!stack || !parent) return doc;

  const removed = collectSubtreeRefs(doc, stackId);
  const nodes = { ...doc.nodes };
  const tabs = { ...doc.tabs };
  const contents = { ...doc.contents };

  for (const id of removed.nodeIds) delete nodes[id];
  for (const id of removed.tabIds) delete tabs[id];
  for (const id of removed.contentIds) delete contents[id];

  const parentSplit = parent.split;
  const remainingChildIds = parentSplit.childIds.filter((id) => id !== stackId);

  if (remainingChildIds.length === 1) {
    delete nodes[parentSplit.id];
    return replaceNodeReference(
      {
        ...doc,
        nodes,
        tabs,
        contents,
      },
      parentSplit.id,
      remainingChildIds[0],
    );
  }

  nodes[parentSplit.id] = {
    ...parentSplit,
    childIds: remainingChildIds,
    ratios: parentSplit.ratios?.filter((_ratio, index) => index !== parent.index),
  };

  return {
    ...doc,
    nodes,
    tabs,
    contents,
  };
}

function splitNode(doc: LayoutDocument, tx: SplitNodeTx): LayoutDocument {
  const target = doc.nodes[tx.targetNodeId];
  if (!target || doc.nodes[tx.newNode.id]) return doc;

  const splitId = `split:${tx.targetNodeId}:${Date.now().toString(36)}`;
  const childIds =
    tx.position === "before"
      ? [tx.newNode.id, tx.targetNodeId]
      : [tx.targetNodeId, tx.newNode.id];

  return replaceNodeReference(
    {
      ...doc,
      nodes: {
        ...doc.nodes,
        ...Object.fromEntries((tx.nodes ?? []).map((node) => [node.id, node])),
        [tx.newNode.id]: tx.newNode,
        [splitId]: {
          kind: "split",
          id: splitId,
          axis: tx.axis,
          childIds,
          ratios: [0.5, 0.5],
        },
      },
      tabs: {
        ...doc.tabs,
        ...Object.fromEntries((tx.tabs ?? []).map((tab) => [tab.id, tab])),
      },
      contents: {
        ...doc.contents,
        ...Object.fromEntries(
          (tx.contents ?? []).map((content) => [content.id, content]),
        ),
      },
    },
    tx.targetNodeId,
    splitId,
  );
}

function splitTab(doc: LayoutDocument, tx: SplitTabTx): LayoutDocument {
  const fromStack = stackNode(doc, tx.fromStackId);
  const target = doc.nodes[tx.targetNodeId];
  const tab = doc.tabs[tx.tabId];
  if (!fromStack || !target || !tab) return doc;
  if (!fromStack.tabIds.includes(tx.tabId)) return doc;
  if (containsNode(doc, tab.page, tx.targetNodeId)) return doc;

  const nextFromTabIds = fromStack.tabIds.filter((id) => id !== tx.tabId);
  if (!nextFromTabIds.length) return doc;

  const newStackId = `stack:${tx.tabId}:split:${Date.now().toString(36)}`;
  const splitId = `split:${tx.targetNodeId}:${tx.tabId}:${Date.now().toString(36)}`;
  const childIds =
    tx.position === "before"
      ? [newStackId, tx.targetNodeId]
      : [tx.targetNodeId, newStackId];
  const nextActiveTabId =
    fromStack.activeTabId === tx.tabId
      ? nextFromTabIds[
          Math.min(fromStack.tabIds.indexOf(tx.tabId), nextFromTabIds.length - 1)
        ]
      : fromStack.activeTabId;

  return replaceNodeReference(
    {
      ...doc,
      nodes: {
        ...doc.nodes,
        [tx.fromStackId]: {
          ...fromStack,
          tabIds: nextFromTabIds,
          activeTabId: nextActiveTabId,
        },
        [newStackId]: {
          kind: "stack",
          id: newStackId,
          tabIds: [tx.tabId],
          activeTabId: tx.tabId,
        },
        [splitId]: {
          kind: "split",
          id: splitId,
          axis: tx.axis,
          childIds,
          ratios: [0.5, 0.5],
        },
      },
    },
    tx.targetNodeId,
    splitId,
  );
}

function replaceTabPage(
  doc: LayoutDocument,
  tx: ReplaceTabPageTx,
): LayoutDocument {
  const tab = doc.tabs[tx.tabId];
  if (!tab) return doc;

  return {
    ...doc,
    nodes: { ...doc.nodes, [tx.page.id]: tx.page },
    tabs: { ...doc.tabs, [tx.tabId]: { ...tab, page: tx.page.id } },
  };
}

function moveTab(doc: LayoutDocument, tx: MoveTabTx): LayoutDocument {
  const from = stackNode(doc, tx.fromStackId);
  const to = stackNode(doc, tx.toStackId);
  if (!from || !to || !from.tabIds.includes(tx.tabId)) return doc;

  const nextFromIds = from.tabIds.filter((id) => id !== tx.tabId);
  const nextToIds = to.tabIds.filter((id) => id !== tx.tabId);
  nextToIds.splice(tx.index ?? nextToIds.length, 0, tx.tabId);

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [tx.fromStackId]: {
        ...from,
        tabIds: nextFromIds,
        activeTabId:
          from.activeTabId === tx.tabId
            ? nextFromIds[Math.min(from.tabIds.indexOf(tx.tabId), nextFromIds.length - 1)]
            : from.activeTabId,
      },
      [tx.toStackId]: {
        ...to,
        tabIds: nextToIds,
        activeTabId: tx.activate === false ? to.activeTabId : tx.tabId,
      },
    },
  };
}

function resizeSplit(doc: LayoutDocument, tx: ResizeSplitTx): LayoutDocument {
  const split = doc.nodes[tx.splitId];
  if (!split || split.kind !== "split") return doc;

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [tx.splitId]: { ...split, ratios: tx.ratios },
    },
  };
}

function replaceNodeReference(
  doc: LayoutDocument,
  oldNodeId: LayoutNodeId,
  newNodeId: LayoutNodeId,
): LayoutDocument {
  if (doc.root === oldNodeId) return { ...doc, root: newNodeId };

  const nodes = { ...doc.nodes };
  for (const node of Object.values(nodes)) {
    if (node.kind === "split" && node.childIds.includes(oldNodeId)) {
      nodes[node.id] = {
        ...node,
        childIds: node.childIds.map((id) =>
          id === oldNodeId ? newNodeId : id,
        ),
      };
      return { ...doc, nodes };
    }

    if (node.kind === "stack") {
      const tab = node.tabIds.map((id) => doc.tabs[id]).find((candidate) => {
        return candidate?.page === oldNodeId;
      });
      if (tab) {
        return {
          ...doc,
          tabs: {
            ...doc.tabs,
            [tab.id]: { ...tab, page: newNodeId },
          },
        };
      }
    }
  }

  return doc;
}

function stackNode(
  doc: LayoutDocument,
  nodeId: LayoutNodeId,
): StackNode | undefined {
  const node = doc.nodes[nodeId];
  return node?.kind === "stack" ? node : undefined;
}

function findParentSplit(
  doc: LayoutDocument,
  nodeId: LayoutNodeId,
): { split: Extract<LayoutNode, { kind: "split" }>; index: number } | undefined {
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== "split") continue;
    const index = node.childIds.indexOf(nodeId);
    if (index >= 0) return { split: node, index };
  }

  return undefined;
}

function collectSubtreeRefs(
  doc: LayoutDocument,
  nodeId: LayoutNodeId,
): {
  nodeIds: Set<LayoutNodeId>;
  tabIds: Set<LayoutTabId>;
  contentIds: Set<string>;
} {
  const nodeIds = new Set<LayoutNodeId>();
  const tabIds = new Set<LayoutTabId>();
  const contentIds = new Set<string>();

  collect(nodeId);

  return { nodeIds, tabIds, contentIds };

  function collect(id: LayoutNodeId): void {
    const node = doc.nodes[id];
    if (!node || nodeIds.has(id)) return;

    nodeIds.add(id);

    if (node.kind === "content") {
      contentIds.add(node.contentId);
      return;
    }

    if (node.kind === "split") {
      for (const childId of node.childIds) collect(childId);
      return;
    }

    for (const tabId of node.tabIds) {
      tabIds.add(tabId);
      const tab = doc.tabs[tabId];
      if (tab) collect(tab.page);
    }
  }
}

function containsNode(
  doc: LayoutDocument,
  rootNodeId: LayoutNodeId,
  targetNodeId: LayoutNodeId,
): boolean {
  if (rootNodeId === targetNodeId) return true;

  const root = doc.nodes[rootNodeId];
  if (!root) return false;

  if (root.kind === "split") {
    return root.childIds.some((childId) => containsNode(doc, childId, targetNodeId));
  }

  if (root.kind === "stack") {
    return root.tabIds.some((tabId) => {
      const tab = doc.tabs[tabId];
      return tab ? containsNode(doc, tab.page, targetNodeId) : false;
    });
  }

  return false;
}
