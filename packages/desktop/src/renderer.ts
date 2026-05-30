import "./assets/index.css";
import "@nodebody/ui/index.css";
import { configureContextMenuManager, mount } from "@nodebody/ui";
import { createDesktopContextMenuBridge } from "./components/context-menu";
import { workbench } from "./components/workbench";

const root = document.querySelector("#app");

if (!root) throw new Error("Missing #app root");

configureContextMenuManager({
  root: document,
  bridge: createDesktopContextMenuBridge(),
});
mount(workbench(), root);
