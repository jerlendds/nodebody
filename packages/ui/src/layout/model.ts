import type { Component } from "../base/component";

export type LayoutNodeId = string;
export type LayoutTabId = string;
export type ContentId = string;

export type SplitAxis = "horizontal" | "vertical";

export interface LayoutDocument {
  version: 1;
  root: LayoutNodeId;
  nodes: Record<LayoutNodeId, LayoutNode>;
  tabs: Record<LayoutTabId, LayoutTab>;
  contents: Record<ContentId, LayoutContent>;
  activePath?: LayoutPath;
}

export type LayoutNode = StackNode | SplitNode | ContentNode;

export interface StackNode {
  kind: "stack";
  id: LayoutNodeId;
  tabIds: LayoutTabId[];
  activeTabId?: LayoutTabId;
  chrome?: {
    tabbar?: "top" | "bottom" | "hidden";
    addButton?: boolean;
  };
  constraints?: NodeConstraintHints;
}

export interface LayoutTab {
  id: LayoutTabId;
  title: string;
  resource: string;
  page: LayoutNodeId;
  closable?: boolean;
  pinned?: boolean;
  icon?: string;
  metadata?: Record<string, unknown>;
}

export interface SplitNode {
  kind: "split";
  id: LayoutNodeId;
  axis: SplitAxis;
  childIds: LayoutNodeId[];
  ratios?: number[];
  constraints?: NodeConstraintHints;
}

export interface ContentNode {
  kind: "content";
  id: LayoutNodeId;
  contentId: ContentId;
  constraints?: NodeConstraintHints;
}

export interface LayoutContent {
  id: ContentId;
  kind: "markdown" | "pdf" | "web" | `plugin:${string}` | "empty";
  resource: string;
  view?: Component;
  minWidth?: number;
  minHeight?: number;
  preferredWidth?: number;
  preferredHeight?: number;
  capabilities?: readonly LayoutCapability[];
  metadata?: Record<string, unknown>;
}

export interface NodeConstraintHints {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  preferredWidth?: number;
  preferredHeight?: number;
  stay?: boolean;
}

export interface LayoutPath {
  nodeIds: LayoutNodeId[];
  tabIds?: LayoutTabId[];
}

export type LayoutCapability =
  | "layout.ports"
  | "layout.intents"
  | "layout.global-intents"
  | "layout.receive-applied"
  | "tab.open"
  | "tab.split"
  | "tab.inspect-neighbors";
