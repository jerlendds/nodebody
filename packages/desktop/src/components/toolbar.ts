import { el } from "../../../ui/src/base/dom";
import type { Scope } from "../../../ui/src/base/disposable";
import { disposable } from "../../../ui/src/base/disposable";
import { html, render, type TrustedHtml } from "../../../ui/src/base/html";
import { getHotkeyManager } from "../../../ui/src/base/hotkeys";
import {
  attachDropdown,
  dropdownSeparator,
  type DropdownController,
  type DropdownItem,
} from "../../../ui/src/components/dropdown";
import {
  arrowNarrowLeftIcon,
  arrowNarrowRightIcon,
  cmdIcon,
  logoIcon,
  bulbIcon,
  minusIcon,
  windowMaximizeIcon,
  xIcon,
} from "../../../ui/src/components/icons";
import { attachTooltip } from "../../../ui/src/components/tooltip";

const brandTooltipPhrases = [
  "InterfaceZ knows what this button wants to be.",
  "InterfaceZ turns prompts into pixels.",
  "InterfaceZ makes the interface answer back.",
  "InterfaceZ designs like code can breathe.",
  "InterfaceZ knows your layout has feelings.",
  "InterfaceZ found the missing interaction.",
  "InterfaceZ makes components less lonely.",
  "InterfaceZ said design had to be static.",
  "InterfaceZ said mockups had to stay mockups.",
  "InterfaceZ turns code into a medium.",
  "InterfaceZ makes UI malleable.",
  "InterfaceZ bends the canvas.",
  "InterfaceZ lets the interface improvise.",
  "InterfaceZ speaks fluent component.",
  "InterfaceZ knows where that state went.",
  "InterfaceZ is watching your variants.",
  "InterfaceZ made your design programmable.",
  "InterfaceZ made your prototype think.",
  "InterfaceZ connects the prompt to the pixel.",
  "InterfaceZ knows how this interaction connects.",
  "InterfaceZ can make your UI talk.",
  "InterfaceZ likes messy canvases.",
  "InterfaceZ likes modular media.",
  "InterfaceZ fears the fixed frame.",
  "InterfaceZ respects the humble div.",
  "InterfaceZ moved your breakpoint. Politely.",
  "InterfaceZ linted your layout.",
  "InterfaceZ handles your edge cases.",
  "InterfaceZ found the hidden affordance.",
  "InterfaceZ imports context from everywhere.",
  "InterfaceZ made your components composable.",
  "InterfaceZ move. I'm rendering.",
  "InterfaceZ move. I'm iterating.",
  "InterfaceZ panic. It's all interactive.",
  "InterfaceZ got your z-index under control.",
  "InterfaceZ knows the z-axis personally.",
  "InterfaceZ brings the Z to UI.",
  "InterfaceZ makes the interface zesty.",
  "Somebody called InterfaceZ.",
  "Anybody seen that InterfaceZ?",
  "No interface panic. InterfaceZ is here.",
  "Anybody can draw screens. InterfaceZ shapes them.",
  "InterfaceZ remembers the design intent.",
  "InterfaceZ expects the layout inquisition.",
  "InterfaceZ is gonna refactor that later.",
  "InterfaceZ is watching the canvas evolve.",
  "InterfaceZ asked for one more variant.",
  "InterfaceZ made the wireframe sentient.",
  "InterfaceZ designs at the speed of thought.",
  "InterfaceZ makes software feel sketchable.",
  "InterfaceZ turns ideas into interfaces.",
  "InterfaceZ turns interfaces into systems.",
  "InterfaceZ makes AI feel hands-on.",
  "InterfaceZ gives code a handle.",
  "InterfaceZ gives design a runtime.",
  "InterfaceZ said the canvas could compile.",
  "InterfaceZ said the interface could learn.",
  "InterfaceZ said your mockup wants agency.",
  "InterfaceZ said media should be malleable.",
  "InterfaceZ said modular was the medium.",
  "InterfaceZ lets you sculpt software.",
  "InterfaceZ makes design programmable.",
  "InterfaceZ makes programming visual.",
  "InterfaceZ turns interaction into material.",
  "InterfaceZ makes the medium editable.",
  "InterfaceZ knows your components by name.",
  "InterfaceZ asked the interface what it needed.",
  "InterfaceZ found the affordance you forgot.",
  "InterfaceZ makes prototypes less pretend.",
  "InterfaceZ keeps your design system awake.",
  "InterfaceZ is where interfaces get ideas.",
] as const;

const fileMenuItems: readonly DropdownItem[] = [
  { id: "file.newTextFile", label: "New Text File", accelerator: "Ctrl+N" },
  { id: "file.newFile", label: "New File..." },
  dropdownSeparator(),
  { id: "file.openFile", label: "Open File" },
  { id: "file.openFolder", label: "Open Folder" },
  { id: "file.openRecent", label: "Open Recent", type: "submenu", items: [] },
  dropdownSeparator(),
  { id: "file.save", label: "Save" },
  { id: "file.saveAs", label: "Save As..." },
  dropdownSeparator(),
  { id: "file.autoSave", label: "Auto Save" },
  { id: "file.preferences", label: "Preferences" },
  dropdownSeparator(),
  { id: "file.exit", label: "Exit", accelerator: "Ctrl+Q" },
];

/// Create the workbench toolbar used as the draggable Electron chrome.
/// Buttons expose data attributes only; command wiring lives outside.
export function createToolbar(scope: Scope) {
  const root = el("header", "nb-toolbar");
  const left = el("div", "nb-toolbar__left");
  const brand = el("div", "nb-toolbar__brand");
  brand.setAttribute("aria-label", "InterfaceZ");
  brand.tabIndex = 0;
  render(
    brand,
    html`<span class="nb-toolbar__brand-icon nb-toolbar__brand-icon--graph">
        ${logoIcon}
      </span>
      <span class="nb-toolbar__brand-icon nb-toolbar__brand-icon--logo">
        ${bulbIcon}
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
  let fileDropdown: DropdownController | undefined;
  for (const label of menuItems) {
    const item = el("div", "nb-toolbar__titlebar-menu");
    const button = el("button", "nb-toolbar__titlebar-item", label);
    button.type = "button";
    button.dataset.titlebarFunction = label.toLowerCase();
    item.append(button);
    titlebarMenu.append(item);

    if (label === "File") {
      fileDropdown = attachDropdown({
        trigger: button,
        items: fileMenuItems,
        scope,
        ariaLabel: "File menu",
      });
    }
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
    if (!open) fileDropdown?.close();
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
    if (fileDropdown && path.includes(fileDropdown.element)) return;
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
