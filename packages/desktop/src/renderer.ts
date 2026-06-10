import "./assets/index.css";
import "@interfacez/ui/index.css";
import "@interfacez/editor-markdown/markdown-editor.css";
import { configureContextMenuManager, mount } from "@interfacez/ui";
import { createDesktopContextMenuBridge } from "./components/context-menu";
import { workbench } from "./components/workbench";

const root = document.querySelector("#app");

if (!root) throw new Error("Missing #app root");

configureContextMenuManager({
  root: document,
  bridge: createDesktopContextMenuBridge(),
});

mount(workbench(), root);
