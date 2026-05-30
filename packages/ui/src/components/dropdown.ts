import { el } from "../base/dom";
import type { Disposable, Scope } from "../base/disposable";

export type DropdownItem =
  | DropdownActionItem
  | DropdownSeparatorItem
  | DropdownSubmenuItem;

export interface DropdownActionItem {
  readonly id: string;
  readonly label: string;
  readonly type?: "action";
  readonly accelerator?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
}

export interface DropdownSeparatorItem {
  readonly type: "separator";
}

export interface DropdownSubmenuItem {
  readonly id: string;
  readonly label: string;
  readonly type: "submenu";
  readonly enabled?: boolean;
  readonly items: readonly DropdownItem[];
}

export interface DropdownSelectEventDetail {
  readonly id: string;
  readonly item: DropdownActionItem;
}

export interface DropdownOptions {
  readonly trigger: HTMLElement;
  readonly items: readonly DropdownItem[];
  readonly scope: Scope;
  readonly ariaLabel?: string;
  readonly align?: "start" | "end";
}

export interface DropdownController extends Disposable {
  readonly element: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
}

/// Attach a lightweight menu-style dropdown to an existing trigger.
export function attachDropdown(
  options: DropdownOptions,
): DropdownController {
  const controller = new DropdownControllerImpl(options);
  options.scope.add(controller);
  return controller;
}

class DropdownControllerImpl implements DropdownController {
  readonly element = el("div", "nb-dropdown");

  private readonly trigger: HTMLElement;
  private readonly align: "start" | "end";
  private openState = false;
  private disposed = false;

  private readonly onTriggerPointerDownBound =
    this.onTriggerPointerDown.bind(this);
  private readonly onTriggerKeyDownBound = this.onTriggerKeyDown.bind(this);
  private readonly onDocumentPointerDownBound =
    this.onDocumentPointerDown.bind(this);
  private readonly onDocumentKeyDownBound = this.onDocumentKeyDown.bind(this);
  private readonly onMenuClickBound = this.onMenuClick.bind(this);
  private readonly onWindowChangeBound = this.onWindowChange.bind(this);

  constructor(options: DropdownOptions) {
    this.trigger = options.trigger;
    this.align = options.align ?? "start";
    this.element.classList.toggle(
      "nb-dropdown--align-end",
      this.align === "end",
    );
    this.element.setAttribute("role", "menu");
    this.element.setAttribute("aria-label", options.ariaLabel ?? "Menu");
    this.element.tabIndex = -1;
    this.element.style.position = "fixed";
    this.element.style.zIndex = "2147483647";
    this.element.append(renderItems(options.items));

    this.trigger.setAttribute("aria-haspopup", "menu");
    this.trigger.setAttribute("aria-expanded", "false");

    this.trigger.addEventListener("pointerdown", this.onTriggerPointerDownBound);
    this.trigger.addEventListener("keydown", this.onTriggerKeyDownBound);
    this.element.addEventListener("click", this.onMenuClickBound);
    document.addEventListener("pointerdown", this.onDocumentPointerDownBound, {
      capture: true,
    });
    document.addEventListener("keydown", this.onDocumentKeyDownBound, {
      capture: true,
    });
    window.addEventListener("resize", this.onWindowChangeBound, {
      passive: true,
    });
    window.addEventListener("scroll", this.onWindowChangeBound, {
      capture: true,
      passive: true,
    });
  }

  isOpen() {
    return this.openState;
  }

  open() {
    if (this.openState || this.disposed) return;
    this.openState = true;
    document.body.append(this.element);
    this.position();
    this.trigger.setAttribute("aria-expanded", "true");
    this.trigger.classList.add("is-open");
  }

  close() {
    if (!this.openState) return;
    this.openState = false;
    this.element.remove();
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.classList.remove("is-open");
  }

  toggle() {
    if (this.openState) this.close();
    else this.open();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    this.trigger.removeEventListener(
      "pointerdown",
      this.onTriggerPointerDownBound,
    );
    this.trigger.removeEventListener("keydown", this.onTriggerKeyDownBound);
    this.element.removeEventListener("click", this.onMenuClickBound);
    document.removeEventListener(
      "pointerdown",
      this.onDocumentPointerDownBound,
      true,
    );
    document.removeEventListener("keydown", this.onDocumentKeyDownBound, true);
    window.removeEventListener("resize", this.onWindowChangeBound);
    window.removeEventListener("scroll", this.onWindowChangeBound, true);
    this.element.remove();
  }

  private onTriggerPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.toggle();
  }

  private onTriggerKeyDown(event: KeyboardEvent) {
    if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.open();
    focusFirstItem(this.element);
  }

  private onDocumentPointerDown(event: PointerEvent) {
    if (!this.openState) return;
    const path = event.composedPath();
    if (path.includes(this.trigger) || path.includes(this.element)) return;
    this.close();
  }

  private onDocumentKeyDown(event: KeyboardEvent) {
    if (!this.openState) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      this.trigger.focus();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(this.element, event.key === "ArrowDown" ? 1 : -1);
    }
  }

  private onWindowChange() {
    if (this.openState) this.position();
  }

  private onMenuClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest<HTMLButtonElement>("[data-dropdown-item]");
    if (!button || button.disabled) return;

    const id = button.dataset.dropdownItem;
    if (!id) return;

    const detail = actionDetails.get(button);
    if (!detail) return;

    event.preventDefault();
    event.stopPropagation();
    this.trigger.dispatchEvent(
      new CustomEvent<DropdownSelectEventDetail>("dropdown:select", {
        bubbles: true,
        detail,
      }),
    );
    this.close();
  }

  private position() {
    const rect = this.trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const { innerWidth, innerHeight } = window;
    const menuRect = this.element.getBoundingClientRect();
    const preferredLeft =
      this.align === "end" ? rect.right - menuRect.width : rect.left;
    const preferredTop = rect.bottom + gap;

    const left = clamp(
      preferredLeft,
      margin,
      innerWidth - menuRect.width - margin,
    );
    const top = clamp(
      preferredTop,
      margin,
      innerHeight - menuRect.height - margin,
    );

    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
  }
}

const actionDetails = new WeakMap<HTMLElement, DropdownSelectEventDetail>();

function renderItems(items: readonly DropdownItem[]) {
  const list = el("div", "nb-dropdown__items");

  for (const item of items) {
    if (item.type === "separator") {
      const separator = el("div", "nb-dropdown__separator");
      separator.setAttribute("role", "separator");
      list.append(separator);
      continue;
    }

    if (item.type === "submenu") {
      list.append(renderSubmenu(item));
      continue;
    }

    list.append(renderAction(item));
  }

  return list;
}

function renderAction(item: DropdownActionItem) {
  const button = el("button", "nb-dropdown__item");
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.dataset.dropdownItem = item.id;
  button.disabled = item.enabled === false;
  actionDetails.set(button, { id: item.id, item });

  const label = el("span", "nb-dropdown__label", item.label);
  button.append(label);

  if (item.accelerator) {
    button.append(
      el("span", "nb-dropdown__accelerator", item.accelerator),
    );
  }

  return button;
}

function renderSubmenu(item: DropdownSubmenuItem) {
  const wrapper = el("div", "nb-dropdown__submenu-host");
  const button = el(
    "button",
    "nb-dropdown__item nb-dropdown__item--submenu",
  );
  button.type = "button";
  button.disabled = item.enabled === false;
  button.setAttribute("role", "menuitem");
  button.setAttribute("aria-haspopup", "menu");

  button.append(el("span", "nb-dropdown__label", item.label));
  button.append(
    el("span", "nb-dropdown__submenu-arrow", ">"),
  );
  wrapper.append(button);

  const submenu = el("div", "nb-dropdown nb-dropdown__submenu");
  submenu.setAttribute("role", "menu");
  submenu.append(renderItems(item.items));
  wrapper.append(submenu);

  return wrapper;
}

function enabledItems(menu: HTMLElement) {
  return [
    ...menu.querySelectorAll<HTMLButtonElement>("[data-dropdown-item]"),
  ].filter((item) => !item.disabled && !item.closest(".nb-dropdown__submenu"));
}

function focusFirstItem(menu: HTMLElement) {
  enabledItems(menu)[0]?.focus();
}

function moveFocus(menu: HTMLElement, delta: number) {
  const items = enabledItems(menu);
  if (!items.length) return;

  const active = document.activeElement;
  const current =
    active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
  const next = current < 0 ? 0 : (current + delta + items.length) % items.length;
  items[next]?.focus();
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function dropdownSeparator(): DropdownSeparatorItem {
  return { type: "separator" };
}
