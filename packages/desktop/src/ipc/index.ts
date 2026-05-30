import { registerContextMenuIpc } from "./contextmenu";
import { registerOsIpc } from "./os";
import { registerSpacesIpc } from "./spaces";

export default function registerIpcHandlers() {
  registerContextMenuIpc();
  registerOsIpc();
  registerSpacesIpc();
}
