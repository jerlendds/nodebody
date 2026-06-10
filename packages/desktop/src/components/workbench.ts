import type {
  PaneModel,
  Component,
  ComponentThemeInput,
  DropdownSelectEventDetail,
  LayoutDocument,
  LayoutNodeId,
  LayoutTransaction,
  StackNode,
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
  folderIcon,
  folderOpenIcon,
  applyComponentTheme,
  el,
  render,
} from "@nodebody/ui";
import {
  createMarkdownEditor,
  gfmMarkdownOptions,
} from "@nodebody/editor-markdown";
import { shouldShowWelcomeOnStartup, welcomeView } from "../pages/welcome";
import type { ActivityItem, SidebarSide } from "./sidebar";
import { createSidebar } from "./sidebar";
import { createToolbar } from "./toolbar";
import { statusBar } from "./statusbar";
import { createXplorer } from "./xplorer";
import { createWebFileEditor } from "./web-file-editor";
import { createWebProjectPreview } from "./web-project-preview";

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
    label: "Xplorer",
    icon: folderIcon,
    tooltip: "Space Xplorer",
  },
];

const minXplorerWidth = 136;

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
      const xplorerWidth = signal(
        Math.max(minXplorerWidth, options.xplorerWidth ?? 244),
      );
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
        `${xplorerWidth.get()}px`,
      );
      const toolbar = createToolbar(scope);
      const xplorer = createXplorer(
        {
          width: xplorerWidth.get(),
          minWidth: minXplorerWidth,
          side,
          onResize(width) {
            xplorerWidth.set(width);
          },
          onOpenFile(node) {
            void openSpaceFile(node.id, node.name);
          },
          onOpenWebFolder(node, webOptions) {
            openWebProjectFolder(node.id, node.name, webOptions);
          },
          onOpenWebFile(node) {
            void openWebProjectFile(node.id, node.name);
          },
        },
        scope,
      );
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
      const savingTabIds = new Set<string>();
      const setTabSavingState = (tabId: string, saving: boolean) => {
        if (saving) savingTabIds.add(tabId);
        else savingTabIds.delete(tabId);
        applyTabSavingStates(root, savingTabIds);
      };
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
          applyTabSavingStates(root, savingTabIds);
        }),
      );

      scope.add(
        delegate(root, "click", "[data-activity]", (_event, target) => {
          const activity = target.getAttribute("data-activity") ?? "graph";
          if (activity === "xplorer") {
            const nextOpen = !isXplorerOpen.get();
            isXplorerOpen.set(nextOpen);
            void window.spaces.setXplorerOpen(nextOpen);
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

      scope.add(
        xplorerWidth.subscribe(() => {
          (root as HTMLElement).style.setProperty(
            "--nb-xplorer-width",
            `${xplorerWidth.get()}px`,
          );
        }),
      );

      void restoreXplorerOpenState();

      async function openSpaceFile(filePath: string, title: string) {
        if (isMarkdownFile(title)) {
          await openMarkdownFile(filePath, title);
          return;
        }

        if (isImageFile(title)) {
          await openPreviewFile(filePath, title, {
            kind: "image",
            tabId: imageTabId(filePath),
            createView: createImageViewer,
          });
          return;
        }

        if (isVideoFile(title)) {
          await openPreviewFile(filePath, title, {
            kind: "video",
            tabId: videoTabId(filePath),
            createView: createVideoViewer,
          });
          return;
        }
      }

      async function openMarkdownFile(filePath: string, title: string) {
        const currentLayout = layout.get();
        const stackId = findActiveStackId(currentLayout);
        if (!stackId) return;

        const tabId = markdownTabId(filePath);
        const existing = currentLayout.tabs[tabId];
        if (existing) {
          const existingStackId =
            findStackContainingTab(currentLayout, tabId) ?? stackId;
          layout.set(
            applyLayoutTransaction(currentLayout, {
              type: "activateTab",
              stackId: existingStackId,
              tabId,
            }),
          );
          return;
        }

        const initialText = await window.spaces.readItem(filePath);
        const pageId = `page:${tabId}`;
        const contentId = `content:${tabId}`;

        layout.set(
          applyLayoutTransaction(layout.get(), {
            type: "openTab",
            stackId,
            tab: {
              id: tabId,
              title,
              resource: `file://${filePath}`,
              page: pageId,
              closable: true,
            },
            page: {
              kind: "content",
              id: pageId,
              contentId,
            },
            content: {
              id: contentId,
              kind: "markdown",
              resource: `file://${filePath}`,
              view: createAutosavingMarkdownEditor({
                filePath,
                title,
                initialText,
                setSaving(saving) {
                  setTabSavingState(tabId, saving);
                },
              }),
            },
            activate: true,
          }),
        );
      }

      async function openPreviewFile(
        filePath: string,
        title: string,
        options: PreviewOpenOptions,
      ) {
        const currentLayout = layout.get();
        const stackId = findActiveStackId(currentLayout);
        if (!stackId) return;

        const tabId = options.tabId;
        const existing = currentLayout.tabs[tabId];
        if (existing) {
          const existingStackId =
            findStackContainingTab(currentLayout, tabId) ?? stackId;
          layout.set(
            applyLayoutTransaction(currentLayout, {
              type: "activateTab",
              stackId: existingStackId,
              tabId,
            }),
          );
          return;
        }

        const dataUrl = await window.spaces.readItemDataUrl(filePath);
        const pageId = `page:${tabId}`;
        const contentId = `content:${tabId}`;

        layout.set(
          applyLayoutTransaction(layout.get(), {
            type: "openTab",
            stackId,
            tab: {
              id: tabId,
              title,
              resource: `file://${filePath}`,
              page: pageId,
              closable: true,
            },
            page: {
              kind: "content",
              id: pageId,
              contentId,
            },
            content: {
              id: contentId,
              kind: options.kind,
              resource: `file://${filePath}`,
              view: options.createView({ title, src: dataUrl }),
            },
            activate: true,
          }),
        );
      }

      function openWebProjectFolder(
        folderPath: string,
        title: string,
        options: { openIfMissing?: boolean } = {},
      ) {
        const currentLayout = layout.get();
        const stackId = findActiveStackId(currentLayout);
        if (!stackId) return;

        const tabId = webProjectTabId(folderPath);
        const existing = currentLayout.tabs[tabId];
        if (existing) {
          if (options.openIfMissing) return;
          const existingStackId =
            findStackContainingTab(currentLayout, tabId) ?? stackId;
          layout.set(
            applyLayoutTransaction(currentLayout, {
              type: "activateTab",
              stackId: existingStackId,
              tabId,
            }),
          );
          return;
        }

        const pageId = `page:${tabId}`;
        const contentId = `content:${tabId}`;

        layout.set(
          applyLayoutTransaction(layout.get(), {
            type: "openTab",
            stackId,
            tab: {
              id: tabId,
              title,
              resource: `file://${folderPath}`,
              page: pageId,
              closable: true,
            },
            page: {
              kind: "content",
              id: pageId,
              contentId,
            },
            content: {
              id: contentId,
              kind: "web",
              resource: `file://${folderPath}`,
              view: createWebProjectPreview({
                rootPath: folderPath,
                onOpenSource(source) {
                  void openWebProjectFile(
                    pathFromVirtual(folderPath, source.file),
                    source.file.split("/").pop() || source.file,
                    { line: source.line, column: source.column },
                  );
                },
              }),
            },
            activate: true,
          }),
        );
      }

      async function openWebProjectFile(
        filePath: string,
        title: string,
        reveal?: { line: number; column: number },
      ) {
        const currentLayout = layout.get();
        const stackId = findActiveStackId(currentLayout);
        if (!stackId) return;

        const tabId = webFileTabId(filePath);
        const existing = currentLayout.tabs[tabId];
        if (existing) {
          const existingStackId =
            findStackContainingTab(currentLayout, tabId) ?? stackId;
          layout.set(
            applyLayoutTransaction(currentLayout, {
              type: "activateTab",
              stackId: existingStackId,
              tabId,
            }),
          );
          if (reveal) dispatchWebFileReveal(filePath, reveal);
          return;
        }

        const initialText = await window.spaces.readItem(filePath);
        const pageId = `page:${tabId}`;
        const contentId = `content:${tabId}`;

        layout.set(
          applyLayoutTransaction(layout.get(), {
            type: "openTab",
            stackId,
            tab: {
              id: tabId,
              title,
              resource: `file://${filePath}`,
              page: pageId,
              closable: true,
            },
            page: {
              kind: "content",
              id: pageId,
              contentId,
            },
            content: {
              id: contentId,
              kind: "web",
              resource: `file://${filePath}`,
              view: createWebFileEditor({
                filePath,
                title,
                initialText,
                reveal,
                setSaving(saving) {
                  setTabSavingState(tabId, saving);
                },
              }),
            },
            activate: true,
          }),
        );
      }

      async function restoreXplorerOpenState() {
        const selected = await window.spaces.selected();
        if (!selected?.xplorerOpen) return;
        isXplorerOpen.set(true);
        activeActivity.set("xplorer");
      }
    },
  };
}

function pathFromVirtual(rootPath: string, virtualPath: string) {
  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const relative = virtualPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${root}/${relative}`;
}

function dispatchWebFileReveal(
  filePath: string,
  reveal: { line: number; column: number },
) {
  window.dispatchEvent(
    new CustomEvent("nb:web-file-reveal", {
      detail: { filePath, ...reveal },
    }),
  );
}

function closeWindow() {
  window.win.close();
}

interface AutosavingMarkdownOptions {
  filePath: string;
  title: string;
  initialText: string;
  setSaving: (saving: boolean) => void;
}

function createAutosavingMarkdownEditor(
  options: AutosavingMarkdownOptions,
): Component {
  return {
    mount(root, scope) {
      let saveTimer: number | undefined;
      let saving = false;
      let pendingText: string | undefined;
      let lastSavedText = options.initialText;

      const flush = () => {
        if (saving) return;
        const value = pendingText;
        pendingText = undefined;
        if (value === undefined || value === lastSavedText) {
          options.setSaving(false);
          return;
        }

        saving = true;
        void window.spaces
          .writeItem(options.filePath, value)
          .then(() => {
            lastSavedText = value;
          })
          .finally(() => {
            saving = false;
            if (pendingText !== undefined && pendingText !== lastSavedText) {
              saveTimer = window.setTimeout(flush, 0);
            } else {
              pendingText = undefined;
              options.setSaving(false);
            }
          });
      };

      const editor = createMarkdownEditor({
        document: {
          id: options.filePath,
          title: options.title,
          resource: `file://${options.filePath}`,
          initialText: options.initialText,
        },
        markdown: gfmMarkdownOptions(),
        onChange(event) {
          pendingText = event.value;
          options.setSaving(true);
          if (saveTimer !== undefined) window.clearTimeout(saveTimer);
          saveTimer = window.setTimeout(flush, 600);
        },
      });

      scope.add(mount(editor, root));
      scope.add(
        disposable(() => {
          if (saveTimer !== undefined) window.clearTimeout(saveTimer);
          options.setSaving(false);
        }),
      );
    },
  };
}

function applyTabSavingStates(root: ParentNode, savingTabIds: Set<string>) {
  for (const tab of root.querySelectorAll<HTMLElement>("[data-tab]")) {
    const saving = savingTabIds.has(tab.dataset.tab ?? "");
    if (saving) tab.dataset.saving = "true";
    else delete tab.dataset.saving;
    const close = tab.querySelector<HTMLButtonElement>(".nb-tab__close");
    close?.setAttribute(
      "aria-label",
      saving ? "Saving" : `Close ${tabTitle(tab)}`,
    );
    close?.setAttribute("title", saving ? "Saving" : `Close ${tabTitle(tab)}`);
  }
}

function tabTitle(tab: HTMLElement) {
  return tab.querySelector(".nb-tab__label")?.textContent?.trim() ?? "tab";
}

function markdownTabId(filePath: string) {
  return `markdown:${encodeURIComponent(filePath)}`;
}

function imageTabId(filePath: string) {
  return `image:${encodeURIComponent(filePath)}`;
}

function videoTabId(filePath: string) {
  return `video:${encodeURIComponent(filePath)}`;
}

function webProjectTabId(filePath: string) {
  return `web-project:${encodeURIComponent(filePath)}`;
}

function webFileTabId(filePath: string) {
  return `web-file:${encodeURIComponent(filePath)}`;
}

function isMarkdownFile(fileName: string) {
  return fileName.toLowerCase().endsWith(".md");
}

function isImageFile(fileName: string) {
  return imageFileExtensions.has(fileExtension(fileName));
}

function isVideoFile(fileName: string) {
  return videoFileExtensions.has(fileExtension(fileName));
}

function fileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

const imageFileExtensions = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jfif",
  ".jpeg",
  ".jpg",
  ".pjpeg",
  ".pjp",
  ".png",
  ".svg",
  ".webp",
]);

const videoFileExtensions = new Set([
  ".3g2",
  ".3gp",
  ".avi",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".ogm",
  ".ogv",
  ".webm",
  ".wmv",
]);

interface PreviewOpenOptions {
  kind: "image" | "video";
  tabId: string;
  createView: (options: MediaViewerOptions) => Component;
}

interface MediaViewerOptions {
  title: string;
  src: string;
}

function createImageViewer(options: MediaViewerOptions): Component {
  return {
    mount(root) {
      const viewer = el("div", "nb-image-viewer");
      const image = el("img", "nb-image-viewer__image") as HTMLImageElement;
      image.src = options.src;
      image.alt = options.title;
      image.draggable = false;
      viewer.append(image);
      root.replaceChildren(viewer);
    },
  };
}

function createVideoViewer(options: MediaViewerOptions): Component {
  return {
    mount(root) {
      const viewer = el("div", "nb-video-viewer");
      const video = el("video", "nb-video-viewer__video") as HTMLVideoElement;
      video.src = options.src;
      video.controls = true;
      video.preload = "metadata";
      video.title = options.title;
      viewer.append(video);
      root.replaceChildren(viewer);
    },
  };
}

function findActiveStackId(doc: LayoutDocument): LayoutNodeId | undefined {
  const fromRoot = findFirstStack(doc, doc.root);
  return fromRoot?.id;
}

function findStackContainingTab(
  doc: LayoutDocument,
  tabId: string,
): LayoutNodeId | undefined {
  for (const node of Object.values(doc.nodes)) {
    if (node.kind === "stack" && node.tabIds.includes(tabId)) return node.id;
  }
  return undefined;
}

function findFirstStack(
  doc: LayoutDocument,
  nodeId: LayoutNodeId,
): StackNode | undefined {
  const node = doc.nodes[nodeId];
  if (!node) return undefined;
  if (node.kind === "stack") return node;
  if (node.kind === "content") return undefined;

  for (const childId of node.childIds) {
    const stack = findFirstStack(doc, childId);
    if (stack) return stack;
  }

  return undefined;
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
    if (activity === "xplorer") {
      const icon = item.querySelector("[data-activity-icon='xplorer']");
      if (icon) render(icon, isXplorerOpen ? folderOpenIcon : folderIcon);
    }
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
  if (
    panes.some((pane) =>
      pane.tabs.some(
        (tab) => tab.id === "welcome" || tab.resource === "nodebody://welcome",
      ),
    )
  ) {
    return panes;
  }

  const welcomeTab = {
    id: "welcome",
    title: "Welcome",
    resource: "nodebody://welcome",
    active: false,
    view: welcomeView,
  };

  if (!panes.length) return [{ id: "main", tabs: [welcomeTab] }];

  const [first, ...rest] = panes;
  return [
    {
      ...first,
      tabs: [welcomeTab, ...first.tabs],
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
