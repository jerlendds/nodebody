import type {
  ComponentThemeInput,
  TrustedHtml,
  PaneModel,
  Scope,
} from "@nodebody/ui";
import { cogIcon, attachTooltip, el, render } from "@nodebody/ui";

/// The side where the fixed activity rail is placed.
export type SidebarSide = "left" | "right";

/// A compact activity entry shown in the always-visible rail.
export interface ActivityItem {
  id: string;
  label: string;
  icon: TrustedHtml | Node;
  badge?: string;
  tooltip?: string;
}

const settingsActivity: ActivityItem = {
  id: "settings",
  label: "Settings",
  icon: cogIcon,
  tooltip: "Settings",
};

/// Configuration for the fixed activity rail. It is intentionally a
/// narrow rail, not a collapsible animated drawer.
export interface SidebarOptions {
  side: SidebarSide;
  width: number;
  items: ActivityItem[];
}

/// Create the fixed workbench sidebar from declarative activity items.
export function createSidebar(options: SidebarOptions, scope: Scope) {
  const root = el("aside", `nb-sidebar nb-sidebar--${options.side}`);
  root.style.setProperty("--nb-sidebar-width", `${options.width}px`);

  const rail = el("nav", "nb-sidebar__rail");
  rail.setAttribute("aria-label", "Workspace");

  const mainItems = el("div", "nb-sidebar__items");
  const bottomItems = el("div", "nb-sidebar__items nb-sidebar__items--bottom");

  for (const item of options.items) {
    mainItems.append(createActivityButton(item, scope));
  }
  bottomItems.append(createActivityButton(settingsActivity, scope));

  rail.append(mainItems, bottomItems);
  root.append(rail);
  return root;
}

function createActivityButton(item: ActivityItem, scope: Scope) {
  const button = el("button", "nb-icon-button");
  button.type = "button";
  button.dataset.activity = item.id;
  button.setAttribute("aria-label", item.label);
  const icon = el("span", "nb-icon-button__icon");
  icon.dataset.activityIcon = item.id;
  if (typeof item.icon === "string") render(icon, item.icon);
  else icon.append(item.icon);
  button.append(icon);
  if (item.badge) button.append(el("span", "nb-badge", item.badge));
  if (item.tooltip) {
    attachTooltip(button, { text: item.tooltip }, scope, {
      delay: 800,
      placement: "right",
    });
  }
  return button;
}
