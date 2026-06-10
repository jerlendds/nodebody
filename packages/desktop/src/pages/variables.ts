import type { Component } from "@interfacez/ui";
import {
  attachTooltip,
  borderRadiusIcon,
  chevronRightIcon,
  disposable,
  el,
  html,
  paintIcon,
  render,
  shadowsIcon,
  spacingHorizontalIcon,
  typographyIcon,
  variableIcon,
} from "@interfacez/ui";
import type { TrustedHtml } from "@interfacez/ui";

type TokenKind = "color" | "spacing" | "typography" | "radius" | "shadow";
type TokenTier = "Primitive" | "Semantic" | "Component";
type VariablesPageId = "all" | TokenKind;

interface DesignToken {
  name: string;
  value: string;
  tier: TokenTier;
  role: string;
  preview?: string;
}

interface TokenGroup {
  id: TokenKind;
  title: string;
  description: string;
  tokens: DesignToken[];
}

interface DesignTokenDocument {
  version: 1;
  groups: TokenGroup[];
}

interface VariablesTab {
  id: VariablesPageId;
  label: string;
  icon?: TrustedHtml;
}

const variablesTabs: VariablesTab[] = [
  { id: "all", label: "All", icon: variableIcon },
  { id: "color", label: "Colors", icon: paintIcon },
  { id: "spacing", label: "Spacing", icon: spacingHorizontalIcon },
  { id: "typography", label: "Typography", icon: typographyIcon },
  { id: "radius", label: "Radius", icon: borderRadiusIcon },
  { id: "shadow", label: "Shadows", icon: shadowsIcon },
];

const defaultDesignTokens: DesignTokenDocument = {
  version: 1,
  groups: [
    {
      id: "color",
      title: "Colors",
      description:
        "Named color values for brand, surfaces, borders, text, and interaction states.",
      tokens: [
        {
          name: "color.accent.primary",
          value: "var(--nb-accent)",
          tier: "Semantic",
          role: "Primary interactive foreground and focus color.",
          preview: "#2a84f8",
        },
        {
          name: "color.accent.soft",
          value: "var(--nb-accent-soft)",
          tier: "Semantic",
          role: "Hover and secondary interactive emphasis.",
          preview: "#2ea1ff",
        },
        {
          name: "color.border.default",
          value: "var(--nb-border)",
          tier: "Semantic",
          role: "Workbench dividers and panel edges.",
          preview: "#0a0c13",
        },
        {
          name: "color.primitive.blue.500",
          value: "#2a84f8",
          tier: "Primitive",
          role: "Base blue used by the accent scale.",
          preview: "#2a84f8",
        },
        {
          name: "color.primitive.gray.500",
          value: "#747891",
          tier: "Primitive",
          role: "Base muted foreground value.",
          preview: "#747891",
        },
        {
          name: "color.surface.canvas",
          value: "var(--nb-background)",
          tier: "Semantic",
          role: "Primary application background.",
          preview: "#11131d",
        },
        {
          name: "color.surface.panel",
          value: "var(--nb-surface)",
          tier: "Semantic",
          role: "Panel, editor, and tab content surface.",
          preview: "#141622",
        },
        {
          name: "color.text.default",
          value: "var(--nb-foreground)",
          tier: "Semantic",
          role: "Default readable interface text.",
          preview: "#a9aecb",
        },
      ],
    },
    {
      id: "spacing",
      title: "Spacing",
      description:
        "Reusable CSS length values for padding, gaps, margins, rails, and panel rhythm.",
      tokens: [
        {
          name: "space.100",
          value: "4px",
          tier: "Primitive",
          role: "Tight icon and control gaps.",
        },
        {
          name: "space.150",
          value: "6px",
          tier: "Primitive",
          role: "Compact button padding.",
        },
        {
          name: "space.200",
          value: "8px",
          tier: "Primitive",
          role: "Small groups and form fields.",
        },
        {
          name: "space.300",
          value: "12px",
          tier: "Primitive",
          role: "Standard inline and card padding.",
        },
        {
          name: "space.400",
          value: "16px",
          tier: "Primitive",
          role: "Section spacing and panel insets.",
        },
        {
          name: "space.component.sidebar-width",
          value: "var(--nb-sidebar-width)",
          tier: "Component",
          role: "Fixed activity rail width.",
        },
        {
          name: "space.component.toolbar-height",
          value: "var(--nb-toolbar-height)",
          tier: "Component",
          role: "Top toolbar height.",
        },
      ],
    },
    {
      id: "typography",
      title: "Typography",
      description:
        "Font family, size, weight, and line-height decisions used across app surfaces.",
      tokens: [
        {
          name: "font.family.ui",
          value: "Lato, system-ui, sans-serif",
          tier: "Primitive",
          role: "Primary interface family.",
        },
        {
          name: "font.size.body",
          value: "13px",
          tier: "Semantic",
          role: "Dense default interface copy.",
        },
        {
          name: "font.size.caption",
          value: "12px",
          tier: "Semantic",
          role: "Metadata, help text, and secondary labels.",
        },
        {
          name: "font.size.heading",
          value: "20px",
          tier: "Semantic",
          role: "Page and card headings.",
        },
        {
          name: "font.weight.medium",
          value: "500",
          tier: "Primitive",
          role: "Command and label emphasis.",
        },
        {
          name: "line-height.body",
          value: "1.45",
          tier: "Primitive",
          role: "Readable body text rhythm.",
        },
      ],
    },
    {
      id: "radius",
      title: "Radius",
      description:
        "Corner values that keep controls crisp while still separating repeated surfaces.",
      tokens: [
        {
          name: "radius.control",
          value: "4px",
          tier: "Semantic",
          role: "Buttons, tabs, and compact controls.",
        },
        {
          name: "radius.input",
          value: "3px",
          tier: "Semantic",
          role: "Text fields and editable controls.",
        },
        {
          name: "radius.panel",
          value: "6px",
          tier: "Semantic",
          role: "Cards and local panels.",
        },
        {
          name: "radius.primitive.100",
          value: "3px",
          tier: "Primitive",
          role: "Smallest visible rounding.",
        },
        {
          name: "radius.primitive.200",
          value: "4px",
          tier: "Primitive",
          role: "Default control rounding.",
        },
        {
          name: "radius.primitive.300",
          value: "6px",
          tier: "Primitive",
          role: "Contained surface rounding.",
        },
      ],
    },
    {
      id: "shadow",
      title: "Shadows",
      description:
        "Layering values for dialogs, floating menus, and focused editor surfaces.",
      tokens: [
        {
          name: "shadow.component.dropdown",
          value: "0 10px 26px rgba(0, 0, 0, 0.32)",
          tier: "Component",
          role: "Dropdown and context menu elevation.",
        },
        {
          name: "shadow.component.modal",
          value: "0 24px 70px rgba(0, 0, 0, 0.45)",
          tier: "Component",
          role: "Blocking modal elevation.",
        },
        {
          name: "shadow.focus.accent",
          value: "0 0 0 1px rgba(42, 132, 248, 0.44)",
          tier: "Semantic",
          role: "Focused active element outline.",
        },
        {
          name: "shadow.primitive.100",
          value: "0 4px 16px rgba(0, 0, 0, 0.24)",
          tier: "Primitive",
          role: "Low elevation base value.",
        },
        {
          name: "shadow.primitive.200",
          value: "0 16px 42px rgba(0, 0, 0, 0.36)",
          tier: "Primitive",
          role: "Medium elevation base value.",
        },
      ],
    },
  ],
};

export const variablesView: Component = {
  mount(root, scope) {
    let disposed = false;
    let activePage: VariablesPageId = "all";
    let tokenGroups = cloneTokenDocument(defaultDesignTokens).groups;
    scope.add(
      disposable(() => {
        disposed = true;
      }),
    );

    const page = el("section", "nb-variables");
    const tabs = createVariablesTabs((pageId) => {
      activePage = pageId;
      updateVariablesTabs(tabs, activePage);
      renderTokenGrid(grid, tokenGroups, activePage);
    });
    const grid = el("div", "nb-token-grid");
    const content = el("div", "nb-variables__content");
    content.append(tabs, grid);
    page.append(createHero(scope), content);
    root.replaceChildren(page);

    updateVariablesTabs(tabs, activePage);
    renderTokenGrid(grid, tokenGroups, activePage);

    void loadTokenDocument().then(({ document }) => {
      if (disposed) return;
      tokenGroups = document.groups;
      renderTokenGrid(grid, tokenGroups, activePage);
    });
  },
};

function createHero(scope: Parameters<Component["mount"]>[1]) {
  const hero = el("header", "nb-variables__hero");
  const titleRow = el("div", "nb-variables__title-row");
  const info = el("button", "nb-variables__info", "i") as HTMLButtonElement;
  info.type = "button";
  info.setAttribute("aria-label", "Token tiers");
  attachTooltip(
    info,
    {
      html: html`<strong>Primitive tokens</strong> define what values exist.
        <strong>Semantic tokens</strong> explain how values should be used.
        <strong>Component tokens</strong> state where a value belongs.`,
    },
    scope,
  );
  titleRow.append(el("h1", "", "Variables"));
  const intro = el(
    "p",
    "nb-variables__intro",
    "Design tokens are named CSS property values that give designers and developers a shared source of truth.",
  );
  intro.append(info);

  hero.append(
    el("p", "nb-variables__eyebrow", "Design system"),
    titleRow,
    intro,
  );
  return hero;
}

function createVariablesTabs(onSelect: (pageId: VariablesPageId) => void) {
  const nav = el("nav", "nb-variables-tabs");
  nav.setAttribute("aria-label", "Variables pages");

  for (const tab of variablesTabs) {
    const button = el("button", "nb-variables-tabs__item") as HTMLButtonElement;
    button.type = "button";
    button.dataset.variablesPage = tab.id;
    button.setAttribute("aria-label", tab.label);

    const icon = el("span", "nb-variables-tabs__icon");
    if (tab.icon) render(icon, tab.icon);
    const label = el("span", "nb-variables-tabs__label", tab.label);
    if (tab.icon) button.append(icon);
    button.append(label, el("span", "nb-variables-tabs__indicator"));
    button.addEventListener("click", () => onSelect(tab.id));
    nav.append(button);
  }

  return nav;
}

function updateVariablesTabs(root: ParentNode, activePage: VariablesPageId) {
  for (const item of root.querySelectorAll<HTMLButtonElement>(
    "[data-variables-page]",
  )) {
    const active = item.dataset.variablesPage === activePage;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  }
}

function renderTokenGrid(
  grid: HTMLElement,
  groups: TokenGroup[],
  activePage: VariablesPageId,
) {
  grid.replaceChildren();
  for (const group of visibleGroups(groups, activePage)) {
    grid.append(createTokenCard(sortGroup(group)));
  }
}

function visibleGroups(groups: TokenGroup[], activePage: VariablesPageId) {
  if (activePage === "all") return groups;
  return groups.filter((group) => group.id === activePage);
}

function createTokenCard(group: TokenGroup) {
  const card = el("article", `nb-token-card nb-token-card--${group.id}`);
  card.id = `variables-${group.id}`;
  card.dataset.tokenGroup = group.id;
  const header = el("button", "nb-token-card__header") as HTMLButtonElement;
  header.type = "button";
  header.setAttribute("aria-expanded", "true");
  header.setAttribute("aria-controls", `variables-${group.id}-tokens`);
  const icon = el("div", "nb-token-card__icon");
  render(icon, iconForGroup(group.id));
  const chevron = el("span", "nb-token-card__chevron");
  render(chevron, chevronRightIcon);
  header.append(
    icon,
    el("span", "nb-token-card__title", group.title),
    el("span", "nb-token-card__description", group.description),
    chevron,
  );
  card.append(header);

  const list = el("div", "nb-token-list");
  list.id = `variables-${group.id}-tokens`;
  const showTier = new Set(group.tokens.map((token) => token.tier)).size > 1;
  for (const token of group.tokens) {
    list.append(createTokenRow(group.id, token, showTier));
  }

  const contentInner = el("div", "nb-token-card__content-inner");
  contentInner.append(list);
  const content = el("div", "nb-token-card__content");
  content.append(contentInner);
  card.append(content);

  header.addEventListener("click", () => {
    const collapsed = card.classList.toggle("is-collapsed");
    header.setAttribute("aria-expanded", String(!collapsed));
  });
  return card;
}

function createTokenRow(
  kind: TokenKind,
  token: DesignToken,
  showTier: boolean,
) {
  const row = el("div", "nb-token-row");
  row.append(createTokenPreview(kind, token));

  const body = el("div", "nb-token-row__body");
  const top = el("div", "nb-token-row__top");
  top.append(el("code", "nb-token-row__name", token.name));
  if (showTier) {
    top.append(
      el(
        "span",
        `nb-token-tier nb-token-tier--${token.tier.toLowerCase()}`,
        token.tier,
      ),
    );
  }
  body.append(top, el("p", "nb-token-row__role", token.role));

  const value = el("code", "nb-token-row__value", token.value);
  row.append(body, value);
  return row;
}

function createTokenPreview(kind: TokenKind, token: DesignToken) {
  const preview = el("span", `nb-token-preview nb-token-preview--${kind}`);
  preview.setAttribute("aria-hidden", "true");

  if (kind === "color" && token.preview) {
    preview.style.setProperty("--token-preview-color", token.preview);
  }

  if (kind === "spacing") {
    preview.style.setProperty("--token-preview-size", token.value);
  }

  if (kind === "typography") {
    preview.textContent = token.name.includes("caption") ? "Aa" : "Ag";
  }

  if (kind === "radius") {
    preview.style.setProperty("--token-preview-radius", token.value);
  }

  if (kind === "shadow") {
    preview.style.setProperty("--token-preview-shadow", token.value);
  }

  return preview;
}

function sortGroup(group: TokenGroup): TokenGroup {
  return {
    ...group,
    tokens: [...group.tokens].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function loadTokenDocument() {
  const fallback = cloneTokenDocument(defaultDesignTokens);
  let selected: Space | undefined;

  try {
    selected = await window.spaces.selected();
  } catch (error) {
    console.error("[variables] Unable to read selected space", error);
  }

  if (!selected) {
    return {
      document: fallback,
      message: "Select a space to persist variables.",
    };
  }

  try {
    const raw = await window.spaces.readDesignTokens();
    if (!raw) {
      await saveTokenDocument(fallback);
      return {
        document: fallback,
        message: `Saved in ${selected.displayPath}.`,
      };
    }

    return {
      document: normalizeTokenDocument(JSON.parse(raw)),
      message: `Loaded from ${selected.displayPath}.`,
    };
  } catch (error) {
    console.error("[variables] Unable to load design tokens", error);
    return {
      document: fallback,
      message: "Using defaults. The design token file could not be loaded.",
    };
  }
}

async function saveTokenDocument(document: DesignTokenDocument) {
  await window.spaces.writeDesignTokens(JSON.stringify(document, null, 2));
}

function cloneTokenDocument(
  document: DesignTokenDocument,
): DesignTokenDocument {
  return {
    version: 1,
    groups: document.groups.map((group) => ({
      ...group,
      tokens: group.tokens.map((token) => ({ ...token })),
    })),
  };
}

function normalizeTokenDocument(value: unknown): DesignTokenDocument {
  if (!value || typeof value !== "object") {
    return cloneTokenDocument(defaultDesignTokens);
  }

  const candidate = value as Partial<DesignTokenDocument>;
  const groups = normalizeTokenGroups(candidate.groups);
  return {
    version: 1,
    groups: groups.length
      ? groups
      : cloneTokenDocument(defaultDesignTokens).groups,
  };
}

function normalizeTokenGroups(value: unknown) {
  if (!Array.isArray(value)) return [];

  const groups: TokenGroup[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const group = item as Partial<TokenGroup>;
    if (!isTokenKind(group.id)) continue;
    if (typeof group.title !== "string") continue;
    if (typeof group.description !== "string") continue;

    groups.push({
      id: group.id,
      title: group.title,
      description: group.description,
      tokens: normalizeTokens(group.tokens),
    });
  }
  return groups.sort((a, b) => groupOrder(a.id) - groupOrder(b.id));
}

function normalizeTokens(value: unknown) {
  if (!Array.isArray(value)) return [];

  const tokens: DesignToken[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const token = item as Partial<DesignToken>;
    if (typeof token.name !== "string") continue;
    if (typeof token.value !== "string") continue;
    if (!isTokenTier(token.tier)) continue;
    if (typeof token.role !== "string") continue;

    tokens.push({
      name: token.name,
      value: token.value,
      tier: token.tier,
      role: token.role,
      ...(typeof token.preview === "string" ? { preview: token.preview } : {}),
    });
  }
  return tokens;
}

function isTokenKind(value: unknown): value is TokenKind {
  return (
    value === "color" ||
    value === "spacing" ||
    value === "typography" ||
    value === "radius" ||
    value === "shadow"
  );
}

function isTokenTier(value: unknown): value is TokenTier {
  return value === "Primitive" || value === "Semantic" || value === "Component";
}

function groupOrder(kind: TokenKind) {
  switch (kind) {
    case "color":
      return 0;
    case "spacing":
      return 1;
    case "typography":
      return 2;
    case "radius":
      return 3;
    case "shadow":
      return 4;
  }
}

function iconForGroup(kind: TokenKind): TrustedHtml {
  switch (kind) {
    case "color":
      return paintIcon;
    case "spacing":
      return spacingHorizontalIcon;
    case "typography":
      return typographyIcon;
    case "radius":
      return borderRadiusIcon;
    case "shadow":
      return shadowsIcon;
  }
}
