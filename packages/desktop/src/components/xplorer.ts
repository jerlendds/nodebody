import type {
  ContextMenuAction,
  ContextMenuEvent,
  Scope,
} from "@nodebody/ui";
import {
  chevronRightIcon,
  delegate,
  el,
  getContextMenuManager,
  render,
  signal,
} from "@nodebody/ui";

export interface XplorerNode {
  id: string;
  name: string;
  kind: "folder" | "file";
  children?: XplorerNode[];
}

export interface XplorerOptions {
  width?: number;
  minWidth?: number;
  side?: "left" | "right";
  nodes?: XplorerNode[];
  onResize?: (width: number) => void;
  onOpenFile?: (node: XplorerNode) => void;
  contextMenuContributors?: readonly XplorerContextMenuContribution[];
}

export interface XplorerContext {
  node: XplorerNode;
  event: ContextMenuEvent;
}

export interface XplorerContextMenuContribution {
  getActions(context: XplorerContext): readonly ContextMenuAction[];
  runAction(actionId: string, context: XplorerContext): void | Promise<void>;
}

let xplorerClipboard:
  | { mode: "copy" | "cut"; node: Pick<XplorerNode, "id" | "kind" | "name"> }
  | undefined;

const globalContextMenuContributors: XplorerContextMenuContribution[] = [];

export function registerXplorerContextMenuContribution(
  contribution: XplorerContextMenuContribution,
) {
  globalContextMenuContributors.push(contribution);
  return {
    dispose() {
      const index = globalContextMenuContributors.indexOf(contribution);
      if (index >= 0) globalContextMenuContributors.splice(index, 1);
    },
  };
}

export function createXplorer(options: XplorerOptions = {}, scope: Scope) {
  const minWidth = options.minWidth ?? 136;
  const root = el("aside", "nb-xplorer");
  root.style.setProperty(
    "--nb-xplorer-width",
    `${Math.max(minWidth, options.width ?? 244)}px`,
  );
  root.setAttribute("aria-label", "File explorer");
  root.setAttribute("aria-hidden", "true");

  const header = el("div", "nb-xplorer__header");
  header.append(el("span", "nb-xplorer__title", "File Xplorer"));

  const tree = el("div", "nb-xplorer__tree");
  tree.setAttribute("role", "tree");
  tree.tabIndex = 0;

  const nodes = signal<XplorerNode[]>(cloneNodes(options.nodes ?? []));
  const emptyText = signal("Please select a space");
  const expanded = new Set<string>();
  let draggedId: string | undefined;
  let loadVersion = 0;

  const renderTree = () => {
    const currentNodes = nodes.get();
    if (!currentNodes.length) {
      if (!emptyText.get()) {
        tree.replaceChildren();
        return;
      }
      const empty = el("p", "nb-xplorer__empty", emptyText.get());
      tree.replaceChildren(empty);
      return;
    }
    tree.replaceChildren(...currentNodes.map((node) => renderNode(node, 0)));
  };

  scope.add(nodes.subscribe(renderTree));
  scope.add(emptyText.subscribe(renderTree));

  scope.add(
    delegate(root, "click", "[data-xplorer-toggle]", (_event, target) => {
      const id = target.getAttribute("data-xplorer-toggle");
      if (!id) return;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      void persistExpanded();
      renderTree();
    }),
  );

  scope.add(
    delegate(root, "click", "[data-xplorer-row]", (_event, target) => {
      const id = target.getAttribute("data-xplorer-row");
      if (!id) return;
      const node = findNode(nodes.get(), id);
      if (!node || node.kind !== "file") return;
      options.onOpenFile?.(node);
    }),
  );

  scope.add(
    delegate(root, "keydown", "[data-xplorer-row]", (event, target) => {
      const keyboardEvent = event as KeyboardEvent;
      const id = target.getAttribute("data-xplorer-row");
      if (!id) return;
      const node = findNode(nodes.get(), id);
      if (!node || node.kind !== "folder") return;

      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        void persistExpanded();
        renderTree();
      }
    }),
  );

  scope.add(
    delegate(root, "dragstart", "[data-xplorer-row]", (event, target) => {
      const dragEvent = event as DragEvent;
      const id = target.getAttribute("data-xplorer-row");
      if (!id) return;
      draggedId = id;
      root.classList.add("is-dragging");
      target.classList.add("is-drag-source");
      dragEvent.dataTransfer?.setData("text/plain", id);
      dragEvent.dataTransfer?.setData("application/x-nodebody-xplorer", id);
      if (dragEvent.dataTransfer) dragEvent.dataTransfer.effectAllowed = "move";
    }),
  );

  scope.add(
    delegate(root, "dragend", "[data-xplorer-row]", (_event, target) => {
      draggedId = undefined;
      root.classList.remove("is-dragging");
      target.classList.remove("is-drag-source");
      clearDropTargets(root);
    }),
  );

  scope.add(
    delegate(root, "dragover", "[data-xplorer-folder]", (event, target) => {
      const dragEvent = event as DragEvent;
      if (!canDropInto(nodes.get(), draggedId, target)) return;
      dragEvent.preventDefault();
      if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = "move";
      markDropTarget(root, target);
    }),
  );

  scope.add(
    delegate(root, "dragleave", "[data-xplorer-folder]", (_event, target) => {
      target.classList.remove("is-drop-target");
    }),
  );

  scope.add(
    delegate(root, "drop", "[data-xplorer-folder]", (event, target) => {
      const dragEvent = event as DragEvent;
      if (!canDropInto(nodes.get(), draggedId, target)) return;
      dragEvent.preventDefault();
      const targetId = target.getAttribute("data-xplorer-folder");
      if (!draggedId || !targetId) return;
      expanded.add(targetId);
      void persistExpanded();
      nodes.set(moveNode(nodes.get(), draggedId, targetId));
      draggedId = undefined;
      root.classList.remove("is-dragging");
      clearDropTargets(root);
    }),
  );

  registerContextMenu();

  const onRootDragOver = (event: DragEvent) => {
    if (!draggedId) return;
    if (eventTargetElement(event)?.closest("[data-xplorer-row]")) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    root.classList.add("is-root-drop-target");
  };
  const onRootDragLeave = (event: DragEvent) => {
    if (root.contains(event.relatedTarget as Node | null)) return;
    root.classList.remove("is-root-drop-target");
  };
  const onRootDrop = (event: DragEvent) => {
    if (!draggedId) return;
    if (eventTargetElement(event)?.closest("[data-xplorer-row]")) return;
    event.preventDefault();
    nodes.set(moveNode(nodes.get(), draggedId));
    draggedId = undefined;
    root.classList.remove("is-dragging", "is-root-drop-target");
    clearDropTargets(root);
  };

  root.addEventListener("dragover", onRootDragOver);
  root.addEventListener("dragleave", onRootDragLeave);
  root.addEventListener("drop", onRootDrop);
  scope.add({
    dispose() {
      root.removeEventListener("dragover", onRootDragOver);
      root.removeEventListener("dragleave", onRootDragLeave);
      root.removeEventListener("drop", onRootDrop);
    },
  });

  const resizeHandle = el("div", "nb-xplorer__resize");
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.title = "Resize File Xplorer";
  bindResizeHandle(resizeHandle);

  root.append(header, tree, resizeHandle);
  renderTree();
  void loadSpaceItems();

  const onSpacesChanged = () => void loadSpaceItems();
  window.addEventListener("spaces:changed", onSpacesChanged);
  scope.add({
    dispose() {
      window.removeEventListener("spaces:changed", onSpacesChanged);
    },
  });

  return root;

  async function loadSpaceItems() {
    const version = ++loadVersion;
    let selected: Space | undefined;
    try {
      selected = await window.spaces.selected();
      if (version !== loadVersion) return;
    } catch {
      if (version !== loadVersion) return;
      expanded.clear();
      emptyText.set("Please select a space");
      nodes.set([]);
      return;
    }

    if (!selected) {
      expanded.clear();
      emptyText.set("Please select a space");
      nodes.set([]);
      return;
    }

    let items: XplorerNode[];
    try {
      items = await window.spaces.items();
    } catch {
      items = [];
    }
    if (version !== loadVersion) return;

    const folderIdSet = new Set(folderIds(items));
    expanded.clear();
    for (const id of selected.xplorerExpandedIds ?? []) {
      if (folderIdSet.has(id)) expanded.add(id);
    }
    emptyText.set("");
    nodes.set(items);
  }

  async function persistExpanded() {
    await window.spaces.setXplorerExpandedIds([...expanded]);
  }

  function registerContextMenu() {
    const manager = getContextMenuManager();
    let activeContext: XplorerContext | undefined;
    scope.add(
      manager.register(root, {
        shouldShow(event) {
          return Boolean(contextForEvent(event));
        },

        getActions(event) {
          const context = contextForEvent(event);
          activeContext = context;
          if (!context) return [];
          return contextMenuActions(context);
        },

        async runAction(actionId, event) {
          const context = activeContext ?? contextForEvent(event);
          activeContext = undefined;
          if (!context) return;

          if (isBaseContextMenuAction(actionId)) {
            await runBaseContextMenuAction(actionId, context.node);
            return;
          }

          for (const contribution of contextMenuContributors()) {
            const actions = contribution.getActions(context);
            if (!actions.some((action) => action.id === actionId)) continue;
            await contribution.runAction(actionId, context);
            return;
          }
        },
      }),
    );
  }

  function contextMenuActions(context: XplorerContext): ContextMenuAction[] {
    const baseActions = baseContextMenuActions(context.node);
    const contributedActions = contextMenuContributors()
      .flatMap((contribution) => [...contribution.getActions(context)])
      .filter((action) => action.visible !== false);

    if (!contributedActions.length) return baseActions;
    return [
      ...baseActions,
      { id: "xplorer.plugin.separator", type: "separator" as const },
      ...contributedActions,
    ];
  }

  function contextMenuContributors() {
    return [
      ...(options.contextMenuContributors ?? []),
      ...globalContextMenuContributors,
    ];
  }

  function contextForEvent(event: ContextMenuEvent): XplorerContext | undefined {
    const row = event.target.closest<HTMLElement>("[data-xplorer-row]");
    const id = row?.dataset.xplorerRow;
    if (!id) return undefined;
    const node = findNode(nodes.get(), id);
    return node ? { node, event } : undefined;
  }

  function baseContextMenuActions(node: XplorerNode): ContextMenuAction[] {
    if (node.kind === "file") {
      return [
        { id: "xplorer.open", label: "Open as tab" },
        { type: "separator", id: "xplorer.separator.open" },
        { id: "xplorer.cut", label: "Cut file" },
        { id: "xplorer.copy", label: "Copy file" },
        { type: "separator", id: "xplorer.separator.clipboard" },
        { id: "xplorer.copyPath", label: "Copy path" },
        { id: "xplorer.copyRelativePath", label: "Copy relative path" },
        { type: "separator", id: "xplorer.separator.manage" },
        { id: "xplorer.rename", label: "Rename file" },
        { id: "xplorer.delete", label: "Delete file" },
      ];
    }

    return [
      { id: "xplorer.newFile", label: "New file" },
      { id: "xplorer.newFolder", label: "New folder" },
      { type: "separator", id: "xplorer.separator.create" },
      { id: "xplorer.copy", label: "Copy" },
      { id: "xplorer.cut", label: "Cut" },
      { type: "separator", id: "xplorer.separator.clipboard" },
      { id: "xplorer.copyPath", label: "Copy path" },
      { id: "xplorer.copyRelativePath", label: "Copy relative path" },
      { type: "separator", id: "xplorer.separator.manage" },
      { id: "xplorer.rename", label: "Rename" },
      { id: "xplorer.delete", label: "Delete" },
    ];
  }

  async function runBaseContextMenuAction(actionId: string, node: XplorerNode) {
    switch (actionId) {
      case "xplorer.open":
        if (node.kind === "file") options.onOpenFile?.(node);
        return;
      case "xplorer.newFile":
        await createChild(node, "file");
        return;
      case "xplorer.newFolder":
        await createChild(node, "folder");
        return;
      case "xplorer.copy":
        await copyItem(node, "copy");
        return;
      case "xplorer.cut":
        await copyItem(node, "cut");
        return;
      case "xplorer.copyPath":
        await copyText(node.id);
        return;
      case "xplorer.copyRelativePath":
        await copyText(await window.spaces.relativeItemPath(node.id));
        return;
      case "xplorer.rename":
        await renameItem(node);
        return;
      case "xplorer.delete":
        await deleteItem(node);
        return;
    }
  }

  async function createChild(node: XplorerNode, kind: "file" | "folder") {
    if (node.kind !== "folder") return;
    const name = window.prompt(
      kind === "file" ? "New file name" : "New folder name",
      kind === "file" ? "Untitled.md" : "New folder",
    );
    if (name == null || !name.trim()) return;

    try {
      if (kind === "file") await window.spaces.createFile(node.id, name);
      else await window.spaces.createFolder(node.id, name);
      expanded.add(node.id);
      await persistExpanded();
      await loadSpaceItems();
    } catch (error) {
      showError(error);
    }
  }

  async function copyItem(node: XplorerNode, mode: "copy" | "cut") {
    xplorerClipboard = {
      mode,
      node: { id: node.id, kind: node.kind, name: node.name },
    };
    await copyText(node.id);
  }

  async function renameItem(node: XplorerNode) {
    const name = window.prompt("Rename", node.name);
    if (name == null || !name.trim() || name === node.name) return;

    try {
      await window.spaces.renameItem(node.id, name);
      await loadSpaceItems();
    } catch (error) {
      showError(error);
    }
  }

  async function deleteItem(node: XplorerNode) {
    // TODO: Implement modal for this confirm message, add checkbox to show again that can be toggled off, in settings can toggle it back on...
    const message =
      node.kind === "folder"
        ? `Move ${node.name} and its contents to Trash?`
        : `Move ${node.name} to Trash?`;

    try {
      removeNodeFromTree(node);
      await loadSpaceItems();
    } catch (error) {
      showError(error);
    }
  }

  function removeNodeFromTree(node: XplorerNode) {
    const [nextNodes] = removeNode(nodes.get(), node.id);
    for (const id of nodeAndDescendantIds(node)) expanded.delete(id);
    nodes.set(nextNodes);
  }

  function renderNode(node: XplorerNode, depth: number): HTMLElement {
    const item = el("div", "nb-xplorer__item");
    item.setAttribute("role", "none");

    const row = el("button", `nb-xplorer__row nb-xplorer__row--${node.kind}`);
    if (depth > 0) row.classList.add("nb-xplorer__row--nested");
    row.type = "button";
    row.draggable = true;
    row.dataset.xplorerRow = node.id;
    row.style.setProperty("--nb-xplorer-depth", String(depth));
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-label", node.name);
    row.tabIndex = 0;

    if (node.kind === "folder") {
      row.dataset.xplorerFolder = node.id;
      row.dataset.xplorerToggle = node.id;
      row.setAttribute("aria-expanded", String(expanded.has(node.id)));
    }

    if (node.kind === "folder") {
      const disclosure = el("span", "nb-xplorer__disclosure");
      render(disclosure, chevronRightIcon);
      row.append(disclosure);
    }
    row.append(el("span", "nb-xplorer__label", node.name));
    item.append(row);

    if (node.kind === "folder" && expanded.has(node.id)) {
      const group = el("div", "nb-xplorer__group");
      group.style.setProperty("--nb-xplorer-parent-depth", String(depth));
      group.setAttribute("role", "group");
      for (const child of node.children ?? []) {
        group.append(renderNode(child, depth + 1));
      }
      item.append(group);
    }

    return item;
  }

  function bindResizeHandle(handle: HTMLElement) {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;

      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      root.classList.add("is-resizing");

      const startX = event.clientX;
      const startWidth = root.getBoundingClientRect().width;
      const direction = options.side === "right" ? -1 : 1;

      const onPointerMove = (moveEvent: PointerEvent) => {
        const width = Math.max(
          minWidth,
          Math.round(startWidth + (moveEvent.clientX - startX) * direction),
        );
        root.style.setProperty("--nb-xplorer-width", `${width}px`);
        options.onResize?.(width);
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        root.classList.remove("is-resizing");
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    };

    handle.addEventListener("pointerdown", onPointerDown);
    scope.add({
      dispose() {
        handle.removeEventListener("pointerdown", onPointerDown);
      },
    });
  }
}

function isBaseContextMenuAction(actionId: string) {
  return baseContextMenuActionIds.has(actionId);
}

const baseContextMenuActionIds = new Set([
  "xplorer.open",
  "xplorer.newFile",
  "xplorer.newFolder",
  "xplorer.copy",
  "xplorer.cut",
  "xplorer.copyPath",
  "xplorer.copyRelativePath",
  "xplorer.rename",
  "xplorer.delete",
]);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    document.execCommand("copy");
  }
}

function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  window.alert(message);
}

function cloneNodes(nodes: XplorerNode[]): XplorerNode[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children ? cloneNodes(node.children) : undefined,
  }));
}

function folderIds(nodes: XplorerNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder" ? [node.id, ...folderIds(node.children ?? [])] : [],
  );
}

function findNode(nodes: XplorerNode[], id: string): XplorerNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children ?? [], id);
    if (child) return child;
  }
  return undefined;
}

function canDropInto(
  nodes: XplorerNode[],
  draggedId: string | undefined,
  target: Element,
) {
  const targetId = target.getAttribute("data-xplorer-folder");
  if (!draggedId || !targetId || draggedId === targetId) return false;
  const dragged = findNode(nodes, draggedId);
  const targetNode = findNode(nodes, targetId);
  if (!dragged || !targetNode || targetNode.kind !== "folder") return false;
  return !containsNode(dragged, targetId);
}

function containsNode(node: XplorerNode, id: string): boolean {
  return (
    node.children?.some(
      (child) => child.id === id || containsNode(child, id),
    ) ?? false
  );
}

function nodeAndDescendantIds(node: XplorerNode): string[] {
  return [
    node.id,
    ...(node.children?.flatMap((child) => nodeAndDescendantIds(child)) ?? []),
  ];
}

function moveNode(
  nodes: XplorerNode[],
  draggedId: string,
  targetFolderId?: string,
): XplorerNode[] {
  const [remaining, moved] = removeNode(cloneNodes(nodes), draggedId);
  if (!moved) return nodes;
  if (!targetFolderId) return [...remaining, moved];
  return insertNode(remaining, targetFolderId, moved);
}

function removeNode(
  nodes: XplorerNode[],
  id: string,
): [XplorerNode[], XplorerNode | undefined] {
  let removed: XplorerNode | undefined;
  const remaining: XplorerNode[] = [];

  for (const node of nodes) {
    if (node.id === id) {
      removed = node;
      continue;
    }

    if (node.children) {
      const [children, childRemoved] = removeNode(node.children, id);
      if (childRemoved) removed = childRemoved;
      remaining.push({ ...node, children });
    } else {
      remaining.push(node);
    }
  }

  return [remaining, removed];
}

function insertNode(
  nodes: XplorerNode[],
  targetFolderId: string,
  nodeToInsert: XplorerNode,
): XplorerNode[] {
  return nodes.map((node) => {
    if (node.id === targetFolderId && node.kind === "folder") {
      return {
        ...node,
        children: [...(node.children ?? []), nodeToInsert],
      };
    }
    if (!node.children) return node;
    return {
      ...node,
      children: insertNode(node.children, targetFolderId, nodeToInsert),
    };
  });
}

function markDropTarget(root: Element, target: Element) {
  root.classList.remove("is-root-drop-target");
  for (const item of root.querySelectorAll(".is-drop-target")) {
    item.classList.remove("is-drop-target");
  }
  target.classList.add("is-drop-target");
}

function clearDropTargets(root: Element) {
  root.classList.remove("is-root-drop-target");
  for (const item of root.querySelectorAll(".is-drop-target")) {
    item.classList.remove("is-drop-target");
  }
}

function eventTargetElement(event: Event) {
  return event.target instanceof Element ? event.target : null;
}
