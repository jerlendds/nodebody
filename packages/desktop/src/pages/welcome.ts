import type { Component } from "@nodebody/ui";
import {
  abcIcon,
  bulbIcon,
  codeFileIcon,
  cogIcon,
  createModal,
  el,
  folderTreeIcon,
  html,
  leafIcon,
  render,
  signingADocumentIcon,
  spaceshipLaunchDocumentationIcon,
} from "@nodebody/ui";
import type { TrustedHtml } from "@nodebody/ui";

type StartAction = "create-space" | "open-space" | "open-settings";

const starts: [StartAction, string, TrustedHtml][] = [
  ["create-space", "Create new space...", spaceshipLaunchDocumentationIcon],
  ["open-space", "Open a space...", signingADocumentIcon],
  ["open-settings", "Open settings...", cogIcon],
];

/// Welcome page shown in the initial workspace tab.
export const welcomeView: Component = {
  mount(root) {
    const page = el("section", "nb-welcome");
    page.append(createIntro(), createWalkthroughs());
    root.replaceChildren(page);
  },
};

function createIntro() {
  const section = el("section", "nb-welcome__intro");
  render(
    section,
    html`<h1>Nodebody</h1>
      <p>
        <!-- Novel, networked, notebooks to augment, adapt, and program your -->
        <!-- knowledge. -->
        Modular. Malleable. Media. Nodebody turns knowledge into a medium you
        can shape.
      </p>`,
  );

  const start = el("div", "nb-welcome__block");
  start.append(el("h2", "", "Start"));
  for (const [action, text, icon] of starts) {
    const btn = el("button", "nb-welcome__link");
    btn.type = "button";
    btn.dataset.action = action;
    render(btn, html`<span>${text}</span> ${icon}`);
    start.append(btn);
  }
  start.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button[data-action]",
    );
    if (!button) return;
    if (button.dataset.action === "create-space") openCreateSpaceModal();
    if (button.dataset.action === "open-space") void openExistingSpace();
  });

  const list = el("div", "nb-welcome__block");
  list.append(el("h2", "", "Recent"));
  const recentList = el("div", "nb-welcome__recent-list");
  recentList.append(el("small", "nb-welcome__fact", "No spaces yet."));
  list.append(recentList);
  list.append(el("button", "nb-welcome__link", "More..."));
  void refreshRecentSpaces(recentList);

  section.append(start, list);
  return section;
}

function openCreateSpaceModal() {
  const form = el("form", "nb-space-form");
  const field = el("label", "nb-space-form__field");
  const label = el("span", "", "Space selection");
  const controls = el("div", "nb-space-form__controls");
  const input = el("input", "nb-space-form__input") as HTMLInputElement;
  input.type = "text";
  input.required = true;
  input.placeholder = "~/Path/to/folder/location/";
  const browse = el("button", "nb-space-form__browse", "Select folder");
  browse.type = "button";
  browse.setAttribute("aria-label", "Select folder");
  controls.append(input, browse);
  field.append(label, controls);

  const footer = el("div", "nb-space-form__footer");
  const status = el("p", "nb-space-form__status");
  const submit = el("button", "nb-welcome__primary", "Create space");
  submit.type = "submit";
  footer.append(status, submit);
  form.append(field, footer);

  const modal = createModal({
    title: "Create a new space",
    description:
      "Select a folder to create a new malleable space of knowledge. Any files in this folder will be included in your space.",
    content: form,
  });
  document.body.append(modal.element);
  window.setTimeout(() => input.focus(), 0);

  browse.addEventListener("click", async () => {
    const directoryPath = await window.os.selectFolder?.();
    if (directoryPath) input.value = directoryPath;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const directoryPath = input.value.trim();
    if (!directoryPath) {
      status.textContent = "Choose a folder first.";
      return;
    }

    submit.disabled = true;
    status.textContent = "Creating space...";
    try {
      await window.spaces.create(directoryPath);
      modal.close();
      refreshAllRecentSpaces();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Unable to create space.";
      submit.disabled = false;
    }
  });
}

async function openExistingSpace() {
  const directoryPath = await window.os.selectFolder?.();
  if (!directoryPath) return;
  try {
    await window.spaces.select(directoryPath);
    refreshAllRecentSpaces();
  } catch (error) {
    console.error(error);
  }
}

async function refreshRecentSpaces(root: HTMLElement) {
  const spaces = await window.spaces.list();
  root.replaceChildren();
  if (!spaces.length) {
    root.append(el("small", "nb-welcome__fact", "No spaces yet."));
    return;
  }

  for (const space of spaces) {
    const row = el("button", "nb-recent");
    row.type = "button";
    row.dataset.path = space.path;
    const name = el("span", "", space.name);
    const small = el("small", "", space.path);
    row.append(name, small);
    row.addEventListener("click", async () => {
      await window.spaces.select(space.path);
      refreshAllRecentSpaces();
    });
    root.append(row);
  }
}

function refreshAllRecentSpaces() {
  for (const root of document.querySelectorAll<HTMLElement>(
    ".nb-welcome__recent-list",
  )) {
    void refreshRecentSpaces(root);
  }
}

function createWalkthroughs() {
  const section = el("section", "nb-welcome__walkthroughs");
  section.append(el("h2", "", "Walkthroughs"));

  [
    "Get started with Nodebody",
    "Learn the Fundamentals",
    "Research with Nodebody",
    "Make work addressable",
  ];

  const walkthroughs = [
    ["Get started with Nodebody", abcIcon],
    ["Learn the Fundamentals", leafIcon],
    ["Research with Nodebody", bulbIcon],
    ["Make malleable software", codeFileIcon],
  ];

  for (const [title, icon] of walkthroughs) {
    const item = el("button", "nb-walkthrough");
    render(
      item,
      html`<span class="nb-walkthrough__icon">${icon}</span>
        <span>${title}</span>
        <i></i>`,
    );
    section.append(item);
  }
  const announcements = el("div", "nb-welcome__block");
  render(
    announcements,
    html`<h2>Nodebody Announcements</h2>
      <button class="nb-welcome__link">Local-first resource graphs</button>
      <button class="nb-welcome__link">
        Transactions, facets, and plugins
      </button>`,
  );
  section.append(announcements);
  return section;
}
