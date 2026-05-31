import type {
  PaneModel,
  Component,
  ComponentThemeInput,
  DropdownSelectEventDetail,
  LayoutDocument,
  LayoutTransaction,
} from "@nodebody/ui";
import {
  Scope,
  signal,
  mount,
  delegate,
  LayoutRenderer,
  layoutFromLegacyPanes,
  applyLayoutTransaction,
  disposable,
  getContextMenuManager,
  getHotkeyManager,
  graphFolderIcon,
  applyComponentTheme,
} from "@nodebody/ui";
import { shouldShowWelcomeOnStartup, welcomeView } from "../pages/welcome";
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
  layout?: LayoutDocument;
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

function defaultPanes(): PaneModel[] {
  return [
    {
      id: "main",
      tabs: [
        shouldShowWelcomeOnStartup()
          ? {
              id: "welcome",
              title: "Welcome",
              resource: "nodebody://welcome",
              active: true,
              view: welcomeView,
            }
          : {
              id: "empty-start",
              title: "New empty tab",
              resource: "nodebody://empty/start",
              active: true,
            },
      ],
    },
  ];
}

/// Create the root Nodebody workbench shell from declarative sidebar
/// and pane options.
export function workbench(options: WorkbenchOptions = {}): Component {
  return {
    mount(root: Element, scope: Scope) {
      const side = options.sidebarSide ?? "left";
      const activeActivity = signal("home");
      const isXplorerOpen = signal(false);
      const layout = signal<LayoutDocument>(
        options.layout ??
          layoutFromLegacyPanes(
            withStartupWelcome(clonePanes(options.panes ?? defaultPanes())),
          ),
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
      const layoutRenderer = scope.add(
        new LayoutRenderer({
          addTab: (stackId) => layout.set(addEmptyTab(layout.get(), stackId)),
          dispatch: (tx) =>
            layout.set(applyLayoutTransaction(layout.get(), tx)),
          resolveContent: (content) => content.view,
        }),
      );
      paneMount.replaceChildren(layoutRenderer.element);
      registerLayoutContextMenus(layoutRenderer.element, scope, (tx) => {
        layout.set(applyLayoutTransaction(layout.get(), tx));
      });

      scope.add(
        layout.subscribe(() => {
          layoutRenderer.update(layout.get());
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

function registerLayoutContextMenus(
  root: HTMLElement,
  scope: Scope,
  dispatchLayout: (tx: LayoutTransaction) => void,
) {
  const manager = getContextMenuManager();
  scope.add(
    manager.register(root, {
      shouldShow(event) {
        return Boolean(event.target.closest("[data-content]"));
      },

      getActions() {
        const modifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";

        return [
          {
            id: "layout.splitRight",
            label: "Split Right",
            enabled: true,
          },
          {
            id: "layout.splitDown",
            label: "Split Down",
            enabled: true,
          },
          { type: "separator", id: "layout.separator.edit" },
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

      async runAction(actionId, event) {
        const surface = event.target.closest<HTMLElement>("[data-content]");
        if (!surface) return;
        const nodeId =
          surface.dataset.splitTarget ??
          surface.closest<HTMLElement>("[data-stack]")?.dataset.stack ??
          surface.dataset.layoutNode;

        switch (actionId) {
          case "layout.splitRight":
            if (nodeId) dispatchLayout(createEmptySplit(nodeId, "horizontal"));
            return;
          case "layout.splitDown":
            if (nodeId) dispatchLayout(createEmptySplit(nodeId, "vertical"));
            return;
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
}

function createEmptySplit(
  targetNodeId: string,
  axis: "horizontal" | "vertical",
): LayoutTransaction {
  const id = `empty-${Date.now().toString(36)}`;
  return {
    type: "splitNode",
    targetNodeId,
    axis,
    position: "after",
    newNode: {
      kind: "stack",
      id: `stack:${id}`,
      tabIds: [id],
      activeTabId: id,
    },
    nodes: [
      {
        kind: "content",
        id: `page:${id}`,
        contentId: `content:${id}`,
      },
    ],
    tabs: [
      {
        id,
        title: "New empty tab",
        resource: `nodebody://empty/${id}`,
        page: `page:${id}`,
        closable: true,
      },
    ],
    contents: [
      {
        id: `content:${id}`,
        kind: "empty",
        resource: `nodebody://empty/${id}`,
      },
    ],
  };
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

function withStartupWelcome(panes: PaneModel[]) {
  if (!shouldShowWelcomeOnStartup()) return panes;

  const welcomeTab = {
    id: "welcome",
    title: "Welcome",
    resource: "nodebody://welcome",
    active: true,
    view: welcomeView,
  };

  if (!panes.length) return [{ id: "main", tabs: [welcomeTab] }];

  const [first, ...rest] = panes;
  const tabs = first.tabs
    .filter((tab) => tab.id !== welcomeTab.id)
    .map((tab) => ({ ...tab, active: false }));

  return [
    {
      ...first,
      tabs: [welcomeTab, ...tabs],
    },
    ...rest,
  ];
}

function addEmptyTab(doc: LayoutDocument, stackId: string) {
  const stack = doc.nodes[stackId];
  if (stack?.kind !== "stack") return doc;

  const id = `empty-${Date.now().toString(36)}`;
  return applyLayoutTransaction(doc, {
    type: "openTab",
    stackId,
    tab: {
      id,
      title: "New empty tab",
      resource: `nodebody://empty/${id}`,
      page: `page:${id}`,
      closable: true,
    },
    page: {
      kind: "content",
      id: `page:${id}`,
      contentId: `content:${id}`,
    },
    content: {
      id: `content:${id}`,
      kind: "empty",
      resource: `nodebody://empty/${id}`,
    },
    activate: true,
  });
}
