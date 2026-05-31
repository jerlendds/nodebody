import type { LayoutPortSink } from "@nodebody/ui";
import { disposable } from "@nodebody/ui";
import type { MarkdownEditorPlugin } from "./plugin";

export function markdownLayoutPortsPlugin(
  sink: LayoutPortSink,
): MarkdownEditorPlugin {
  return {
    id: "markdown.layoutPorts",
    displayName: "Markdown Layout Ports",
    capabilities: ["editor.read", "layout.ports"],

    onView(ctx) {
      const update = () => {
        const view = ctx.view;
        const selection = view.state.selection.main;
        const contentId = ctx.document.id;

        sink.setPorts(contentId, [
          {
            id: `markdown:${contentId}:cursor`,
            contentId,
            kind: "cursor",
            stability: "scroll",
            rect: () => {
              const coords = view.coordsAtPos(selection.head);
              return coords
                ? new DOMRectReadOnly(
                    coords.left,
                    coords.top,
                    coords.right - coords.left,
                    coords.bottom - coords.top,
                  )
                : null;
            },
          },
          {
            id: `markdown:${contentId}:selection`,
            contentId,
            kind: "selection",
            stability: "scroll",
            rect: () => {
              if (selection.empty) return null;
              const from = view.coordsAtPos(selection.from);
              const to = view.coordsAtPos(selection.to);
              if (!from || !to) return null;
              const left = Math.min(from.left, to.left);
              const top = Math.min(from.top, to.top);
              const right = Math.max(from.right, to.right);
              const bottom = Math.max(from.bottom, to.bottom);
              return new DOMRectReadOnly(left, top, right - left, bottom - top);
            },
          },
        ]);
      };

      update();

      const onScroll = () => update();
      ctx.view.scrollDOM.addEventListener("scroll", onScroll);

      return disposable(() => {
        ctx.view.scrollDOM.removeEventListener("scroll", onScroll);
        sink.clearPorts(ctx.document.id);
      });
    },
  };
}
