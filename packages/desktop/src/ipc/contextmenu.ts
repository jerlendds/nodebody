import {
  BrowserWindow,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
} from "electron";
import type { ContextMenuAction } from "@interfacez/ui";

export function registerContextMenuIpc() {
  ipcMain.handle(
    "context-menu:show",
    async (
      event,
      payload: {
        readonly actions: readonly ContextMenuAction[];
        readonly x: number;
        readonly y: number;
      },
    ): Promise<{ readonly id: string } | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window.isDestroyed()) return null;

      return new Promise((resolve) => {
        let resolved = false;
        const items: MenuItemConstructorOptions[] = payload.actions.map(
          (action) => {
            if (action.type === "separator") return { type: "separator" };

            return {
              id: action.id,
              label: action.label ?? "",
              enabled: action.enabled !== false,
              visible: action.visible !== false,
              checked: !!action.checked,
              type: action.type ?? "normal",
              accelerator: action.accelerator,
              click: () => {
                resolved = true;
                resolve({ id: action.id });
              },
            };
          },
        );

        Menu.buildFromTemplate(items).popup({
          window,
          x: Math.round(payload.x),
          y: Math.round(payload.y),
          callback: () => {
            if (!resolved) resolve(null);
          },
        });
      });
    },
  );

  return;
}
