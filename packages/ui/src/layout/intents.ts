import type {
  ContentId,
  LayoutNodeId,
  LayoutTabId,
  SplitAxis,
} from "./model";

export type LayoutStrength =
  | "required"
  | "strong"
  | "medium"
  | "weak"
  | "stay";

export type LayoutConstraintScope =
  | { kind: "workspace" }
  | { kind: "tabPage"; tabId: LayoutTabId }
  | { kind: "node"; nodeId: LayoutNodeId }
  | { kind: "content"; contentId: ContentId };

export type LayoutSubject =
  | { kind: "node"; nodeId: LayoutNodeId }
  | { kind: "tab"; tabId: LayoutTabId }
  | { kind: "content"; contentId: ContentId }
  | { kind: "anchor"; contentId: ContentId; anchorId: string };

export type LayoutIntent =
  | KeepNearIntent
  | KeepVisibleIntent
  | PreferSplitIntent
  | PreferSizeIntent
  | AlignIntent
  | StayIntent
  | PluginIntent;

export interface BaseLayoutIntent {
  id: string;
  source: string;
  scope: LayoutConstraintScope;
  strength: LayoutStrength;
  reason: string;
}

export interface KeepNearIntent extends BaseLayoutIntent {
  kind: "keep-near";
  a: LayoutSubject;
  b: LayoutSubject;
  maxDistance?: number;
}

export interface KeepVisibleIntent extends BaseLayoutIntent {
  kind: "keep-visible";
  target: LayoutSubject;
  margin?: number;
}

export interface PreferSplitIntent extends BaseLayoutIntent {
  kind: "prefer-split";
  primary: LayoutSubject;
  secondary: LayoutSubject;
  axis?: SplitAxis;
}

export interface PreferSizeIntent extends BaseLayoutIntent {
  kind: "prefer-size";
  target: LayoutSubject;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
}

export interface AlignIntent extends BaseLayoutIntent {
  kind: "align";
  a: LayoutSubject;
  b: LayoutSubject;
  axis: "x" | "y" | "centerX" | "centerY";
}

export interface StayIntent extends BaseLayoutIntent {
  kind: "stay";
  target: LayoutSubject;
}

export interface PluginIntent extends BaseLayoutIntent {
  kind: `plugin:${string}`;
  payload: unknown;
}

export interface LayoutBudget {
  maxIntentsPerSource: number;
  maxPortsPerContent: number;
  maxUpdatesPerSecond: number;
  mayRequestFocus: boolean;
  mayCreateEphemeralTabs: boolean;
}

export const defaultLayoutBudget: LayoutBudget = {
  maxIntentsPerSource: 32,
  maxPortsPerContent: 128,
  maxUpdatesPerSecond: 30,
  mayRequestFocus: false,
  mayCreateEphemeralTabs: false,
};

export const strengthWeight = {
  required: Number.POSITIVE_INFINITY,
  strong: 1_000_000,
  medium: 10_000,
  weak: 100,
  stay: 10,
} as const satisfies Record<LayoutStrength, number>;
