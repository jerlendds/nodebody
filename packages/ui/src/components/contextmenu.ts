import type { Disposable } from "../base/disposable";

export type ContextMenuTrigger = "mouse" | "keyboard" | "focus" | "hover";

export interface ContextMenuAnchor {
  readonly x: number;
  readonly y: number;
}

export interface ContextMenuEvent {
  readonly trigger: ContextMenuTrigger;
  readonly target: HTMLElement;
  readonly anchor: ContextMenuAnchor;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export interface ContextMenuAction {
  readonly id: string;
  readonly label?: string;
  readonly enabled?: boolean;
  readonly visible?: boolean;
  readonly checked?: boolean;
  readonly type?: "normal" | "checkbox" | "radio" | "separator";
  readonly accelerator?: string;
}

export interface ContextMenuScope {
  shouldShow?(event: ContextMenuEvent): boolean;
  getActions(event: ContextMenuEvent): readonly ContextMenuAction[];
  runAction(actionId: string, event: ContextMenuEvent): void | Promise<void>;
}

export interface ContextMenuBridge {
  show(payload: {
    readonly actions: readonly ContextMenuAction[];
    readonly x: number;
    readonly y: number;
  }): Promise<{ readonly id: string } | null>;
}

export interface ContextMenuControllerOptions {
  readonly root?: HTMLElement | Document;
  readonly bridge?: ContextMenuBridge;
  readonly hoverOpenDelayMs?: number;
  readonly enableHoverMenus?: boolean;
  readonly keyboardOpenKeys?: readonly string[];
}

declare global {
  interface Window {
    contextMenu?: ContextMenuBridge;
    electronContextMenu?: ContextMenuBridge;
  }
}

interface RegisteredScope {
  readonly element: HTMLElement;
  readonly scope: ContextMenuScope;
}

const defaultKeyboardOpenKeys = ["ContextMenu"];

/// A delegated, root-level context menu controller for renderer UI.
export class ContextMenuController implements Disposable {
  private readonly root: HTMLElement | Document;
  private readonly bridge: ContextMenuBridge | undefined;
  private readonly scopes = new WeakMap<HTMLElement, ContextMenuScope>();
  private readonly hoverOpenDelayMs: number;
  private readonly enableHoverMenus: boolean;
  private readonly keyboardOpenKeys: readonly string[];

  private hoverTimer: number | undefined;
  private contextMenuFallbackTimer: number | undefined;
  private hoveredElement: HTMLElement | undefined;
  private focusedElement: HTMLElement | undefined;
  private activeRequestId = 0;
  private contextMenuEventVersion = 0;

  private readonly onContextMenuBound = this.onContextMenu.bind(this);
  private readonly onPointerDownBound = this.onPointerDown.bind(this);
  private readonly onPointerOverBound = this.onPointerOver.bind(this);
  private readonly onPointerOutBound = this.onPointerOut.bind(this);
  private readonly onFocusInBound = this.onFocusIn.bind(this);
  private readonly onFocusOutBound = this.onFocusOut.bind(this);
  private readonly onKeyDownBound = this.onKeyDown.bind(this);

  constructor(options: ContextMenuControllerOptions = {}) {
    this.root = options.root ?? document;
    this.bridge = options.bridge;
    this.hoverOpenDelayMs = options.hoverOpenDelayMs ?? 350;
    this.enableHoverMenus = options.enableHoverMenus ?? false;
    this.keyboardOpenKeys = options.keyboardOpenKeys ?? defaultKeyboardOpenKeys;

    this.root.addEventListener("contextmenu", this.onContextMenuBound, {
      capture: true,
      passive: false,
    });
    this.root.addEventListener("pointerdown", this.onPointerDownBound, {
      capture: true,
      passive: true,
    });
    this.root.addEventListener("focusin", this.onFocusInBound, {
      capture: true,
      passive: true,
    });
    this.root.addEventListener("focusout", this.onFocusOutBound, {
      capture: true,
      passive: true,
    });
    this.root.addEventListener("keydown", this.onKeyDownBound, {
      capture: true,
      passive: false,
    });

    if (this.enableHoverMenus) {
      this.root.addEventListener("pointerover", this.onPointerOverBound, {
        capture: true,
        passive: true,
      });
      this.root.addEventListener("pointerout", this.onPointerOutBound, {
        capture: true,
        passive: true,
      });
    }
  }

  register(element: HTMLElement, scope: ContextMenuScope): Disposable {
    this.scopes.set(element, scope);

    return {
      dispose: () => {
        this.scopes.delete(element);
        if (this.hoveredElement === element) this.hoveredElement = undefined;
        if (this.focusedElement === element) this.focusedElement = undefined;
      },
    };
  }

  dispose(): void {
    this.clearHoverTimer();
    this.root.removeEventListener("contextmenu", this.onContextMenuBound, true);
    this.root.removeEventListener("pointerdown", this.onPointerDownBound, true);
    this.root.removeEventListener("pointerover", this.onPointerOverBound, true);
    this.root.removeEventListener("pointerout", this.onPointerOutBound, true);
    this.root.removeEventListener("focusin", this.onFocusInBound, true);
    this.root.removeEventListener("focusout", this.onFocusOutBound, true);
    this.root.removeEventListener("keydown", this.onKeyDownBound, true);
    this.hoveredElement = undefined;
    this.focusedElement = undefined;
  }

  async showForElement(
    element: HTMLElement,
    trigger: ContextMenuTrigger = "focus",
    anchor: ContextMenuAnchor = anchorForElement(element),
    sourceEvent?: MouseEvent | KeyboardEvent | PointerEvent,
  ): Promise<void> {
    const resolved = this.resolveScope(element);
    if (!resolved) return;

    await this.show(resolved, {
      trigger,
      target: element,
      anchor,
      shiftKey: !!sourceEvent?.shiftKey,
      ctrlKey: !!sourceEvent?.ctrlKey,
      altKey: !!sourceEvent?.altKey,
      metaKey: !!sourceEvent?.metaKey,
    });
  }

  private onContextMenu(event: Event): void {
    const mouseEvent = event as MouseEvent;
    const target = event.target;
    this.contextMenuEventVersion += 1;
    this.clearContextMenuFallbackTimer();

    const resolved = this.resolveScopeForEvent(mouseEvent);
    if (!resolved) return;

    event.preventDefault();
    event.stopPropagation();

    void this.show(resolved, {
      trigger: "mouse",
      target: eventTargetElement(target),
      anchor: { x: mouseEvent.clientX, y: mouseEvent.clientY },
      shiftKey: mouseEvent.shiftKey,
      ctrlKey: mouseEvent.ctrlKey,
      altKey: mouseEvent.altKey,
      metaKey: mouseEvent.metaKey,
    });
  }

  private onPointerDown(event: Event): void {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.button !== 2) return;

    const version = this.contextMenuEventVersion;
    this.clearContextMenuFallbackTimer();
    this.contextMenuFallbackTimer = window.setTimeout(() => {
      this.contextMenuFallbackTimer = undefined;
      if (version !== this.contextMenuEventVersion) return;

      const resolved = this.resolveScopeForPoint(
        pointerEvent.clientX,
        pointerEvent.clientY,
      );
      if (!resolved) return;

      void this.show(resolved, {
        trigger: "mouse",
        target: eventTargetElement(pointerEvent.target),
        anchor: { x: pointerEvent.clientX, y: pointerEvent.clientY },
        shiftKey: pointerEvent.shiftKey,
        ctrlKey: pointerEvent.ctrlKey,
        altKey: pointerEvent.altKey,
        metaKey: pointerEvent.metaKey,
      });
    }, 80);
  }

  private onKeyDown(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    const opensByKey = this.keyboardOpenKeys.includes(keyEvent.key);
    const opensByShiftF10 = keyEvent.shiftKey && keyEvent.key === "F10";
    if (!opensByKey && !opensByShiftF10) return;

    const target = keyEvent.target;

    const resolved = this.resolveScope(this.focusedElement ?? target);
    if (!resolved) return;

    keyEvent.preventDefault();
    keyEvent.stopPropagation();

    void this.show(resolved, {
      trigger: "keyboard",
      target: eventTargetElement(target),
      anchor: anchorForElement(resolved.element),
      shiftKey: keyEvent.shiftKey,
      ctrlKey: keyEvent.ctrlKey,
      altKey: keyEvent.altKey,
      metaKey: keyEvent.metaKey,
    });
  }

  private onPointerOver(event: Event): void {
    const pointerEvent = event as PointerEvent;
    const target = event.target;

    const resolved = this.resolveScope(target);
    if (!resolved) return;

    this.hoveredElement = resolved.element;
    this.clearHoverTimer();
    this.hoverTimer = window.setTimeout(() => {
      if (this.hoveredElement !== resolved.element) return;

      void this.show(resolved, {
        trigger: "hover",
        target: eventTargetElement(target),
        anchor: anchorForElement(resolved.element),
        shiftKey: pointerEvent.shiftKey,
        ctrlKey: pointerEvent.ctrlKey,
        altKey: pointerEvent.altKey,
        metaKey: pointerEvent.metaKey,
      });
    }, this.hoverOpenDelayMs);
  }

  private onPointerOut(event: Event): void {
    const target = event.target;

    const resolved = this.resolveScope(target);
    if (resolved && this.hoveredElement === resolved.element) {
      this.hoveredElement = undefined;
      this.clearHoverTimer();
    }
  }

  private onFocusIn(event: Event): void {
    const target = event.target;

    this.focusedElement = this.resolveScope(target)?.element;
  }

  private onFocusOut(event: Event): void {
    const target = event.target;

    const resolved = this.resolveScope(target);
    if (resolved && this.focusedElement === resolved.element) {
      this.focusedElement = undefined;
    }
  }

  private async show(
    registered: RegisteredScope,
    menuEvent: ContextMenuEvent,
  ): Promise<void> {
    const requestId = ++this.activeRequestId;
    const { scope } = registered;

    if (scope.shouldShow?.(menuEvent) === false) return;

    const actions = scope
      .getActions(menuEvent)
      .filter((action) => action.visible !== false);

    if (actions.length === 0) return;

    const bridge = this.bridge ?? window.contextMenu ?? window.electronContextMenu;
    if (!bridge) throw new Error("Missing context menu bridge.");

    const selected = await bridge.show({
      actions,
      x: Math.round(menuEvent.anchor.x),
      y: Math.round(menuEvent.anchor.y),
    });

    if (!selected || requestId !== this.activeRequestId) return;

    const action = actions.find((candidate) => candidate.id === selected.id);
    if (!action || action.enabled === false || action.type === "separator") return;

    await scope.runAction(action.id, menuEvent);
  }

  private resolveScope(start: EventTarget | null): RegisteredScope | undefined {
    let node = elementFromEventTarget(start);

    while (node) {
      if (node instanceof HTMLElement) {
        const scope = this.scopes.get(node);
        if (scope) return { element: node, scope };
      }

      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }

      const root = node.getRootNode();
      if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
        node = root.host;
        continue;
      }

      break;
    }

    return undefined;
  }

  private resolveScopeForEvent(event: MouseEvent): RegisteredScope | undefined {
    for (const target of event.composedPath()) {
      const candidate = this.resolveScope(target);
      if (candidate) return candidate;
    }

    return this.resolveScopeForPoint(event.clientX, event.clientY);
  }

  private resolveScopeForPoint(x: number, y: number): RegisteredScope | undefined {
    for (const target of document.elementsFromPoint(x, y)) {
      const candidate = this.resolveScope(target);
      if (candidate) return candidate;
    }

    return undefined;
  }

  private clearHoverTimer(): void {
    if (this.hoverTimer === undefined) return;
    window.clearTimeout(this.hoverTimer);
    this.hoverTimer = undefined;
  }

  private clearContextMenuFallbackTimer(): void {
    if (this.contextMenuFallbackTimer === undefined) return;
    window.clearTimeout(this.contextMenuFallbackTimer);
    this.contextMenuFallbackTimer = undefined;
  }
}

export function anchorForElement(element: HTMLElement): ContextMenuAnchor {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

function eventTargetElement(target: EventTarget | null): HTMLElement {
  const element = elementFromEventTarget(target);
  if (!element) return document.documentElement;
  if (element instanceof HTMLElement) return element;

  let node: Element | null = element.parentElement;
  while (node) {
    if (node instanceof HTMLElement) return node;
    node = node.parentElement;
  }

  return document.documentElement;
}

function elementFromEventTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (!(target instanceof Node)) return null;

  const parent = target.parentElement;
  if (parent) return parent;

  const root = target.getRootNode();
  if (root instanceof ShadowRoot && root.host instanceof Element) return root.host;

  return null;
}

let globalContextMenuController: ContextMenuController | undefined;

export function configureContextMenuManager(
  options: ContextMenuControllerOptions = {},
): ContextMenuController {
  globalContextMenuController?.dispose();
  globalContextMenuController = new ContextMenuController(options);
  return globalContextMenuController;
}

export function getContextMenuManager(
  options: ContextMenuControllerOptions = {},
): ContextMenuController {
  globalContextMenuController ??= new ContextMenuController(options);
  return globalContextMenuController;
}

export function disposeContextMenuManager(): void {
  globalContextMenuController?.dispose();
  globalContextMenuController = undefined;
}
