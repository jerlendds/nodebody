import type { ContentId, LayoutTabId } from "./model";

export interface LayoutPort {
  id: string;
  contentId: ContentId;
  tabId?: LayoutTabId;
  kind:
    | "tab"
    | "viewport"
    | "cursor"
    | "selection"
    | "heading"
    | "block"
    | "pdf-page"
    | "pdf-text"
    | "web-element"
    | `plugin:${string}`;
  rect(): DOMRectReadOnly | null;
  stability: "static" | "scroll" | "animated" | "unknown";
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface SerializedLayoutPort {
  id: string;
  contentId: ContentId;
  tabId?: LayoutTabId;
  kind: LayoutPort["kind"];
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  stability: LayoutPort["stability"];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface LayoutPortSink {
  setPorts(contentId: ContentId, ports: readonly LayoutPort[]): void;
  clearPorts(contentId: ContentId): void;
}

export class LayoutPortRegistry implements LayoutPortSink {
  private readonly portsByContent = new Map<ContentId, readonly LayoutPort[]>();

  setPorts(contentId: ContentId, ports: readonly LayoutPort[]): void {
    this.portsByContent.set(contentId, [...ports]);
  }

  clearPorts(contentId: ContentId): void {
    this.portsByContent.delete(contentId);
  }

  all(): readonly LayoutPort[] {
    return [...this.portsByContent.values()].flat();
  }

  forContent(contentId: ContentId): readonly LayoutPort[] {
    return this.portsByContent.get(contentId) ?? [];
  }

  get(id: string): LayoutPort | undefined {
    return this.all().find((port) => port.id === id);
  }
}

export function serializedPortToLayoutPort(
  port: SerializedLayoutPort,
  offset?: DOMRectReadOnly,
): LayoutPort {
  return {
    id: port.id,
    contentId: port.contentId,
    tabId: port.tabId,
    kind: port.kind,
    stability: port.stability,
    confidence: port.confidence,
    metadata: port.metadata,
    rect: () => {
      if (!port.rect) return null;
      const left = port.rect.left + (offset?.left ?? 0);
      const top = port.rect.top + (offset?.top ?? 0);
      return new DOMRectReadOnly(left, top, port.rect.width, port.rect.height);
    },
  };
}
