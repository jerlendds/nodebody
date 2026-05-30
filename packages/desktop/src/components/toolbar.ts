import { el } from "../../../ui/src/base/dom";
import type { Scope } from "../../../ui/src/base/disposable";
import { disposable } from "../../../ui/src/base/disposable";
import { html, render, type TrustedHtml } from "../../../ui/src/base/html";
import { getHotkeyManager } from "../../../ui/src/base/hotkeys";
import {
  arrowNarrowLeftIcon,
  arrowNarrowRightIcon,
  cmdIcon,
  logoIcon,
  mindMapIcon,
  minusIcon,
  windowMaximizeIcon,
  xIcon,
} from "../../../ui/src/components/icons";
import { attachTooltip } from "../../../ui/src/components/tooltip";

const brandTooltipPhrases = [
  "Nodebody knows your graph like we do.",
  "Nodebody gets lost in the graph.",
  "Nodebody panic. It's all connected.",
  "Nodebodys perfect. Except your links.",
  "Nodebody does it better.",
  "Nodebody knows where that note went.",
  "Nodebodys watching your backlinks.",
  "Nodebody move. I'm graphing.",
  "Nodebody said knowledge had to be linear.",
  "Nodebodys business but your knowledge.",
  "Nodebody connects the dots.",
  "Nodebody likes a lonely note.",
  "Nodebody fears the orphan note.",
  "Nodebodys got links",
  "Nodebodys notes are alone tonight.",
  "Nodebodys keeping track. Don't worry.",
  "Nodebody believes in folder hierarchy anymore.",
  "Nodebody said this had to be a tree.",
  "Nodebody said context was optional.",
  "Nodebody knows how this connects.",
  "Nodebody can make your notes talk.",
  "Nodebody likes thinking in public.",
  "Nodebody likes messy knowledge.",
  "Somebody called Nodebody.",
  "Anybody seen that Nodebody?",
  "Nobody panic. Nodebodys here.",
  "Anybody can write notes. Nodebody connects them.",
  "Nodebody remembers.",
  "Nodebody expects the graph inquisition.",
  "Nodebodys gonna connect that later.",
  "Nodebodys watching the graph grow.",
  "Nodebody found the hidden edge.",
  "Nodebody handles your edge cases.",
  "Nodebody linted your links.",
  "Nodebody walks the graph.",
  "Nodebody imports context from everywhere.",
  "Nodebody made your notes composable.",
  "Nodebody move, I'm indexing.",
  "Nodebody asked for a graph cycle.",
  "Somebody left a Nodebody in the graph!",
] as const;

/// Create the workbench toolbar used as the draggable Electron chrome.
/// Buttons expose data attributes only; command wiring lives outside.
export function createToolbar(scope: Scope) {
  const root = el("header", "nb-toolbar");
  const left = el("div", "nb-toolbar__left");
  const brand = el("div", "nb-toolbar__brand");
  brand.setAttribute("aria-label", "Nodebody");
  brand.tabIndex = 0;
  render(
    brand,
    html`<span class="nb-toolbar__brand-icon nb-toolbar__brand-icon--graph">
        ${mindMapIcon}
      </span>
      <span class="nb-toolbar__brand-icon nb-toolbar__brand-icon--logo">
        ${logoIcon}
      </span>`,
  );
  attachTooltip(
    brand,
    () => ({
      text: brandTooltipPhrases[
        Math.floor(Math.random() * brandTooltipPhrases.length)
      ],
    }),
    scope,
    { placement: "bottom" },
  );
  const titlebarMenu = el("nav", "nb-toolbar__titlebar");
  titlebarMenu.setAttribute("aria-label", "Application menu");
  titlebarMenu.setAttribute("aria-hidden", "true");
  titlebarMenu.hidden = true;

  const menuItems = ["File", "Edit", "View", "Help"] as const;
  for (const label of menuItems) {
    const button = el("button", "nb-toolbar__titlebar-item", label);
    button.type = "button";
    button.dataset.titlebarFunction = label.toLowerCase();
    titlebarMenu.append(button);
  }

  const center = el("div", "nb-toolbar__center");

  const history = el("div", "nb-toolbar__history");
  const historyButtons: readonly [label: string, icon: TrustedHtml][] = [
    ["Back", arrowNarrowLeftIcon],
    ["Forward", arrowNarrowRightIcon],
  ];
  for (const [label, icon] of historyButtons) {
    const button = el("button", "nb-tool-button");
    button.type = "button";
    render(button, icon);
    button.title = label;
    button.setAttribute("aria-label", label);
    history.append(button);
  }

  const command = el("button", "nb-command-palette");
  command.type = "button";
  command.dataset.command = "workbench.commandPalette";
  render(
    command,
    html`<span class="nb-command-palette__content">
      <span class="nb-command-palette__shortcut">${cmdIcon}</span>
      <span class="nb-command-palette__hint">
        Create or open a space to start
      </span>
    </span>`,
  );
  center.append(history, command);

  const actions = el("div", "nb-toolbar__actions");
  const windowButtons: readonly [
    label: string,
    icon: TrustedHtml,
    action: string,
  ][] = [
    ["Minimize", minusIcon, "minimize"],
    ["Maximize", windowMaximizeIcon, "maximize"],
    ["Close", xIcon, "close"],
  ];
  for (const [label, icon, action] of windowButtons) {
    const button = el("button", "nb-tool-button");
    button.type = "button";
    render(button, icon);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.windowAction = action;
    actions.append(button);
  }

  const setTitlebarMenuOpen = (open: boolean) => {
    titlebarMenu.hidden = !open;
    titlebarMenu.setAttribute("aria-hidden", String(!open));
    root.classList.toggle("nb-toolbar--titlebar-open", open);
  };

  scope.add(
    getHotkeyManager().registerGlobal({
      id: "workbench.titlebarMenu.show",
      key: "Alt",
      priority: 1_000,
      allowInEditable: true,
      run: () => {
        setTitlebarMenuOpen(true);
      },
    }),
  );

  const onDocumentPointerDown = (event: PointerEvent) => {
    const path = event.composedPath();
    if (path.includes(root)) return;
    setTitlebarMenuOpen(false);
  };
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  scope.add(
    disposable(() => {
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    }),
  );

  left.append(brand, titlebarMenu);
  root.append(left, center, actions);
  return root;
}
