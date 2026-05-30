import type { Component } from "@nodebody/ui";
import {
  abcIcon,
  bulbIcon,
  codeFileIcon,
  cogIcon,
  el,
  html,
  leafIcon,
  render,
  signingADocumentIcon,
  spaceshipLaunchDocumentationIcon,
} from "@nodebody/ui";

const starts = [
  ["Create new space...", spaceshipLaunchDocumentationIcon],
  ["Open a space...", signingADocumentIcon],
  ["Open settings...", cogIcon],
];
const recent = [
  ["studies", "~/Projects/studies/"],
  ["nodebody", "~/Projects/nodebody/"],
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
      <p>Evolving the graph workspace</p>`,
  );

  const start = el("div", "nb-welcome__block");
  start.append(el("h2", "", "Start"));
  for (const [text, icon] of starts) {
    const btn = el("button", "nb-welcome__link");
    console.log(btn);
    render(btn, html`<span>${text}</span> ${icon}`);
    start.append(btn);
  }

  const list = el("div", "nb-welcome__block");
  list.append(el("h2", "", "Recent"));
  for (const [name, path] of recent) {
    const row = el("button", "nb-recent");
    render(row, html`<span>${name}</span><small>${path}</small>`);
    list.append(row);
  }
  list.append(el("button", "nb-welcome__link", "More..."));

  section.append(start, list);
  return section;
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
