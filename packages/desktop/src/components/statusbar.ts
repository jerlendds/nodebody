import { el } from "../../../ui/src/base/dom";
import type { Component } from "../../../ui/src/base/component";
import { disposable, type Scope } from "../../../ui/src/base/disposable";
import { render } from "../../../ui/src/base/html";
import { pulseIcon } from "../../../ui/src/components/icons";
import { attachTooltip } from "../../../ui/src/components/tooltip";

/// Bottom workbench status bar. Contributions can be added beside the uptime
/// readout without changing the surrounding shell.
export const statusBar: Component = {
  mount(root: Element, scope: Scope) {
    const bar = el("footer", "nb-statusbar");
    const uptime = el("span", "nb-statusbar__item");
    const uptimeText = el("span", "nb-statusbar__text");
    const started = Date.now();
    render(uptime, pulseIcon);
    uptime.append(uptimeText);
    attachTooltip(
      uptime,
      { text: "InterfaceZ knows where the time goes." },
      scope,
    );

    const update = () => {
      const minutes = Math.floor((Date.now() - started) / 60000);
      const hours = Math.floor(minutes / 60);
      uptimeText.textContent = `${hours} hrs ${minutes % 60} mins`;
    };

    update();
    const timer = window.setInterval(update, 1000);
    scope.add(disposable(() => window.clearInterval(timer)));
    bar.append(uptime);
    root.append(bar);
  },
};
