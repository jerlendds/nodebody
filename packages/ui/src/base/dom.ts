/// Find the first element matching `selector` below `root`.
export const $ = <T extends Element = Element>(
  selector: string,
  root: ParentNode = document,
) => root.querySelector<T>(selector);

/// Find all elements matching `selector` below `root`.
export const $$ = <T extends Element = Element>(
  selector: string,
  root: ParentNode = document,
) => [...root.querySelectorAll<T>(selector)];

/// Get, set, or remove an attribute. Passing `null` removes the
/// attribute, while omitting `value` reads it.
export function attr(el: Element, name: string, value?: unknown) {
  if (value === undefined) return el.getAttribute(name);
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, String(value));
}

/// Apply a shallow set of inline style properties.
export function css(
  el: HTMLElement | SVGElement,
  styles: Partial<CSSStyleDeclaration>,
) {
  Object.assign(el.style, styles);
}

/// Create an HTML element with optional class and text content.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// Reconcile a frequently-changing keyed list without replacing stable
/// child nodes. The returned map should be reused for later updates.
export function reconcile<T>(
  parent: Element,
  cache: Map<string, Element>,
  items: readonly T[],
  key: (item: T) => string,
  render: (item: T, existing?: Element) => Element,
) {
  const used = new Set<string>();
  let anchor: ChildNode | null = null;

  for (const item of items) {
    const id = key(item);
    const existing = cache.get(id);
    const node = render(item, existing);
    used.add(id);
    cache.set(id, node);
    if (node !== anchor) parent.insertBefore(node, anchor);
    anchor = node.nextSibling;
  }

  for (const [id, node] of cache) {
    if (used.has(id)) continue;
    node.remove();
    cache.delete(id);
  }

  return cache;
}
