# `@interfacez/ui`

`@interfacez/ui` is the DOM workbench shell and small UI runtime for InterfaceZ.

It provides a mountable component model, scoped disposables, simple signals,
DOM helpers, trusted and sanitized HTML helpers, command shapes, workbench
chrome, panes, tooltips, iframe views, theme variables, component CSS, and the current SVG icon set. It does not own application state, resource indexing, graph storage, persistence, plugin authority, Electron process control, or editor semantics. Those concerns belong in higher-level packages.

## Current Shape

The package is implemented as a small runtime plus concrete UI components under
`src/`. The root entry point re-exports runtime and component APIs from `src/index.ts`.
The `./index.css` export is the package stylesheet entry point.

## What This Package Does Not Own

This package does not currently implement:

- document or graph state
- resource persistence or file IO
- plugin loading or sandboxing
- capability checks
- global command routing beyond the local `CommandRegistry`
- split-tree pane persistence
- editor models
- webview or iframe security policy beyond the default iframe sandbox string
- Electron main-process behavior
- a full design-system component library

Those can be wired into this package, but they are not part of its runtime
contract.

## Basic Usage

```ts
import "@interfacez/ui/index.css";
import { mount } from "@interfacez/ui";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app root");

const disposable = mount(..., root);

// Later, when the host tears down this surface:
disposable.dispose();
```

## Runtime Model

The runtime is deliberately small.

Components mount into an existing element and register cleanup with a `Scope`.
Signals notify subscribers synchronously when their value changes. Event
delegation is used for shell-level interactions such as activity selection and
window controls. `reconcile` is available for keyed DOM lists.

This keeps the package easy to embed in Electron or a browser preview, and it
makes ownership of DOM side effects explicit.

HTML helpers distinguish application-owned trusted HTML from sanitized HTML.
`html` should only be used for strings owned by the application. `htmlc` and
`cleanHtml` sanitize raw HTML with DOMPurify and a restricted allowlist.

## Styling

`src/index.css` imports component-scoped CSS files from `src/styles/` and keeps
only iframe rules at the top level.

## Icons

SVG files live under `src/icons/` and are imported by `components/icons.ts` with
Vite's `?raw` loader. Each exported icon is trusted application-owned HTML with
`color="currentColor"` and `fill="currentColor"` patched onto the root SVG when
missing.

Icon exports are component conveniences, not a general icon pipeline. New icons
should be added as SVG assets and exported from `components/icons.ts` when the
workbench needs them.

## Performance

The package avoids framework runtime cost by using:

- direct DOM creation and updates
- explicit cleanup scopes
- synchronous signals with `Object.is` change checks
- keyed DOM reconciliation helpers where callers need stable children
- event delegation for shell actions
- CSS variables instead of regenerating styles
- browser-native scrolling, focus, and animation primitives

The current tab and pane implementation favors clarity over fine-grained diffing.
Pane state changes rebuild the pane group and remount active tab views. That is
acceptable for the present shell, but split panes, large tab counts, and
editor-heavy surfaces will need a more incremental reconciliation path.

## Tradeoffs

Pros:

- small runtime surface
- no framework dependency
- easy to inspect DOM output
- explicit side-effect ownership
- portable between browser previews and Electron renderers
- small trusted/sanitized HTML boundary for DOM rendering
- component CSS is split by responsibility

Cons:

- fewer guardrails than a mature UI framework
- manual accessibility and focus management
- no framework-level reconciliation
- no server rendering story
- no complete widget library
- SVG icons are manually imported and exported
- package APIs are still early and may change

## Logo font

The font used for logo.svg is `Conthrax`.

## Status

This package is currently a workbench shell and runtime foundation. It is useful
for rendering InterfaceZ chrome and early panes, but it is not yet the final
workspace, editor, or plugin UI API.
