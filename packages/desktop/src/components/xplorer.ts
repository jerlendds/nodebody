import type { Scope } from "@nodebody/ui";
import { chevronRightIcon, delegate, el, render, signal } from "@nodebody/ui";

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
}

const defaultNodes: XplorerNode[] = [
  {
    id: "graph",
    name: "graph",
    kind: "folder",
    children: [
      {
        id: "graph/nodes",
        name: "nodes",
        kind: "folder",
        children: [
          { id: "graph/nodes/source.nb", name: "source.nb", kind: "file" },
          { id: "graph/nodes/sink.nb", name: "sink.nb", kind: "file" },
        ],
      },
      { id: "graph/edges.nb", name: "edges.nb", kind: "file" },
    ],
  },
  {
    id: "spaces",
    name: "spaces",
    kind: "folder",
    children: [
      { id: "spaces/default.nb", name: "default.nb", kind: "file" },
      { id: "spaces/scratch.nb", name: "scratch.nb", kind: "file" },
    ],
  },
  { id: "readme.md", name: "readme.md", kind: "file" },
];

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

  const nodes = signal<XplorerNode[]>(
    cloneNodes(options.nodes ?? defaultNodes),
  );
  const expanded = new Set<string>(folderIds(nodes.get()));
  let draggedId: string | undefined;

  const renderTree = () => {
    tree.replaceChildren(...nodes.get().map((node) => renderNode(node, 0)));
  };

  scope.add(nodes.subscribe(renderTree));

  scope.add(
    delegate(root, "click", "[data-xplorer-toggle]", (_event, target) => {
      const id = target.getAttribute("data-xplorer-toggle");
      if (!id) return;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      renderTree();
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
      nodes.set(moveNode(nodes.get(), draggedId, targetId));
      draggedId = undefined;
      root.classList.remove("is-dragging");
      clearDropTargets(root);
    }),
  );

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
  return root;

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
