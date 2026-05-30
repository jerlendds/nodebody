import { registerContextMenuIpc } from "./contextmenu";
import { registerOsIpc } from "./os";

export default function registerIpcHandlers() {
  registerContextMenuIpc();
  registerOsIpc();
}
