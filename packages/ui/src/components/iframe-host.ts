import { el } from "../base/dom";
import type { Component } from "../base/component";
import { disposable, type Scope } from "../base/disposable";

/// Options for a sandboxed iframe-backed pane view.
export interface IframeViewOptions {
  title: string;
  src?: string;
  srcdoc?: string;
  sandbox?: string;
  onMessage?: (message: unknown, event: MessageEvent) => void;
}

/// Create a pane view that hosts extension UI inside an iframe rather
/// than granting direct access to the workbench DOM.
export function iframeView(options: IframeViewOptions): Component {
  return {
    mount(root, scope: Scope) {
      const frame = el("iframe", "nb-iframe-view");
      frame.title = options.title;
      frame.sandbox.value = options.sandbox ?? "allow-scripts";
      if (options.src) frame.src = options.src;
      if (options.srcdoc) frame.srcdoc = options.srcdoc;

      if (options.onMessage) {
        const onMessage = (event: MessageEvent) => {
          if (event.source !== frame.contentWindow) return;
          options.onMessage?.(event.data, event);
        };
        window.addEventListener("message", onMessage);
        scope.add(
          disposable(() => window.removeEventListener("message", onMessage)),
        );
      }

      root.replaceChildren(frame);
    },
  };
}
