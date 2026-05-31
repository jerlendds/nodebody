import { browser, expect } from "@wdio/globals";

describe("markdown editor context menu", () => {
  beforeEach(async () => {
    await closeSyntheticMenu();
    await browser.$(".nb-pane__surface").waitForDisplayed();
    await browser.$(".cm-content").waitForDisplayed();
  });

  afterEach(async () => {
    await closeSyntheticMenu();
  });

  it("opens the styled synthetic menu on one right click over selected CodeMirror text", async () => {
    await selectFirstEditorLineText();
    const selectedText = await currentSelectedText();
    expect(selectedText.length).toBeGreaterThan(0);

    await rightClickSelectedTextOnce();
    const menu = await waitForSyntheticMenuSnapshot();

    expect(menu.labels).toEqual(["Copy", "Cut", "Paste"]);
    expect(await currentSelectedText()).toBe(selectedText);
    expect(menu.position).toBe("fixed");
    expect(menu.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });
});

async function selectFirstEditorLineText() {
  await browser.execute(() => {
    const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
      .find((candidate) => candidate.textContent?.trim());

    if (!line) throw new Error("No populated CodeMirror line found.");

    const range = document.createRange();
    range.selectNodeContents(line);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await browser.waitUntil(async () => (await currentSelectedText()).length > 0);
}

async function currentSelectedText() {
  return browser.execute(() => window.getSelection()?.toString() ?? "");
}

async function closeSyntheticMenu() {
  await browser.keys("Escape");
  await browser.waitUntil(
    async () =>
      browser.execute(
        () => !document.querySelector<HTMLElement>(".nb-context-menu"),
      ),
    { timeout: 500, interval: 25 },
  );
}

async function rightClickSelectedTextOnce() {
  const point = await browser.execute(() => {
    const selection = window.getSelection();
    const rect =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).getBoundingClientRect()
        : document.querySelector(".cm-line")?.getBoundingClientRect();

    if (!rect) throw new Error("No selected text rectangle found.");

    return {
      x: Math.round(rect.left + Math.max(4, Math.min(rect.width / 2, 24))),
      y: Math.round(rect.top + Math.max(4, Math.min(rect.height / 2, 12))),
    };
  });

  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ origin: "viewport", x: point.x, y: point.y })
    .down({ button: 2 })
    .up({ button: 2 })
    .perform();
}

interface SyntheticMenuSnapshot {
  displayed: boolean;
  labels: string[];
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  display: string;
  visibility: string;
  opacity: string;
  position: string;
  backgroundColor: string;
}

async function waitForSyntheticMenuSnapshot() {
  let snapshot: SyntheticMenuSnapshot | undefined;

  await browser.waitUntil(
    async () => {
      snapshot = await syntheticMenuSnapshot();
      return Boolean(snapshot?.displayed && snapshot.labels.length >= 3);
    },
    {
      timeout: 1500,
      timeoutMsg: `Synthetic context menu did not display: ${JSON.stringify(
        snapshot,
      )}`,
    },
  );

  return snapshot!;
}

async function syntheticMenuSnapshot() {
  return browser.execute(() => {
    const menu = document.querySelector<HTMLElement>(".nb-context-menu");
    if (!menu) return undefined;

    const rect = menu.getBoundingClientRect();
    const styles = getComputedStyle(menu);

    return {
      displayed:
        styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        Number(styles.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0,
      labels: Array.from(
        menu.querySelectorAll<HTMLElement>(".nb-context-menu__label"),
        (label) => label.textContent ?? "",
      ),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity,
      position: styles.position,
      backgroundColor: styles.backgroundColor,
    };
  });
}
