import type { Component } from "@interfacez/ui";
import { disposable, el } from "@interfacez/ui";
import PreviewBuildWorker from "./web-project-preview.worker?worker";

type ProjectLanguage = "typescript" | "javascript" | "html" | "css" | "json";

interface ProjectFile {
  path: string;
  language: ProjectLanguage;
  content: string;
  dirty: boolean;
}

interface ProjectState {
  files: Record<string, ProjectFile>;
  entry: string;
  dependencies: Record<string, string>;
}

interface WebProjectPreviewOptions {
  rootPath: string;
  onOpenSource?: (source: SourceLocation) => void;
}

interface BuildDiagnostic {
  text: string;
  location?: string;
}

interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

interface CssRuleOrigin {
  ruleId: string;
  file: string;
  selector: string;
  startLine: number;
  endLine: number;
  openIndex?: number;
  declarations: Record<string, string>;
}

interface BuildOutput {
  html: string;
  css: string;
  cssRules: CssRuleOrigin[];
  diagnostics: BuildDiagnostic[];
}

type WorkerResponse =
  | { type: "success"; requestId: number; output: BuildOutput }
  | { type: "failure"; requestId: number; diagnostics: BuildDiagnostic[] };

type PreviewMessage =
  | { source: "preview-runtime"; type: "ready" }
  | {
      source: "preview-runtime";
      type: "inspect-hover";
      selector: string;
      tag: string;
      box: PreviewBox;
    }
  | { source: "preview-runtime"; type: "inspect-hover-clear" }
  | {
      source: "preview-runtime";
      type: "inspect-select";
      payload: InspectedElementPayload;
    }
  | {
      source: "preview-runtime";
      type: "console";
      level: "log" | "warn" | "error";
      args: string[];
    }
  | {
      source: "preview-runtime";
      type: "runtime-error";
      message: string;
      stack?: string;
    };

interface PreviewBox {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
}

interface MatchedCssRuleSummary {
  ruleId?: string;
  selector: string;
  declarations: Record<string, string>;
}

interface InspectedElementPayload {
  previewId?: string;
  selector: string;
  tagName: string;
  id?: string;
  classList: string[];
  attributes: Record<string, string>;
  textPreview?: string;
  source?: SourceLocation & { componentName?: string };
  box: PreviewBox;
  computedStyle: Record<string, string>;
  matchedRules?: MatchedCssRuleSummary[];
}

const supportedExtensions = new Set([
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
]);

export function createWebProjectPreview(
  options: WebProjectPreviewOptions,
): Component {
  return {
    mount(root, scope) {
      const shell = el("div", "nb-web-project nb-web-project--preview-only");
      const preview = el(
        "iframe",
        "nb-web-project__iframe",
      ) as HTMLIFrameElement;
      const overlay = el("div", "nb-web-project__overlay");
      const hoverBox = el("div", "nb-web-project__inspect-box");
      const selectedBox = el("div", "nb-web-project__active-inspect-box");
      const toolbar = el("div", "nb-web-project__toolbar");
      const inspectButton = el(
        "button",
        "nb-web-project__tool",
        "Inspect",
      ) as HTMLButtonElement;
      const inspectorPanel = el("aside", "nb-web-project__inspector");
      const diagnostics = el("div", "nb-web-project__diagnostics");
      const consoleOutput = el("div", "nb-web-project__console-output");

      preview.sandbox.add("allow-scripts");
      preview.referrerPolicy = "no-referrer";
      hoverBox.hidden = true;
      selectedBox.hidden = true;
      toolbar.append(inspectButton);
      overlay.append(hoverBox, selectedBox);
      shell.append(
        preview,
        overlay,
        toolbar,
        inspectorPanel,
        diagnostics,
        consoleOutput,
      );
      root.replaceChildren(shell);

      const buildWorker = new PreviewBuildWorker();
      let buildRequestId = 0;
      let latestProject: ProjectState | undefined;
      let latestBuild: BuildOutput | undefined;
      let inspectMode = false;
      let selectedElement: InspectedElementPayload | undefined;
      scope.add(disposable(() => buildWorker.terminate()));

      buildWorker.addEventListener(
        "message",
        (event: MessageEvent<WorkerResponse>) => {
          const response = event.data;
          if (response.requestId !== buildRequestId) return;
          if (response.type === "failure") {
            renderDiagnostics(response.diagnostics);
            return;
          }
          latestBuild = response.output;
          renderDiagnostics(response.output.diagnostics);
          if (
            latestProject &&
            response.output.css &&
            pendingBuildMode === "css-only"
          ) {
            preview.contentWindow?.postMessage(
              { type: "css-update", css: response.output.css },
              "*",
            );
          } else {
            preview.srcdoc = response.output.html;
          }
          pendingBuildMode = undefined;
        },
      );

      let pendingBuildMode: "full" | "css-only" | undefined;

      const toggleInspectMode = () => {
        inspectMode = !inspectMode;
        shell.classList.toggle("is-inspecting", inspectMode);
        inspectButton.classList.toggle("is-active", inspectMode);
        inspectButton.setAttribute(
          "aria-pressed",
          inspectMode ? "true" : "false",
        );
        preview.contentWindow?.postMessage(
          { type: inspectMode ? "inspector-enable" : "inspector-disable" },
          "*",
        );
        if (!inspectMode) {
          selectedElement = undefined;
          positionHoverOverlay();
          positionSelectedOverlay();
          renderInspectorPanel();
        }
      };
      inspectButton.type = "button";
      inspectButton.setAttribute("aria-pressed", "false");
      inspectButton.addEventListener("click", toggleInspectMode);
      scope.add(
        disposable(() =>
          inspectButton.removeEventListener("click", toggleInspectMode),
        ),
      );

      const onPreviewMessage = (event: MessageEvent) => {
        if (event.source !== preview.contentWindow) return;
        if (!isPreviewMessage(event.data)) return;
        if (event.data.type === "ready" && inspectMode) {
          preview.contentWindow?.postMessage({ type: "inspector-enable" }, "*");
        }
        if (event.data.type === "inspect-hover") {
          positionHoverOverlay(event.data.box);
        }
        if (event.data.type === "inspect-hover-clear") {
          positionHoverOverlay();
        }
        if (event.data.type === "inspect-select") {
          selectedElement = sanitizeInspectedPayload(event.data.payload);
          positionHoverOverlay();
          positionSelectedOverlay(selectedElement?.box);
          renderInspectorPanel();
        }
        if (event.data.type === "runtime-error") {
          renderDiagnostics([
            {
              text: event.data.stack ?? event.data.message,
              location: "runtime",
            },
          ]);
        }
        if (event.data.type === "console" && event.data.level === "error") {
          appendConsole(event.data.args.join(" "));
        }
      };
      window.addEventListener("message", onPreviewMessage);
      scope.add(
        disposable(() =>
          window.removeEventListener("message", onPreviewMessage),
        ),
      );

      void loadAndBuild();

      const onWebFileSaved = (event: Event) => {
        const detail = (event as CustomEvent<{ filePath?: string }>).detail;
        const changedPath = detail?.filePath;
        if (!changedPath || !isPathInside(options.rootPath, changedPath))
          return;
        void loadAndBuild(
          fileExtension(changedPath) === ".css" ? "css-only" : "full",
        );
      };
      window.addEventListener("nb:web-file-saved", onWebFileSaved);
      scope.add(
        disposable(() =>
          window.removeEventListener("nb:web-file-saved", onWebFileSaved),
        ),
      );

      async function loadAndBuild(mode: "full" | "css-only" = "full") {
        try {
          const project = await readProjectState(options.rootPath);
          latestProject = project;
          buildRequestId += 1;
          pendingBuildMode = mode;
          buildWorker.postMessage({
            type: "build",
            requestId: buildRequestId,
            project,
            mode,
          });
        } catch (error) {
          renderDiagnostics([{ text: errorMessage(error) }]);
        }
      }

      function renderDiagnostics(items: readonly BuildDiagnostic[]) {
        diagnostics.replaceChildren();
        for (const item of items) {
          const row = el("div", "nb-web-project__diagnostic");
          row.textContent = item.location
            ? `${item.location}: ${item.text}`
            : item.text;
          diagnostics.append(row);
        }
      }

      function appendConsole(text: string) {
        const row = el("div", "nb-web-project__console-row is-error");
        row.textContent = text;
        consoleOutput.append(row);
      }

      function positionHoverOverlay(box?: PreviewBox) {
        if (!box || !inspectMode) {
          hoverBox.removeAttribute("style");
          hoverBox.hidden = true;
          return;
        }
        hoverBox.hidden = false;
        hoverBox.style.left = `${box.left}px`;
        hoverBox.style.top = `${box.top}px`;
        hoverBox.style.width = `${box.width}px`;
        hoverBox.style.height = `${box.height}px`;
      }

      function positionSelectedOverlay(box?: PreviewBox) {
        if (!box || !inspectMode || !selectedElement) {
          selectedBox.removeAttribute("style");
          selectedBox.hidden = true;
          return;
        }

        selectedBox.hidden = false;
        selectedBox.style.left = `${box.left - selectedOverlayPadding}px`;
        selectedBox.style.top = `${box.top - selectedOverlayPadding}px`;
        selectedBox.style.width = `${box.width + selectedOverlayPadding * 2}px`;
        selectedBox.style.height = `${box.height + selectedOverlayPadding * 2}px`;
      }

      function renderInspectorPanel() {
        inspectorPanel.replaceChildren();
        shell.classList.toggle(
          "has-inspector-selection",
          Boolean(selectedElement),
        );
        if (!selectedElement) return;

        const heading = el("div", "nb-web-project__inspector-heading");
        const title = el("div", "nb-web-project__inspector-title");
        title.textContent = elementLabel(selectedElement);
        const selector = el("div", "nb-web-project__inspector-subtitle");
        selector.textContent = selectedElement.selector;
        heading.append(title, selector);

        const sourceButton = el(
          "button",
          "nb-web-project__source-button",
        ) as HTMLButtonElement;
        sourceButton.type = "button";
        sourceButton.textContent = selectedElement.source
          ? `${selectedElement.source.file}:${selectedElement.source.line}`
          : "No source location";
        sourceButton.disabled = !selectedElement.source;
        sourceButton.addEventListener("click", () => {
          if (selectedElement?.source)
            options.onOpenSource?.(selectedElement.source);
        });

        const rules = matchedProjectRules(
          selectedElement,
          latestBuild?.cssRules ?? [],
        );
        const ruleSection = el("section", "nb-web-project__inspector-section");
        const ruleTitle = el(
          "h3",
          "nb-web-project__inspector-section-title",
          "Matched rules",
        );
        const ruleList = el("div", "nb-web-project__rule-list");
        if (rules.length) {
          for (const rule of rules) {
            const row = el("div", "nb-web-project__rule-row");
            row.textContent = `${rule.selector}  ${rule.file}:${rule.startLine}`;
            ruleList.append(row);
          }
        } else {
          const empty = el("div", "nb-web-project__inspector-empty");
          empty.textContent = "No editable project CSS rule matched.";
          ruleList.append(empty);
        }
        ruleSection.append(ruleTitle, ruleList);

        const styleSection = el("section", "nb-web-project__inspector-section");
        const styleTitle = el(
          "h3",
          "nb-web-project__inspector-section-title",
          "Styles",
        );
        const styleGrid = el("div", "nb-web-project__style-grid");
        for (const property of editableStyleProperties) {
          const label = el("label", "nb-web-project__style-field");
          if (isLongStyleProperty(property)) {
            label.classList.add("nb-web-project__style-field--wide");
          }
          const name = el("span", "nb-web-project__style-name", property);
          const control = el("div", "nb-web-project__style-control");
          const input = el(
            "input",
            "nb-web-project__style-input",
          ) as HTMLInputElement;
          input.value = selectedElement.computedStyle[property] ?? "";
          bindStyleInputAutosave(input, property);
          control.append(input);

          if (
            isColorStyleProperty(property) &&
            parseColorOrUndefined(input.value)
          ) {
            const swatch = el(
              "button",
              "nb-web-project__color-swatch",
            ) as HTMLButtonElement;
            const popover = el("div", "nb-web-project__color-popover");
            let pickerReady = false;
            let colorPatchTimer: number | undefined;
            swatch.type = "button";
            swatch.style.background = input.value;
            popover.hidden = true;
            const picker = new ColorPicker(popover, {
              initial: input.value,
              onChange(color) {
                if (!pickerReady) return;
                input.value = color.css;
                swatch.style.background = color.css;
                if (colorPatchTimer !== undefined) {
                  window.clearTimeout(colorPatchTimer);
                }
                colorPatchTimer = window.setTimeout(() => {
                  void patchSelectedCss(property, color.css);
                }, 120);
              },
            });
            pickerReady = true;
            swatch.addEventListener("click", (event) => {
              event.preventDefault();
              popover.hidden = !popover.hidden;
            });
            input.addEventListener("change", () => {
              const parsed = parseColorOrUndefined(input.value);
              if (!parsed) return;
              picker.setColor(input.value);
              swatch.style.background = input.value;
            });
            control.append(swatch, popover);
          }

          if (isGradientStyleProperty(property)) {
            const gradient = parseLinearGradient(input.value);
            if (gradient) {
              label.classList.add("nb-web-project__style-field--gradient-row");
              input.classList.add("nb-web-project__style-input--gradient-raw");
              control.classList.add("nb-web-project__style-control--gradient");
              const summary = el(
                "button",
                "nb-web-project__gradient-summary",
                gradientLabel(gradient),
              ) as HTMLButtonElement;
              const swatch = el(
                "button",
                "nb-web-project__gradient-swatch",
              ) as HTMLButtonElement;
              const popover = el("div", "nb-web-project__gradient-popover");
              let gradientPatchTimer: number | undefined;
              summary.type = "button";
              swatch.type = "button";
              swatch.style.background = linearGradientToCss(gradient);
              popover.hidden = true;
              new GradientEditor(popover, {
                initial: gradient,
                onClose() {
                  popover.hidden = true;
                },
                onChange(next) {
                  input.value = linearGradientToCss(next);
                  summary.textContent = gradientLabel(next);
                  swatch.style.background = input.value;
                  if (gradientPatchTimer !== undefined) {
                    window.clearTimeout(gradientPatchTimer);
                  }
                  gradientPatchTimer = window.setTimeout(() => {
                    void patchSelectedCss(property, input.value);
                  }, 140);
                },
              });
              input.addEventListener("change", () => {
                const parsed = parseLinearGradient(input.value);
                if (!parsed) return;
                swatch.style.background = linearGradientToCss(parsed);
                popover.replaceChildren();
                new GradientEditor(popover, {
                  initial: parsed,
                  onClose() {
                    popover.hidden = true;
                  },
                  onChange(next) {
                    input.value = linearGradientToCss(next);
                    summary.textContent = gradientLabel(next);
                    swatch.style.background = input.value;
                    void patchSelectedCss(property, input.value);
                  },
                });
              });
              summary.addEventListener("click", (event) => {
                event.preventDefault();
                popover.hidden = !popover.hidden;
              });
              swatch.addEventListener("click", (event) => {
                event.preventDefault();
                popover.hidden = !popover.hidden;
              });
              control.append(summary, swatch, popover);
            }
          }

          label.append(name, control);
          styleGrid.append(label);
        }
        styleSection.append(styleTitle, styleGrid);

        inspectorPanel.append(heading, sourceButton, ruleSection, styleSection);
      }

      async function patchSelectedCss(property: string, value: string) {
        if (!selectedElement || !latestBuild) return;
        if (!isSafeCssDeclarationValue(value)) {
          renderDiagnostics([
            {
              text: "Inspector style values cannot contain semicolons, braces, or control characters.",
              location: "inspector",
            },
          ]);
          return;
        }

        const patch = pickCssPatchTarget(
          selectedElement,
          latestBuild.cssRules,
          property,
          value,
        );
        if (!patch) {
          renderDiagnostics([
            {
              text: "Select an element with a class or matching CSS rule before editing styles.",
              location: "inspector",
            },
          ]);
          return;
        }

        const filePath = fromVirtualPath(options.rootPath, patch.file);
        const current = await window.spaces.readItem(filePath);
        const next = patchCssDeclaration(
          current,
          patch.selector,
          patch.property,
          patch.value,
          patch.startLine,
        );
        if (next === current) return;
        await window.spaces.writeItem(filePath, next);
        window.dispatchEvent(
          new CustomEvent("nb:web-file-external-update", {
            detail: { filePath, value: next },
          }),
        );
        selectedElement.computedStyle[property] = value;
        window.dispatchEvent(
          new CustomEvent("nb:web-file-saved", {
            detail: { filePath },
          }),
        );
      }

      function bindStyleInputAutosave(
        input: HTMLInputElement,
        property: string,
      ) {
        let saveTimer: number | undefined;
        let lastQueuedValue = input.value;

        const queueSave = () => {
          lastQueuedValue = input.value;
          if (saveTimer !== undefined) window.clearTimeout(saveTimer);
          saveTimer = window.setTimeout(() => {
            void patchSelectedCss(property, lastQueuedValue);
          }, inspectorAutosaveDebounceMs);
        };

        input.addEventListener("input", queueSave);
        input.addEventListener("change", queueSave);
      }
    },
  };
}

const selectedOverlayPadding = 3;
const inspectorAutosaveDebounceMs = 220;

const editableStyleProperties = [
  "display",
  "position",
  "margin",
  "padding",
  "color",
  "background",
  "backgroundImage",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "borderRadius",
  "border",
  "borderColor",
  "gap",
  "flexDirection",
  "alignItems",
  "justifyContent",
  "gridTemplateColumns",
];

type RGBA = {
  r: number;
  g: number;
  b: number;
  a: number;
};

type HSVA = {
  h: number;
  s: number;
  v: number;
  a: number;
};

type ColorPickerOptions = {
  initial?: string;
  onChange?: (color: {
    rgba: RGBA;
    hsva: HSVA;
    hex: string;
    css: string;
  }) => void;
};

type GradientStop = {
  color: string;
  position: number;
};

type LinearGradientValue = {
  kind: "linear" | "radial";
  angle: number;
  radialPrefix: string;
  stops: GradientStop[];
};

type GradientEditorOptions = {
  initial: LinearGradientValue;
  onClose?: () => void;
  onChange?: (gradient: LinearGradientValue) => void;
};

class ColorPicker {
  private root: HTMLElement;
  private sv: HTMLDivElement;
  private svHandle: HTMLDivElement;
  private hue: HTMLDivElement;
  private hueHandle: HTMLDivElement;
  private alpha: HTMLDivElement;
  private alphaFill: HTMLDivElement;
  private alphaHandle: HTMLDivElement;

  private hsva: HSVA = {
    h: 310,
    s: 0.75,
    v: 0.9,
    a: 0.75,
  };

  private onChange?: ColorPickerOptions["onChange"];

  constructor(container: HTMLElement, options: ColorPickerOptions = {}) {
    this.onChange = options.onChange;

    if (options.initial) {
      this.hsva = rgbaToHsva(parseColor(options.initial));
    }

    this.root = document.createElement("div");
    this.root.className = "cp";

    this.sv = document.createElement("div");
    this.sv.className = "cp-sv";

    this.svHandle = document.createElement("div");
    this.svHandle.className = "cp-handle cp-sv-handle";
    this.sv.appendChild(this.svHandle);

    this.hue = document.createElement("div");
    this.hue.className = "cp-hue";

    this.hueHandle = document.createElement("div");
    this.hueHandle.className = "cp-handle cp-hue-handle";
    this.hue.appendChild(this.hueHandle);

    this.alpha = document.createElement("div");
    this.alpha.className = "cp-alpha";

    this.alphaFill = document.createElement("div");
    this.alphaFill.className = "cp-alpha-fill";

    this.alphaHandle = document.createElement("div");
    this.alphaHandle.className = "cp-handle cp-alpha-handle";

    this.alpha.append(this.alphaFill, this.alphaHandle);

    this.root.append(this.sv, this.hue, this.alpha);
    container.appendChild(this.root);

    this.bindDrag(this.sv, this.setSV);
    this.bindDrag(this.hue, this.setHue);
    this.bindDrag(this.alpha, this.setAlpha);

    this.render();
    this.emit();
  }

  setColor(input: string) {
    this.hsva = rgbaToHsva(parseColor(input));
    this.render();
    this.emit();
  }

  getColor() {
    const rgba = hsvaToRgba(this.hsva);
    return {
      rgba,
      hsva: { ...this.hsva },
      hex: rgbaToHex(rgba),
      css: rgbaToCss(rgba),
    };
  }

  destroy() {
    this.root.remove();
  }

  private setSV = (x: number, y: number, rect: DOMRect) => {
    this.hsva.s = clamp(x / rect.width);
    this.hsva.v = clamp(1 - y / rect.height);
    this.render();
    this.emit();
  };

  private setHue = (x: number, _y: number, rect: DOMRect) => {
    this.hsva.h = clamp(x / rect.width) * 360;
    this.render();
    this.emit();
  };

  private setAlpha = (x: number, _y: number, rect: DOMRect) => {
    this.hsva.a = clamp(x / rect.width);
    this.render();
    this.emit();
  };

  private bindDrag(
    element: HTMLElement,
    handler: (x: number, y: number, rect: DOMRect) => void,
  ) {
    const move = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      handler(event.clientX - rect.left, event.clientY - rect.top, rect);
    };

    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      move(event);

      const onMove = (moveEvent: PointerEvent) => move(moveEvent);
      const onUp = () => {
        element.removeEventListener("pointermove", onMove);
        element.removeEventListener("pointerup", onUp);
        element.removeEventListener("pointercancel", onUp);
      };

      element.addEventListener("pointermove", onMove);
      element.addEventListener("pointerup", onUp);
      element.addEventListener("pointercancel", onUp);
    });
  }

  private render() {
    const { h, s, v, a } = this.hsva;
    const hueColor = `hsl(${h} 100% 50%)`;
    const opaque = hsvaToRgba({ h, s, v, a: 1 });

    this.sv.style.background = `
      linear-gradient(to top, black, transparent),
      linear-gradient(to right, white, transparent),
      ${hueColor}
    `;

    this.svHandle.style.left = `${s * 100}%`;
    this.svHandle.style.top = `${(1 - v) * 100}%`;

    this.hueHandle.style.left = `${(h / 360) * 100}%`;

    this.alphaFill.style.background = `
      linear-gradient(
        to right,
        rgba(${opaque.r}, ${opaque.g}, ${opaque.b}, 0),
        rgba(${opaque.r}, ${opaque.g}, ${opaque.b}, 1)
      )
    `;

    this.alphaHandle.style.left = `${a * 100}%`;
  }

  private emit() {
    this.onChange?.(this.getColor());
  }
}

class GradientEditor {
  private root: HTMLElement;
  private preview: HTMLDivElement;
  private stopsList: HTMLDivElement;
  private angleInput: HTMLInputElement;
  private gradient: LinearGradientValue;
  private onClose?: GradientEditorOptions["onClose"];
  private onChange?: GradientEditorOptions["onChange"];

  constructor(container: HTMLElement, options: GradientEditorOptions) {
    this.gradient = cloneGradient(options.initial);
    this.onClose = options.onClose;
    this.onChange = options.onChange;

    this.root = document.createElement("div");
    this.root.className = "ge";

    const titlebar = document.createElement("div");
    titlebar.className = "ge-titlebar";
    const title = document.createElement("div");
    title.className = "ge-title";
    title.textContent = "Gradient";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ge-icon-button";
    close.textContent = "x";
    titlebar.append(title, close);

    const header = document.createElement("div");
    header.className = "ge-header";

    const type = document.createElement("select");
    type.className = "ge-select";
    const linear = document.createElement("option");
    linear.value = "linear";
    linear.textContent = "Linear";
    const radial = document.createElement("option");
    radial.value = "radial";
    radial.textContent = "Radial";
    type.append(linear, radial);
    type.value = this.gradient.kind;

    const angleWrap = document.createElement("label");
    angleWrap.className = "ge-angle";
    this.angleInput = document.createElement("input");
    this.angleInput.type = "number";
    this.angleInput.min = "0";
    this.angleInput.max = "360";
    this.angleInput.step = "1";
    this.angleInput.value = String(Math.round(this.gradient.angle));
    this.angleInput.disabled = this.gradient.kind === "radial";
    const angleUnit = document.createElement("span");
    angleUnit.textContent = "deg";
    angleWrap.append(this.angleInput, angleUnit);

    header.append(type, angleWrap);

    this.preview = document.createElement("div");
    this.preview.className = "ge-preview";

    const stopsHeader = document.createElement("div");
    stopsHeader.className = "ge-stops-header";
    const stopsLabel = document.createElement("span");
    stopsLabel.textContent = "Stops";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "ge-add";
    add.textContent = "+";
    stopsHeader.append(stopsLabel, add);

    this.stopsList = document.createElement("div");
    this.stopsList.className = "ge-stops";

    this.root.append(
      titlebar,
      header,
      this.preview,
      stopsHeader,
      this.stopsList,
    );
    container.append(this.root);

    close.addEventListener("click", () => this.onClose?.());

    type.addEventListener("change", () => {
      this.gradient.kind = type.value === "radial" ? "radial" : "linear";
      this.angleInput.disabled = this.gradient.kind === "radial";
      this.render();
      this.emit();
    });

    this.angleInput.addEventListener("change", () => {
      this.gradient.angle = normalizeDegrees(Number(this.angleInput.value));
      this.render();
      this.emit();
    });

    add.addEventListener("click", () => {
      this.gradient.stops.push({
        color: "#ffffff",
        position: midpointStopPosition(this.gradient.stops),
      });
      this.sortStops();
      this.render();
      this.emit();
    });

    this.render();
  }

  private render() {
    this.sortStops();
    this.preview.style.background = linearGradientToCss(this.gradient);
    this.preview.replaceChildren();
    this.stopsList.replaceChildren();

    this.gradient.stops.forEach((stop, index) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "ge-preview-stop";
      handle.style.left = `${stop.position}%`;
      handle.style.background = stop.color;
      this.bindStopDrag(handle, stop);
      this.preview.append(handle);

      const row = document.createElement("div");
      row.className = "ge-stop";

      const position = document.createElement("input");
      position.className = "ge-stop-position";
      position.type = "number";
      position.min = "0";
      position.max = "100";
      position.step = "1";
      position.value = String(Math.round(stop.position));

      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "ge-stop-swatch";
      swatch.style.background = stop.color;

      const color = document.createElement("input");
      color.className = "ge-stop-color";
      color.value = colorInputValue(stop.color);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ge-remove";
      remove.textContent = "-";
      remove.disabled = this.gradient.stops.length <= 2;

      const pickerHost = document.createElement("div");
      pickerHost.className = "nb-web-project__color-popover ge-color-popover";
      pickerHost.hidden = true;
      let pickerReady = false;
      if (parseColorOrUndefined(stop.color)) {
        new ColorPicker(pickerHost, {
          initial: stop.color,
          onChange: (nextColor) => {
            if (!pickerReady) return;
            stop.color = nextColor.css;
            color.value = colorInputValue(nextColor.css);
            swatch.style.background = nextColor.css;
            this.renderPreviewOnly();
            this.emit();
          },
        });
        pickerReady = true;
      }

      swatch.addEventListener("click", (event) => {
        event.preventDefault();
        pickerHost.hidden = !pickerHost.hidden;
      });

      color.addEventListener("change", () => {
        const nextColor = normalizeColorInput(color.value);
        if (!nextColor) return;
        stop.color = nextColor;
        color.value = colorInputValue(nextColor);
        this.render();
        this.emit();
      });

      position.addEventListener("change", () => {
        stop.position = clamp(Number(position.value), 0, 100);
        this.render();
        this.emit();
      });

      remove.addEventListener("click", () => {
        this.gradient.stops.splice(index, 1);
        this.render();
        this.emit();
      });

      const opacity = document.createElement("input");
      opacity.className = "ge-stop-opacity";
      opacity.type = "number";
      opacity.min = "0";
      opacity.max = "100";
      opacity.step = "1";
      opacity.value = String(
        Math.round((parseColorOrUndefined(stop.color)?.a ?? 1) * 100),
      );

      opacity.addEventListener("change", () => {
        const parsed = parseColorOrUndefined(stop.color);
        if (!parsed) return;
        stop.color = rgbaToCss({
          ...parsed,
          a: clamp(Number(opacity.value), 0, 100) / 100,
        });
        this.render();
        this.emit();
      });

      row.append(position, swatch, color, opacity, remove, pickerHost);
      this.stopsList.append(row);
    });
  }

  private renderPreviewOnly() {
    this.preview.style.background = linearGradientToCss(this.gradient);
  }

  private bindStopDrag(handle: HTMLElement, stop: GradientStop) {
    const move = (event: PointerEvent) => {
      const rect = this.preview.getBoundingClientRect();
      stop.position = clamp(
        ((event.clientX - rect.left) / rect.width) * 100,
        0,
        100,
      );
      handle.style.left = `${stop.position}%`;
      this.renderPreviewOnly();
      this.emit();
    };

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("is-dragging");
      move(event);
      const onMove = (moveEvent: PointerEvent) => move(moveEvent);
      const onUp = () => {
        handle.classList.remove("is-dragging");
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        this.render();
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  private sortStops() {
    this.gradient.stops.sort((a, b) => a.position - b.position);
  }

  private emit() {
    this.onChange?.(cloneGradient(this.gradient));
  }
}

async function readProjectState(rootPath: string): Promise<ProjectState> {
  const items = await window.spaces.items();
  const rootNode = findNode(items, rootPath);
  if (!rootNode || rootNode.kind !== "folder") {
    throw new Error(`Web folder not found: ${rootPath}`);
  }

  const files: Record<string, ProjectFile> = {};
  for (const item of flattenFiles(rootNode.children ?? [])) {
    if (!supportedExtensions.has(fileExtension(item.name))) continue;
    const virtualPath = toVirtualPath(relativePath(rootPath, item.id));
    files[virtualPath] = {
      path: virtualPath,
      language: languageForPath(item.name),
      content: await window.spaces.readItem(item.id),
      dirty: false,
    };
  }

  const dependencies = dependenciesFromPackageJson(
    files["/package.json"]?.content,
  );
  return {
    files,
    entry: pickEntry(files),
    dependencies,
  };
}

function flattenFiles(items: readonly SpaceItem[]): SpaceItem[] {
  const files: SpaceItem[] = [];
  for (const item of items) {
    if (item.kind === "file") files.push(item);
    else files.push(...flattenFiles(item.children ?? []));
  }
  return files;
}

function findNode(
  nodes: readonly SpaceItem[],
  id: string,
): SpaceItem | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children ?? [], id);
    if (child) return child;
  }
  return undefined;
}

function dependenciesFromPackageJson(content: string | undefined) {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Object.fromEntries(
      Object.entries({
        ...(parsed.dependencies ?? {}),
        ...(parsed.devDependencies ?? {}),
      }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function pickEntry(files: Record<string, ProjectFile>) {
  const preferred = [
    "/index.html",
    "/src/main.tsx",
    "/src/main.jsx",
    "/src/main.ts",
    "/src/main.js",
    "/main.tsx",
    "/main.jsx",
    "/main.ts",
    "/main.js",
  ];
  return preferred.find((path) => files[path]) ?? Object.keys(files)[0] ?? "/";
}

function languageForPath(fileName: string): ProjectLanguage {
  const extension = fileExtension(fileName);
  if (extension === ".html") return "html";
  if (extension === ".css") return "css";
  if (extension === ".json") return "json";
  if (extension === ".ts" || extension === ".tsx") return "typescript";
  return "javascript";
}

function fileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function relativePath(root: string, path: string) {
  const normalizedRoot = normalizePath(root).replace(/\/$/, "");
  const normalizedPath = normalizePath(path);
  if (normalizedPath === normalizedRoot) return "";
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function toVirtualPath(path: string) {
  return `/${normalizePath(path).replace(/^\/+/, "")}`;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

function isPreviewMessage(value: unknown): value is PreviewMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as { source?: unknown; type?: unknown };
  return (
    message.source === "preview-runtime" && typeof message.type === "string"
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeInspectedPayload(
  payload: InspectedElementPayload,
): InspectedElementPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (
    typeof payload.selector !== "string" ||
    typeof payload.tagName !== "string"
  ) {
    return undefined;
  }
  return {
    previewId: optionalString(payload.previewId, 100),
    selector: payload.selector.slice(0, 300),
    tagName: payload.tagName.slice(0, 40),
    id: optionalString(payload.id, 120),
    classList: Array.isArray(payload.classList)
      ? payload.classList
          .filter((item) => typeof item === "string")
          .slice(0, 100)
      : [],
    attributes: safeStringRecord(payload.attributes, 50, 500),
    textPreview: optionalString(payload.textPreview, 200),
    source: sanitizeSource(payload.source),
    box: sanitizeBox(payload.box),
    computedStyle: safeStringRecord(payload.computedStyle, 40, 500),
    matchedRules: Array.isArray(payload.matchedRules)
      ? payload.matchedRules
          .filter((rule) => rule && typeof rule.selector === "string")
          .slice(0, 20)
          .map((rule) => ({
            ruleId: optionalString(rule.ruleId, 100),
            selector: rule.selector.slice(0, 300),
            declarations: safeStringRecord(rule.declarations, 80, 500),
          }))
      : [],
  };
}

function sanitizeSource(
  source: InspectedElementPayload["source"],
): InspectedElementPayload["source"] | undefined {
  if (!source || !isSafeVirtualPath(source.file)) return undefined;
  return {
    file: source.file.slice(0, 500),
    line: positiveInteger(source.line) ?? 1,
    column: positiveInteger(source.column) ?? 1,
    componentName: optionalString(source.componentName, 120),
  };
}

function sanitizeBox(box: PreviewBox): PreviewBox {
  return {
    x: finiteNumber(box?.x),
    y: finiteNumber(box?.y),
    width: finiteNumber(box?.width),
    height: finiteNumber(box?.height),
    top: finiteNumber(box?.top),
    left: finiteNumber(box?.left),
  };
}

function safeStringRecord(
  value: Record<string, string> | undefined,
  maxEntries: number,
  maxValueLength: number,
) {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value)
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
    )
    .slice(0, maxEntries)
    .map(([key, item]) => [key.slice(0, 120), item.slice(0, maxValueLength)]);
  return Object.fromEntries(entries);
}

function optionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value
    ? value.slice(0, maxLength)
    : undefined;
}

function positiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isSafeVirtualPath(value: unknown) {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/") || value.length > 500) return false;
  return !value
    .replace(/\\/g, "/")
    .split("/")
    .some((segment) => segment === "..");
}

function isSafeCssDeclarationValue(value: string) {
  return !/[;{}\u0000-\u001f\u007f]/.test(value);
}

function isColorStyleProperty(property: string) {
  return colorStyleProperties.has(property);
}

function isLongStyleProperty(property: string) {
  return longStyleProperties.has(property);
}

function isGradientStyleProperty(property: string) {
  return gradientStyleProperties.has(property);
}

function elementLabel(payload: InspectedElementPayload) {
  const id = payload.id ? `#${payload.id}` : "";
  const classes = payload.classList
    .slice(0, 3)
    .map((item) => `.${item}`)
    .join("");
  return `${payload.tagName}${id}${classes}`;
}

function matchedProjectRules(
  payload: InspectedElementPayload,
  rules: readonly CssRuleOrigin[],
) {
  const rulesById = new Map(rules.map((rule) => [rule.ruleId, rule]));
  const exactMatches: CssRuleOrigin[] = [];
  const usedIds = new Set<string>();

  for (const matched of payload.matchedRules ?? []) {
    if (!matched.ruleId) continue;
    const rule = rulesById.get(matched.ruleId);
    if (!rule || usedIds.has(rule.ruleId)) continue;
    exactMatches.push(rule);
    usedIds.add(rule.ruleId);
  }

  if (exactMatches.length) return exactMatches;

  const matchedSelectors = new Set(
    (payload.matchedRules ?? []).map((rule) => rule.selector),
  );
  return rules.filter((rule) => matchedSelectors.has(rule.selector));
}

function pickCssPatchTarget(
  payload: InspectedElementPayload,
  rules: readonly CssRuleOrigin[],
  property: string,
  value: string,
) {
  const matched = matchedProjectRules(payload, rules);
  const cssName = cssPropertyName(property);
  const existingDeclaration = [...matched]
    .reverse()
    .find((rule) => cssName in rule.declarations);
  const target = existingDeclaration ?? matched[matched.length - 1];
  if (target) {
    return {
      file: target.file,
      selector: target.selector,
      property,
      value,
      startLine: target.startLine,
    };
  }

  const className = payload.classList.find(Boolean);
  const firstCssFile = rules[0]?.file ?? "/src/styles.css";
  if (!className) return undefined;
  return {
    file: firstCssFile,
    selector: `.${cssIdentifier(className)}`,
    property,
    value,
    startLine: undefined,
  };
}

function patchCssDeclaration(
  css: string,
  selector: string,
  property: string,
  value: string,
  startLine?: number,
) {
  const searchStart = startLine ? offsetForLine(css, startLine) : 0;
  let selectorIndex = css.indexOf(selector, searchStart);
  if (selectorIndex < 0 && searchStart > 0) {
    selectorIndex = css.indexOf(selector);
  }
  if (selectorIndex < 0) {
    return `${css.trimEnd()}\n\n${selector} {\n  ${cssPropertyName(property)}: ${value};\n}\n`;
  }

  const open = css.indexOf("{", selectorIndex);
  const close = open >= 0 ? css.indexOf("}", open) : -1;
  if (open < 0 || close < 0) {
    return `${css.trimEnd()}\n\n${selector} {\n  ${cssPropertyName(property)}: ${value};\n}\n`;
  }

  const before = css.slice(0, open + 1);
  const block = css.slice(open + 1, close);
  const after = css.slice(close);
  const cssName = cssPropertyName(property);
  const declarationPattern = new RegExp(
    `(^|;)\\s*${escapeRegExp(cssName)}\\s*:[^;]*`,
    "m",
  );
  const nextBlock = declarationPattern.test(block)
    ? block.replace(declarationPattern, (_match, prefix: string) => {
        return `${prefix}\n  ${cssName}: ${value}`;
      })
    : `${block.trimEnd()}\n  ${cssName}: ${value};\n`;
  return `${before}${nextBlock}${after}`;
}

function offsetForLine(text: string, line: number) {
  if (line <= 1) return 0;
  let currentLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    currentLine += 1;
    if (currentLine === line) return index + 1;
  }
  return 0;
}

function cssPropertyName(property: string) {
  return property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function cssIdentifier(value: string) {
  return value.replace(/[^_a-zA-Z0-9-]/g, "\\$&");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fromVirtualPath(rootPath: string, virtualPath: string) {
  const relative = normalizePath(virtualPath).replace(/^\/+/, "");
  return `${normalizePath(rootPath).replace(/\/$/, "")}/${relative}`;
}

function isPathInside(rootPath: string, filePath: string) {
  const root = normalizePath(rootPath).replace(/\/$/, "");
  const file = normalizePath(filePath);
  return file === root || file.startsWith(`${root}/`);
}

const colorStyleProperties = new Set([
  "color",
  "backgroundColor",
  "borderColor",
]);
const gradientStyleProperties = new Set(["background", "backgroundImage"]);
const longStyleProperties = new Set([
  "background",
  "backgroundImage",
  "border",
]);

function parseLinearGradient(input: string): LinearGradientValue | undefined {
  const value = input.trim();
  const match = value.match(/^(linear|radial)-gradient\(([\s\S]*)\)$/i);
  if (!match) return undefined;

  const kind = match[1].toLowerCase() === "radial" ? "radial" : "linear";
  const parts = splitTopLevelCommas(match[2]).map((part) => part.trim());
  if (parts.length < 2) return undefined;

  let angle = 180;
  let radialPrefix = "circle";
  let stopParts = parts;
  const first = parts[0];
  if (kind === "linear") {
    const angleMatch = first.match(/^(-?[\d.]+)deg$/i);
    if (angleMatch) {
      angle = normalizeDegrees(Number(angleMatch[1]));
      stopParts = parts.slice(1);
    } else if (first.toLowerCase().startsWith("to ")) {
      angle = directionToDegrees(first);
      stopParts = parts.slice(1);
    }
  } else if (!parseGradientStop(first, 0, parts.length)) {
    radialPrefix = first || radialPrefix;
    stopParts = parts.slice(1);
  }

  const stops = stopParts
    .map((part, index) => parseGradientStop(part, index, stopParts.length))
    .filter((stop): stop is GradientStop => Boolean(stop));
  if (stops.length < 2) return undefined;
  return { kind, angle, radialPrefix, stops };
}

function parseGradientStop(
  input: string,
  index: number,
  stopCount: number,
): GradientStop | undefined {
  const tokens = splitWhitespaceOutsideFunctions(input);
  if (!tokens.length) return undefined;
  const last = tokens[tokens.length - 1];
  const percentMatch = last.match(/^(-?[\d.]+)%$/);
  const position = percentMatch
    ? clamp(Number(percentMatch[1]), 0, 100)
    : stopCount <= 1
      ? 0
      : (index / (stopCount - 1)) * 100;
  const color = percentMatch ? tokens.slice(0, -1).join(" ") : input;
  if (!parseColorOrUndefined(color.trim())) return undefined;
  return {
    color: color.trim(),
    position,
  };
}

function linearGradientToCss(gradient: LinearGradientValue) {
  const stops = gradient.stops
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((stop) => `${stop.color} ${Math.round(stop.position)}%`)
    .join(", ");
  if (gradient.kind === "radial") {
    return `radial-gradient(${gradient.radialPrefix || "circle"}, ${stops})`;
  }
  return `linear-gradient(${Math.round(normalizeDegrees(gradient.angle))}deg, ${stops})`;
}

function gradientLabel(gradient: LinearGradientValue) {
  return gradient.kind === "radial" ? "Radial" : "Linear";
}

function splitTopLevelCommas(input: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of input) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);

    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function splitWhitespaceOutsideFunctions(input: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of input.trim()) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);

    if (/\s/.test(character) && depth === 0) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function directionToDegrees(direction: string) {
  switch (direction.toLowerCase()) {
    case "to top":
      return 0;
    case "to top right":
    case "to right top":
      return 45;
    case "to right":
      return 90;
    case "to bottom right":
    case "to right bottom":
      return 135;
    case "to bottom":
      return 180;
    case "to bottom left":
    case "to left bottom":
      return 225;
    case "to left":
      return 270;
    case "to top left":
    case "to left top":
      return 315;
    default:
      return 180;
  }
}

function normalizeDegrees(value: number) {
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

function cloneGradient(gradient: LinearGradientValue): LinearGradientValue {
  return {
    kind: gradient.kind,
    angle: gradient.angle,
    radialPrefix: gradient.radialPrefix,
    stops: gradient.stops.map((stop) => ({ ...stop })),
  };
}

function midpointStopPosition(stops: readonly GradientStop[]) {
  if (stops.length < 2) return 50;
  const sorted = stops.slice().sort((a, b) => a.position - b.position);
  let widestStart = sorted[0];
  let widestEnd = sorted[1];
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (
      end.position - start.position >
      widestEnd.position - widestStart.position
    ) {
      widestStart = start;
      widestEnd = end;
    }
  }
  return Math.round((widestStart.position + widestEnd.position) / 2);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function hsvaToRgba({ h, s, v, a }: HSVA): RGBA {
  const normalizedHue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (normalizedHue < 60) [r, g, b] = [c, x, 0];
  else if (normalizedHue < 120) [r, g, b] = [x, c, 0];
  else if (normalizedHue < 180) [r, g, b] = [0, c, x];
  else if (normalizedHue < 240) [r, g, b] = [0, x, c];
  else if (normalizedHue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: Number(a.toFixed(3)),
  };
}

function rgbaToHsva({ r, g, b, a }: RGBA): HSVA {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }

  if (h < 0) h += 360;

  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
    a,
  };
}

function rgbaToHex({ r, g, b, a }: RGBA) {
  const toHex = (value: number) => value.toString(16).padStart(2, "0");
  const alpha = Math.round(a * 255);

  return `#${toHex(r)}${toHex(g)}${toHex(b)}${alpha < 255 ? toHex(alpha) : ""}`;
}

function rgbaToCss({ r, g, b, a }: RGBA) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function colorInputValue(input: string) {
  const parsed = parseColorOrUndefined(input);
  if (!parsed) return input;
  return rgbaToHex(parsed).replace(/^#/, "").toUpperCase();
}

function normalizeColorInput(input: string) {
  const value = input.trim();
  if (/^[0-9a-fA-F]{3,8}$/.test(value)) return `#${value}`;
  return parseColorOrUndefined(value) ? value : undefined;
}

function parseColorOrUndefined(input: string) {
  try {
    return parseColor(input);
  } catch {
    return undefined;
  }
}

function parseColor(input: string): RGBA {
  const rawValue = input.trim();
  const value = /^[0-9a-fA-F]{3,8}$/.test(rawValue) ? `#${rawValue}` : rawValue;

  if (value.startsWith("#")) {
    const hex = value.slice(1);

    if (![3, 4, 6, 8].includes(hex.length)) {
      throw new Error("Invalid hex color.");
    }

    const normalized =
      hex.length <= 4
        ? hex
            .split("")
            .map((character) => character + character)
            .join("")
        : hex;

    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    const a =
      normalized.length === 8 ? parseInt(normalized.slice(6, 8), 16) / 255 : 1;

    if ([r, g, b, a].some((channel) => Number.isNaN(channel))) {
      throw new Error("Invalid hex color.");
    }

    return {
      r: clamp(Math.round(r), 0, 255),
      g: clamp(Math.round(g), 0, 255),
      b: clamp(Math.round(b), 0, 255),
      a: clamp(a),
    };
  }

  const rgbaMatch = value.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/,
  );

  if (rgbaMatch) {
    return {
      r: clamp(Math.round(Number(rgbaMatch[1])), 0, 255),
      g: clamp(Math.round(Number(rgbaMatch[2])), 0, 255),
      b: clamp(Math.round(Number(rgbaMatch[3])), 0, 255),
      a: rgbaMatch[4] === undefined ? 1 : clamp(Number(rgbaMatch[4])),
    };
  }

  throw new Error("Unsupported color format.");
}
