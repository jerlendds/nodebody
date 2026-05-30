import type { Disposable } from "./disposable";

export type HotkeyPlatform = "mac" | "windows" | "linux";
export type HotkeyScopeKind = "focused" | "hovered" | "active" | "global";

export interface HotkeyContext {
  event: KeyboardEvent;
  target: EventTarget | null;
  scope: HotkeyScope | null;
  sequence: string;
}

export interface HotkeyBinding {
  id: string;
  key: string | readonly string[];
  run: (ctx: HotkeyContext) => void | boolean | Promise<void | boolean>;
  when?: (ctx: HotkeyContext) => boolean;
  priority?: number;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  allowInEditable?: boolean;
}

export interface HotkeyScopeOptions {
  id?: string;
  kinds?: readonly HotkeyScopeKind[];
  priority?: number;
}

export interface HotkeyManagerOptions {
  platform?: HotkeyPlatform;
  chordTimeoutMs?: number;
  ignoreRepeat?: boolean;
}

type NormalizedBinding = HotkeyBinding & {
  sequence: readonly string[];
  sort: number;
  order: number;
};

const IS_MAC =
  typeof navigator !== "undefined" &&
  /\b(Mac|iPhone|iPad|iPod)\b/i.test(navigator.platform);

function defaultPlatform(): HotkeyPlatform {
  if (IS_MAC) return "mac";
  if (typeof navigator !== "undefined" && /Linux/i.test(navigator.platform)) {
    return "linux";
  }
  return "windows";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const el = target as HTMLElement;
  const tag = el.tagName;

  return (
    el.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    Boolean(el.closest("[contenteditable='true']"))
  );
}

function normalizeKeyName(key: string): string {
  switch (key) {
    case " ":
    case "Spacebar":
      return "Space";
    case "Esc":
      return "Escape";
    case "ArrowLeft":
    case "Left":
      return "Left";
    case "ArrowRight":
    case "Right":
      return "Right";
    case "ArrowUp":
    case "Up":
      return "Up";
    case "ArrowDown":
    case "Down":
      return "Down";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

function splitCombo(combo: string): string[] {
  return combo
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeCombo(combo: string, platform: HotkeyPlatform): string {
  const parts = splitCombo(combo);
  const mods = new Set<string>();
  let key = "";

  for (const raw of parts) {
    const part = raw.toLowerCase();

    if (part === "mod") mods.add(platform === "mac" ? "Meta" : "Ctrl");
    else if (part === "cmd" || part === "command" || part === "meta") {
      mods.add("Meta");
    } else if (part === "ctrl" || part === "control") mods.add("Ctrl");
    else if (part === "alt" || part === "option") mods.add("Alt");
    else if (part === "shift") mods.add("Shift");
    else key = normalizeKeyName(raw);
  }

  return ["Ctrl", "Alt", "Shift", "Meta"]
    .filter((mod) => mods.has(mod))
    .concat(key ? [key] : [])
    .join("-");
}

function eventCombo(event: KeyboardEvent): string {
  const mods: string[] = [];
  if (event.ctrlKey) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (event.metaKey) mods.push("Meta");

  const key = normalizeKeyName(event.key);
  if (!["Control", "Alt", "Shift", "Meta"].includes(key)) mods.push(key);

  return mods.join("-");
}

function normalizeSequence(
  key: string | readonly string[],
  platform: HotkeyPlatform,
): readonly string[] {
  return (Array.isArray(key) ? key : [key]).map((part) =>
    normalizeCombo(part, platform),
  );
}

function composedElements(event: Event): Element[] {
  const path = event.composedPath?.() ?? [];
  const out: Element[] = [];

  for (const node of path) {
    if (node instanceof Element) out.push(node);
  }

  return out;
}

export class HotkeyScope implements Disposable {
  readonly id: string;
  readonly element: HTMLElement;
  readonly kinds: readonly HotkeyScopeKind[];
  readonly priority: number;

  private readonly manager: HotkeyManager;
  private readonly bindings = new Map<string, NormalizedBinding[]>();
  private disposed = false;

  constructor(
    manager: HotkeyManager,
    element: HTMLElement,
    options: HotkeyScopeOptions = {},
  ) {
    this.manager = manager;
    this.element = element;
    this.id = options.id ?? `scope:${HotkeyScope.nextId++}`;
    this.kinds = options.kinds ?? ["focused", "hovered", "active"];
    this.priority = options.priority ?? 0;
  }

  register(binding: HotkeyBinding): Disposable {
    if (this.disposed) {
      throw new Error("Cannot register on disposed hotkey scope.");
    }

    const normalized = this.manager.normalizeBinding(binding);
    const first = normalized.sequence[0];
    const bucket = this.bindings.get(first) ?? [];

    bucket.push(normalized);
    bucket.sort((a, b) => b.sort - a.sort);
    this.bindings.set(first, bucket);

    return {
      dispose: () => {
        const current = this.bindings.get(first);
        if (!current) return;

        const index = current.indexOf(normalized);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) this.bindings.delete(first);
      },
    };
  }

  candidates(firstCombo: string): readonly NormalizedBinding[] {
    return this.bindings.get(firstCombo) ?? [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bindings.clear();
    this.manager.unregisterScope(this);
  }

  private static nextId = 1;
}

export class HotkeyManager implements Disposable {
  readonly platform: HotkeyPlatform;

  private readonly chordTimeoutMs: number;
  private readonly ignoreRepeat: boolean;
  private readonly root: Document | HTMLElement;
  private readonly scopesByElement = new WeakMap<Element, HotkeyScope>();
  private readonly globalScope: HotkeyScope;

  private focusedScope: HotkeyScope | null = null;
  private activeScope: HotkeyScope | null = null;
  private hoveredScopes: HotkeyScope[] = [];
  private sequence: string[] = [];
  private sequenceTimer: number | null = null;
  private order = 0;
  private disposed = false;

  constructor(
    root: Document | HTMLElement = document,
    options: HotkeyManagerOptions = {},
  ) {
    this.root = root;
    this.platform = options.platform ?? defaultPlatform();
    this.chordTimeoutMs = options.chordTimeoutMs ?? 900;
    this.ignoreRepeat = options.ignoreRepeat ?? true;

    const rootElement =
      root instanceof Document
        ? root.documentElement
        : root.ownerDocument.documentElement;
    this.globalScope = new HotkeyScope(this, rootElement, {
      id: "global",
      kinds: ["global"],
      priority: -1_000_000,
    });

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onFocusIn = this.onFocusIn.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);

    root.addEventListener("keydown", this.onKeyDown as EventListener, true);
    root.addEventListener("focusin", this.onFocusIn as EventListener, true);
    root.addEventListener("pointermove", this.onPointerMove as EventListener, {
      capture: true,
      passive: true,
    });
    root.addEventListener("pointerdown", this.onPointerDown as EventListener, {
      capture: true,
      passive: true,
    });
  }

  scope(element: HTMLElement, options: HotkeyScopeOptions = {}): HotkeyScope {
    const existing = this.scopesByElement.get(element);
    if (existing) return existing;

    const scope = new HotkeyScope(this, element, options);
    this.scopesByElement.set(element, scope);
    return scope;
  }

  registerGlobal(binding: HotkeyBinding): Disposable {
    return this.globalScope.register(binding);
  }

  unregisterScope(scope: HotkeyScope): void {
    this.scopesByElement.delete(scope.element);

    if (this.focusedScope === scope) this.focusedScope = null;
    if (this.activeScope === scope) this.activeScope = null;
    this.hoveredScopes = this.hoveredScopes.filter((item) => item !== scope);
  }

  normalizeBinding(binding: HotkeyBinding): NormalizedBinding {
    const sequence = normalizeSequence(binding.key, this.platform);
    const priority = binding.priority ?? 0;

    return {
      ...binding,
      sequence,
      priority,
      preventDefault: binding.preventDefault ?? true,
      stopPropagation: binding.stopPropagation ?? false,
      sort: priority * 10_000 - this.order,
      order: this.order++,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.root.removeEventListener(
      "keydown",
      this.onKeyDown as EventListener,
      true,
    );
    this.root.removeEventListener(
      "focusin",
      this.onFocusIn as EventListener,
      true,
    );
    this.root.removeEventListener(
      "pointermove",
      this.onPointerMove as EventListener,
      true,
    );
    this.root.removeEventListener(
      "pointerdown",
      this.onPointerDown as EventListener,
      true,
    );

    this.clearSequence();
  }

  private onFocusIn(event: FocusEvent): void {
    this.focusedScope = this.firstScopeFromEvent(event, "focused");
  }

  private onPointerMove(event: PointerEvent): void {
    const scopes: HotkeyScope[] = [];

    for (const element of composedElements(event)) {
      const scope = this.scopesByElement.get(element);
      if (scope?.kinds.includes("hovered")) scopes.push(scope);
    }

    scopes.sort((a, b) => b.priority - a.priority);
    this.hoveredScopes = scopes;
  }

  private onPointerDown(event: PointerEvent): void {
    this.activeScope = this.firstScopeFromEvent(event, "active");
  }

  private firstScopeFromEvent(
    event: Event,
    kind: HotkeyScopeKind,
  ): HotkeyScope | null {
    let best: HotkeyScope | null = null;

    for (const element of composedElements(event)) {
      const scope = this.scopesByElement.get(element);
      if (!scope?.kinds.includes(kind)) continue;
      if (!best || scope.priority > best.priority) best = scope;
    }

    return best;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.ignoreRepeat && event.repeat) return;

    const combo = eventCombo(event);
    if (!combo) return;

    const current = this.sequence.length
      ? [...this.sequence, combo]
      : [combo];
    const first = current[0];
    const scopes = this.resolveScopes(event);
    let hasPrefix = false;

    for (const scope of scopes) {
      const candidates = scope.candidates(first);
      if (!candidates.length) continue;

      for (const binding of candidates) {
        if (!this.sequenceMatches(binding.sequence, current)) continue;

        const exact = binding.sequence.length === current.length;
        if (!exact) {
          hasPrefix = true;
          continue;
        }

        if (!binding.allowInEditable && isEditableTarget(event.target)) {
          continue;
        }

        const ctx: HotkeyContext = {
          event,
          target: event.target,
          scope,
          sequence: current.join(" "),
        };
        if (binding.when && !binding.when(ctx)) continue;

        if (binding.preventDefault) event.preventDefault();
        if (binding.stopPropagation) event.stopPropagation();

        void binding.run(ctx);
        this.clearSequence();
        return;
      }
    }

    if (hasPrefix) {
      this.sequence = current;
      this.armSequenceTimer();
      event.preventDefault();
      return;
    }

    this.clearSequence();
  }

  private resolveScopes(event: KeyboardEvent): HotkeyScope[] {
    const fromTarget: HotkeyScope[] = [];

    for (const element of composedElements(event)) {
      const scope = this.scopesByElement.get(element);
      if (scope?.kinds.includes("focused")) fromTarget.push(scope);
    }

    const scopes = new Set<HotkeyScope>();

    for (const scope of fromTarget) scopes.add(scope);
    if (this.focusedScope) scopes.add(this.focusedScope);
    if (this.activeScope) scopes.add(this.activeScope);
    for (const scope of this.hoveredScopes) scopes.add(scope);
    scopes.add(this.globalScope);

    return [...scopes].sort((a, b) => b.priority - a.priority);
  }

  private sequenceMatches(
    expected: readonly string[],
    actual: readonly string[],
  ): boolean {
    if (actual.length > expected.length) return false;

    for (let index = 0; index < actual.length; index++) {
      if (expected[index] !== actual[index]) return false;
    }

    return true;
  }

  private armSequenceTimer(): void {
    if (this.sequenceTimer !== null) window.clearTimeout(this.sequenceTimer);

    this.sequenceTimer = window.setTimeout(() => {
      this.clearSequence();
    }, this.chordTimeoutMs);
  }

  private clearSequence(): void {
    this.sequence.length = 0;

    if (this.sequenceTimer !== null) {
      window.clearTimeout(this.sequenceTimer);
      this.sequenceTimer = null;
    }
  }
}

let sharedHotkeyManager: HotkeyManager | undefined;

export function getHotkeyManager(
  options?: HotkeyManagerOptions,
): HotkeyManager {
  if (!sharedHotkeyManager) {
    sharedHotkeyManager = new HotkeyManager(document, options);
  }
  return sharedHotkeyManager;
}
