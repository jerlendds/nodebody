import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type {
  ContextMenuAction,
  ContextMenuEvent,
  Disposable,
} from "@interfacez/ui";
import { disposable } from "@interfacez/ui";
import type { MarkdownDocumentModel, MarkdownOptions } from "./options";

export type MarkdownPluginCapability =
  | "editor.read"
  | "editor.write"
  | "document.save"
  | "contextMenu"
  | "commands"
  | "network"
  | "filesystem"
  | "layout.ports"
  | "layout.intents";

export interface MarkdownPluginContext {
  readonly document: MarkdownDocumentModel;
  readonly options: MarkdownOptions;
}

export interface MarkdownRuntimeContext extends MarkdownPluginContext {
  readonly view: EditorView;
  getText(): string;
  replaceText(value: string): void;
}

export interface MarkdownEditorPlugin {
  readonly id: string;
  readonly displayName?: string;
  readonly priority?: number;
  readonly capabilities?: readonly MarkdownPluginCapability[];

  codeMirrorExtensions?(ctx: MarkdownPluginContext): readonly Extension[];

  onView?(ctx: MarkdownRuntimeContext): Disposable | void;

  contextMenu?(
    ctx: MarkdownRuntimeContext,
    event: ContextMenuEvent,
  ): readonly ContextMenuAction[];

  runContextMenuAction?(
    ctx: MarkdownRuntimeContext,
    actionId: string,
    event: ContextMenuEvent,
  ): void | Promise<void>;
}

export interface MarkdownEditorHostOptions {
  document: MarkdownDocumentModel;
  options: MarkdownOptions;
  plugins?: readonly MarkdownEditorPlugin[];
  allowPlugin?: (plugin: MarkdownEditorPlugin) => boolean;
}

export class MarkdownEditorHost implements Disposable {
  readonly pluginCompartment = new Compartment();

  private readonly plugins = new Map<string, MarkdownEditorPlugin>();
  private readonly viewDisposables = new Map<string, Disposable>();
  private view: EditorView | undefined;
  private disposed = false;

  constructor(private readonly hostOptions: MarkdownEditorHostOptions) {
    for (const plugin of hostOptions.plugins ?? []) {
      this.plugins.set(plugin.id, plugin);
    }
  }

  initialExtension(): Extension {
    return this.pluginCompartment.of(this.collectCodeMirrorExtensions());
  }

  attach(view: EditorView): void {
    if (this.disposed) {
      view.destroy();
      return;
    }

    this.view = view;
    this.refreshViewHooks();
  }

  registerPlugin(plugin: MarkdownEditorPlugin): Disposable {
    if (this.disposed) return disposable(() => undefined);

    if (this.hostOptions.allowPlugin?.(plugin) === false) {
      throw new Error(`Markdown editor plugin rejected: ${plugin.id}`);
    }

    if (this.plugins.has(plugin.id)) {
      throw new Error(
        `Markdown editor plugin already registered: ${plugin.id}`,
      );
    }

    this.plugins.set(plugin.id, plugin);
    this.reconfigure();

    return disposable(() => {
      this.unregisterPlugin(plugin.id);
    });
  }

  unregisterPlugin(id: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin) return;

    this.viewDisposables.get(id)?.dispose();
    this.viewDisposables.delete(id);
    this.plugins.delete(id);
    this.reconfigure();
  }

  contextMenuActions(event: ContextMenuEvent): readonly ContextMenuAction[] {
    const ctx = this.runtimeContext();
    if (!ctx) return [];

    const actions: ContextMenuAction[] = [];

    for (const plugin of this.sortedPlugins()) {
      if (!plugin.contextMenu) continue;
      actions.push(...plugin.contextMenu(ctx, event));
    }

    return actions;
  }

  async runContextMenuAction(
    actionId: string,
    event: ContextMenuEvent,
  ): Promise<boolean> {
    const ctx = this.runtimeContext();
    if (!ctx) return false;

    for (const plugin of this.sortedPlugins()) {
      const actions = plugin.contextMenu?.(ctx, event) ?? [];
      if (!actions.some((action) => action.id === actionId)) continue;
      await plugin.runContextMenuAction?.(ctx, actionId, event);
      return true;
    }

    return false;
  }

  dispose(): void {
    this.disposed = true;

    for (const item of this.viewDisposables.values()) {
      item.dispose();
    }

    this.viewDisposables.clear();
    this.plugins.clear();
    this.view = undefined;
  }

  private reconfigure(): void {
    const view = this.view;
    if (!view) return;

    view.dispatch({
      effects: this.pluginCompartment.reconfigure(
        this.collectCodeMirrorExtensions(),
      ),
    });

    this.refreshViewHooks();
  }

  private collectCodeMirrorExtensions(): Extension[] {
    const ctx: MarkdownPluginContext = {
      document: this.hostOptions.document,
      options: this.hostOptions.options,
    };

    return this.sortedPlugins().flatMap(
      (plugin) => plugin.codeMirrorExtensions?.(ctx) ?? [],
    );
  }

  private refreshViewHooks(): void {
    const ctx = this.runtimeContext();
    if (!ctx) return;

    for (const item of this.viewDisposables.values()) {
      item.dispose();
    }

    this.viewDisposables.clear();

    for (const plugin of this.sortedPlugins()) {
      const result = plugin.onView?.(ctx);
      if (result) this.viewDisposables.set(plugin.id, result);
    }
  }

  private runtimeContext(): MarkdownRuntimeContext | undefined {
    const view = this.view;
    if (!view) return undefined;

    return {
      document: this.hostOptions.document,
      options: this.hostOptions.options,
      view,
      getText: () => view.state.doc.toString(),
      replaceText: (value) => {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
      },
    };
  }

  private sortedPlugins(): MarkdownEditorPlugin[] {
    return [...this.plugins.values()].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
  }
}
