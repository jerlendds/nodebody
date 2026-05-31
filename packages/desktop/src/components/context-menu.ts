import type { ContextMenuAction, ContextMenuBridge } from "@nodebody/ui";

export function createDesktopContextMenuBridge(): ContextMenuBridge {
  let activeDismiss: (() => void) | undefined;

  return {
    show(payload) {
      activeDismiss?.();

      return new Promise((resolve) => {
        const menu = document.createElement("div");
        menu.className = "nb-context-menu";
        menu.setAttribute("role", "menu");
        menu.tabIndex = -1;

        let armDismissTimer: number | undefined;
        let resolved = false;
        const cleanup = () => {
          if (armDismissTimer !== undefined) {
            window.clearTimeout(armDismissTimer);
            armDismissTimer = undefined;
          }
          if (activeDismiss === onDismiss) activeDismiss = undefined;
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
          window.removeEventListener("resize", onDismiss, true);
          window.removeEventListener("blur", onDismiss, true);
          menu.remove();
        };
        const finish = (id: string | null) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(id ? { id } : null);
        };
        const onDismiss = () => finish(null);
        const onPointerDown = (event: PointerEvent) => {
          if (!menu.contains(event.target as Node)) finish(null);
        };
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.preventDefault();
            finish(null);
            return;
          }

          const items = enabledItems(menu);
          const currentIndex = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );

          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const nextIndex =
              currentIndex < 0
                ? 0
                : (currentIndex + direction + items.length) % items.length;
            items[nextIndex]?.focus();
            return;
          }

          if (event.key === "Enter" || event.key === " ") {
            const current = document.activeElement as HTMLElement | null;
            const id = current?.dataset.contextMenuAction;
            if (!id) return;
            event.preventDefault();
            finish(id);
          }
        };

        for (const action of payload.actions) {
          menu.append(createMenuItem(action, finish));
        }

        document.body.append(menu);
        positionMenu(menu, payload.x, payload.y);
        menu.style.visibility = "";
        activeDismiss = onDismiss;

        armDismissTimer = window.setTimeout(() => {
          armDismissTimer = undefined;
          if (resolved) return;
          document.addEventListener("pointerdown", onPointerDown, true);
          document.addEventListener("keydown", onKeyDown, true);
          window.addEventListener("resize", onDismiss, true);
          window.addEventListener("blur", onDismiss, true);
        }, 0);

        requestAnimationFrame(() => {
          enabledItems(menu)[0]?.focus();
        });
      });
    },
  };
}

function createMenuItem(
  action: ContextMenuAction,
  select: (id: string | null) => void,
) {
  if (action.type === "separator") {
    const separator = document.createElement("div");
    separator.className = "nb-context-menu__separator";
    separator.setAttribute("role", "separator");
    return separator;
  }

  const item = document.createElement("button");
  item.type = "button";
  item.className = "nb-context-menu__item";
  item.dataset.contextMenuAction = action.id;
  item.disabled = action.enabled === false;
  item.setAttribute("role", "menuitem");

  const label = document.createElement("span");
  label.className = "nb-context-menu__label";
  label.textContent = action.label ?? action.id;
  item.append(label);

  if (action.accelerator) {
    const accelerator = document.createElement("span");
    accelerator.className = "nb-context-menu__accelerator";
    accelerator.textContent = action.accelerator;
    item.append(accelerator);
  }

  item.addEventListener("click", () => {
    if (!item.disabled) select(action.id);
  });

  return item;
}

function enabledItems(menu: HTMLElement) {
  return [
    ...menu.querySelectorAll<HTMLButtonElement>(
      ".nb-context-menu__item:not(:disabled)",
    ),
  ];
}

function positionMenu(menu: HTMLElement, x: number, y: number) {
  const gap = 4;
  const margin = 8;
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  const leftHalf = x <= innerWidth / 2;
  const topHalf = y <= innerHeight / 2;

  const preferredLeft = leftHalf ? x + gap : x - rect.width - gap;
  const preferredTop = topHalf ? y + gap : y - rect.height - gap;

  const left = clamp(preferredLeft, margin, innerWidth - rect.width - margin);
  const top = clamp(preferredTop, margin, innerHeight - rect.height - margin);

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
