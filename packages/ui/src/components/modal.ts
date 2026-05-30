import { el } from "../base/dom";
import { render, type TrustedHtml } from "../base/html";
import { xIcon } from "./icons";

export interface ModalOptions {
  title: string;
  description?: string;
  content?: Node | Node[];
  closeLabel?: string;
  onClose?: () => void;
}

export interface ModalHandle {
  element: HTMLElement;
  close: () => void;
}

const modalCloseAnimationMs = 160;

export function createModal(options: ModalOptions): ModalHandle {
  const overlay = el("div", "nb-modal-overlay");
  const dialog = el("section", "nb-modal");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "nb-modal-title");

  const header = el("header", "nb-modal__header");
  const title = el("h2", "nb-modal__title", options.title);
  title.id = "nb-modal-title";
  const closeButton = el("button", "nb-modal__close");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", options.closeLabel ?? "Close modal");
  render(closeButton, xIcon as TrustedHtml);
  header.append(title, closeButton);
  dialog.append(header);

  if (options.description) {
    dialog.append(el("p", "nb-modal__description", options.description));
  }

  const body = el("div", "nb-modal__body");
  const content = options.content
    ? Array.isArray(options.content)
      ? options.content
      : [options.content]
    : [];
  body.append(...content);
  dialog.append(body);

  overlay.append(dialog);

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    overlay.classList.add("nb-modal-overlay--closing");
    window.setTimeout(() => {
      overlay.remove();
      options.onClose?.();
    }, modalCloseAnimationMs);
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  closeButton.addEventListener("click", close);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  return { element: overlay, close };
}
