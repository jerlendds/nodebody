import type { PaneModel, Component, ComponentThemeInput } from "@nodebody/ui";
import {
  Scope,
  signal,
  mount,
  delegate,
  createPaneGroup,
  getContextMenuManager,
  graphFolderIcon,
  applyComponentTheme,
} from "@nodebody/ui";
import { welcomeView } from "../pages/welcome";
import type { ActivityItem, SidebarSide } from "./sidebar";
import { createSidebar } from "./sidebar";
import { createToolbar } from "./toolbar";
import { statusBar } from "./statusbar";

/// Options used to assemble the default workbench shell.
export interface WorkbenchOptions {
  sidebarSide?: SidebarSide;
  sidebarWidth?: number;
  activities?: ActivityItem[];
  panes?: PaneModel[];
  theme?: ComponentThemeInput;
}

const defaultActivities = [
  {
    id: "home",
    label: "Home",
    icon: graphFolderIcon,
    tooltip: "Nodebody's home",
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
      const toolbar = createToolbar(scope);
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
      root.replaceChildren(toolbar, sidebar, paneMount);
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
          registerPaneSurfaceContextMenus(paneGroup, paneScope);
        }),
      );

      scope.add(
        delegate(root, "click", "[data-activity]", (_event, target) => {
          activeActivity.set(target.getAttribute("data-activity") ?? "graph");
        }),
      );

      scope.add(
        delegate(root, "click", "[data-window-action]", (_event, target) => {
          // Electron-only window controls are optional so the same UI
          // package remains previewable in a plain browser.
          const action = target.getAttribute("data-window-action");
          if (action === "minimize") window.win.minimize();
          if (action === "maximize") window.win.maximize();
          if (action === "close") window.win.close();
        }),
      );

      scope.add(
        activeActivity.subscribe(() => {
          for (const item of root.querySelectorAll("[data-activity]")) {
            item.classList.toggle(
              "is-active",
              item.getAttribute("data-activity") === activeActivity.get(),
            );
          }
        }),
      );
    },
  };
}

function registerPaneSurfaceContextMenus(root: ParentNode, scope: Scope) {
  const manager = getContextMenuManager();
  for (const surface of root.querySelectorAll<HTMLElement>(
    ".nb-pane__surface",
  )) {
    scope.add(
      manager.register(surface, {
        getActions() {
          const hasSelection = selectedTextIn(surface).length > 0;
          return [
            {
              id: "copy",
              label: "Copy",
              accelerator: navigator.platform.includes("Mac")
                ? "Cmd+C"
                : "Ctrl+C",
              enabled: hasSelection,
            },
          ];
        },

        async runAction(actionId) {
          if (actionId !== "copy") return;
          const text = selectedTextIn(surface);
          if (!text) return;
          await copyText(text);
        },
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
    const range = selection.getRangeAt(i);
    if (range.intersectsNode(element)) return text;
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
