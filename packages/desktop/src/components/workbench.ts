import type {
  PaneModel,
  Component,
  ComponentThemeInput,
  DropdownSelectEventDetail,
} from "@nodebody/ui";
import {
  Scope,
  signal,
  mount,
  delegate,
  createPaneGroup,
  disposable,
  getContextMenuManager,
  getHotkeyManager,
  graphFolderIcon,
  applyComponentTheme,
} from "@nodebody/ui";
import { welcomeView } from "../pages/welcome";
import type { ActivityItem, SidebarSide } from "./sidebar";
import { createSidebar } from "./sidebar";
import { createToolbar } from "./toolbar";
import { statusBar } from "./statusbar";
import { createXplorer } from "./xplorer";

/// Options used to assemble the default workbench shell.
export interface WorkbenchOptions {
  sidebarSide?: SidebarSide;
  sidebarWidth?: number;
  xplorerWidth?: number;
  activities?: ActivityItem[];
  panes?: PaneModel[];
  theme?: ComponentThemeInput;
}

const defaultActivities = [
  {
    id: "xplorer",
    label: "File Xplorer",
    icon: graphFolderIcon,
    tooltip: "File Xplorer",
  },
];

const defaultPanes = [
  {
    id: "main",
    tabs: [
      {
        id: "welcome",
        title: "Welcome",
        resource: "nodebody://welcome",
        active: true,
        view: welcomeView,
      },
    ],
  },
];

/// Create the root Nodebody workbench shell from declarative sidebar
/// and pane options.
export function workbench(options: WorkbenchOptions = {}): Component {
  return {
    mount(root: Element, scope: Scope) {
      const side = options.sidebarSide ?? "left";
      const activeActivity = signal("home");
      const isXplorerOpen = signal(false);
      const panes = signal<PaneModel[]>(
        clonePanes(options.panes ?? defaultPanes),
      );
      root.className = `nb-workbench nb-workbench--sidebar-${side}`;
      applyComponentTheme(root as HTMLElement, {
        ...options.theme,
        ...(options.sidebarWidth == null
          ? {}
          : { sidebarWidth: `${options.sidebarWidth}px` }),
      });
      (root as HTMLElement).style.setProperty(
        "--nb-xplorer-width",
        `${options.xplorerWidth ?? 244}px`,
      );
      const toolbar = createToolbar(scope);
      const xplorer = createXplorer({ width: options.xplorerWidth }, scope);
      const sidebar = createSidebar(
        {
          side,
          width: options.sidebarWidth ?? 36,
          items: options.activities ?? defaultActivities,
        },
        scope,
      );
      const paneMount = document.createElement("div");
      paneMount.className = "nb-pane-mount";
      root.replaceChildren(toolbar, sidebar, xplorer, paneMount);
      scope.add(mount(statusBar, root));
      let paneScope = scope.add(new Scope());

      scope.add(
        panes.subscribe(() => {
          paneScope.dispose();
          paneScope = scope.add(new Scope());
          const paneGroup = createPaneGroup(panes.get(), paneScope, {
            addTab: (paneId) => panes.set(addEmptyTab(panes.get(), paneId)),
            activateTab: (paneId, tabId) =>
              panes.set(activateTab(panes.get(), paneId, tabId)),
            closeTab: (paneId, tabId) =>
              panes.set(closeTab(panes.get(), paneId, tabId)),
          });
          paneMount.replaceChildren(paneGroup);
          registerPaneContextMenus(paneGroup, paneScope);
        }),
      );

      scope.add(
        delegate(root, "click", "[data-activity]", (_event, target) => {
          const activity = target.getAttribute("data-activity") ?? "graph";
          if (activity === "xplorer") {
            const nextOpen = !isXplorerOpen.get();
            isXplorerOpen.set(nextOpen);
            activeActivity.set(nextOpen ? activity : "home");
            return;
          }
          activeActivity.set(activity);
        }),
      );

      scope.add(
        delegate(root, "click", "[data-window-action]", (_event, target) => {
          // Electron-only window controls are optional so the same UI
          // package remains previewable in a plain browser.
          const action = target.getAttribute("data-window-action");
          if (action === "minimize") window.win.minimize();
          if (action === "maximize") window.win.maximize();
          if (action === "close") closeWindow();
        }),
      );

      const onDropdownSelect = (event: Event) => {
        const detail = (event as CustomEvent<DropdownSelectEventDetail>).detail;
        if (detail?.id === "file.exit") closeWindow();
      };
      root.addEventListener(
        "dropdown:select",
        onDropdownSelect as EventListener,
      );
      scope.add(
        disposable(() => {
          root.removeEventListener(
            "dropdown:select",
            onDropdownSelect as EventListener,
          );
        }),
      );

      scope.add(
        getHotkeyManager().registerGlobal({
          id: "workbench.file.exit",
          key: "Ctrl-Q",
          priority: 1_000,
          allowInEditable: true,
          run: closeWindow,
        }),
      );

      scope.add(
        activeActivity.subscribe(() => {
          updateActivityButtons(
            root,
            activeActivity.get(),
            isXplorerOpen.get(),
          );
        }),
      );

      scope.add(
        isXplorerOpen.subscribe(() => {
          const open = isXplorerOpen.get();
          root.classList.toggle("is-xplorer-open", open);
          xplorer.classList.toggle("is-open", open);
          xplorer.setAttribute("aria-hidden", String(!open));
          updateActivityButtons(root, activeActivity.get(), open);
        }),
      );
    },
  };
}

function closeWindow() {
  window.win.close();
}

function updateActivityButtons(
  root: ParentNode,
  activeActivity: string,
  isXplorerOpen: boolean,
) {
  for (const item of root.querySelectorAll("[data-activity]")) {
    const activity = item.getAttribute("data-activity");
    item.classList.toggle(
      "is-active",
      activity === "xplorer" ? isXplorerOpen : activity === activeActivity,
    );
  }
}

function registerPaneContextMenus(root: ParentNode, scope: Scope) {
  const manager = getContextMenuManager();
  for (const surface of root.querySelectorAll<HTMLElement>(".nb-pane__surface")) {
    scope.add(
      manager.register(surface, {
        getActions() {
          const modifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";

          return [
            {
              id: "pane.copy",
              label: "Copy",
              accelerator: `${modifier}+C`,
              enabled: true,
            },
            {
              id: "pane.cut",
              label: "Cut",
              accelerator: `${modifier}+X`,
              enabled: true,
            },
            {
              id: "pane.paste",
              label: "Paste",
              accelerator: `${modifier}+V`,
              enabled: true,
            },
          ];
        },

        async runAction(actionId) {
          switch (actionId) {
            case "pane.copy":
              if (!document.execCommand("copy")) {
                const text = selectedTextIn(surface);
                if (text) await copyText(text);
              }
              return;
            case "pane.cut":
              document.execCommand("cut");
              return;
            case "pane.paste":
              document.execCommand("paste");
              return;
          }
        },
      }),
    );

    const show = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void manager.showForElement(
        surface,
        "mouse",
        { x: event.clientX, y: event.clientY },
        event,
      );
    };
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      show(event);
    };

    surface.addEventListener("contextmenu", onContextMenu, {
      capture: true,
      passive: false,
    });
    scope.add(
      disposable(() => {
        surface.removeEventListener("contextmenu", onContextMenu, true);
      }),
    );
  }
}

function selectedTextIn(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return "";

  const text = selection.toString();
  if (!text) return "";

  for (let i = 0; i < selection.rangeCount; i += 1) {
    try {
      const range = selection.getRangeAt(i);
      if (range.intersectsNode(element)) return text;
    } catch {
      continue;
    }
  }

  return "";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    document.execCommand("copy");
  }
}

function clonePanes(panes: PaneModel[]) {
  return panes.map((pane) => ({
    ...pane,
    tabs: pane.tabs.map((tab) => ({ ...tab })),
  }));
}

function addEmptyTab(panes: PaneModel[], paneId: string) {
  return panes.map((pane) => {
    if (pane.id !== paneId) return pane;
    const id = `empty-${Date.now().toString(36)}`;
    return {
      ...pane,
      tabs: pane.tabs
        .map((tab) => ({ ...tab, active: false }))
        .concat({
          id,
          title: "New empty tab",
          resource: `nodebody://empty/${id}`,
          active: true,
        }),
    };
  });
}

function activateTab(panes: PaneModel[], paneId: string, tabId: string) {
  return panes.map((pane) =>
    pane.id === paneId
      ? {
          ...pane,
          tabs: pane.tabs.map((tab) => ({ ...tab, active: tab.id === tabId })),
        }
      : pane,
  );
}

function closeTab(panes: PaneModel[], paneId: string, tabId: string) {
  return panes.map((pane) => {
    if (pane.id !== paneId) return pane;
    const closingIndex = pane.tabs.findIndex((tab) => tab.id === tabId);
    if (closingIndex < 0) return pane;
    const closingActive = pane.tabs[closingIndex].active;
    const tabs = pane.tabs
      .filter((tab) => tab.id !== tabId)
      .map((tab) => ({ ...tab }));
    if (!tabs.length) {
      const id = `empty-${Date.now().toString(36)}`;
      tabs.push({
        id,
        title: "New empty tab",
        resource: `nodebody://empty/${id}`,
        active: true,
      });
    } else if (closingActive || !tabs.some((tab) => tab.active)) {
      const nextIndex = Math.min(closingIndex, tabs.length - 1);
      tabs[nextIndex] = { ...tabs[nextIndex], active: true };
    }
    return { ...pane, tabs };
  });
}
