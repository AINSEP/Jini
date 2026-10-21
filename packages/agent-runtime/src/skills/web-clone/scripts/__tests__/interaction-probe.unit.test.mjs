import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  candidates,
  captureAction,
  freshPage,
  hashSnapshot,
  hasChanged,
  main,
  markdown,
  parseArgs,
  planActions,
  safeFileName,
  shortHash,
  snapshot,
  summarizeFindings,
} from "../interaction-probe.mjs";
import {
  browserEnv,
  createFakeBrowser,
  createFakePage,
  createOutput,
  el,
  fakeDocument,
  fakeResponse,
  playwrightPorts,
  tempDir,
} from "./fakes-wc2.mjs";

/** A small page: a CTA button, nav links, a summary, an input, a canvas. */
function siteDocument(state = {}) {
  const cta = el({ tag: "button", id: "cta", innerText: "Buy now" });
  const pricing = el({ tag: "a", attrs: { href: "#pricing" }, text: "Pricing", matches: ["a[href]"] });
  const external = el({ tag: "a", href: "https://other.test/x", attrs: { href: "https://other.test/x", "aria-label": "Other" }, matches: ["a[href]"] });
  const sameOrigin = el({ tag: "a", href: "https://example.test/about", attrs: { href: "/about" }, text: "About", matches: ["a[href]"] });
  const nav = el({ tag: "nav", children: [pricing, external, sameOrigin] });
  const menu = el({ tag: "div", id: "has space", attrs: { role: "button", tabindex: "0" }, text: "Menu", matches: ["[role='button']", "[tabindex]"] });
  const summary = el({ tag: "summary", text: "More" });
  const input = el({ tag: "input", attrs: { type: "text" }, matches: ["input"] });
  const hidden = el({ tag: "button", text: "Hidden", style: { visibility: "hidden" } });
  const collapsed = el({ tag: "button", text: "Gone", style: { display: "none" } });
  const tiny = el({ tag: "button", text: "Tiny", rect: { x: 0, y: 0, width: 4, height: 4 } });
  const canvas = el({ tag: "canvas", rect: { x: 10.4, y: 20.6, width: 400, height: 300 } });
  const dialog = el({
    tag: "dialog",
    matches: ["[role='dialog']"],
    style: state.dialogOpen ? {} : { display: "none" },
    rect: state.dialogOpen ? { x: 0, y: 0, width: 300, height: 200 } : { x: 0, y: 0, width: 0, height: 0 },
  });
  const doc = fakeDocument({
    title: "Example",
    body: [cta, nav, menu, summary, input, hidden, collapsed, tiny, canvas, dialog],
    html: { outerHTML: state.dialogOpen ? "<html><dialog open></dialog></html>" : "<html></html>", scrollHeight: 2900 },
  });
  doc.activeElement = cta;
  doc.forms = [{}];
  return doc;
}

function siteEnv(state) {
  const window = {
    get scrollY() {
      return state.scrollY || 0;
    },
    scrollTo: (options) => {
      state.scrollY = options.top;
    },
  };
  return () => browserEnv({ document: siteDocument(state), href: "https://example.test/", window });
}

describe("parseArgs", () => {
  it("applies defaults and numeric flags, falling back when a value is missing", () => {
    expect(parseArgs(["--url", "https://x.test", "--max-clicks", "3", "--width"])).toEqual({
      url: "https://x.test",
      outDir: "RECON/interactions",
      label: "site",
      maxClicks: 3,
      maxHovers: 8,
      waitMs: 800,
      width: 1440,
    });
    expect(parseArgs(["-h", "--out", "o", "--label", "orig", "--max-hovers", "2", "--wait", "0"])).toMatchObject({
      help: true,
      outDir: "o",
      label: "orig",
      maxHovers: 2,
      waitMs: 0,
    });
  });

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--nope"])).toThrow("Unexpected argument: --nope");
  });
});

describe("pure helpers", () => {
  it("shortHash is a stable 10-char sha1 prefix", () => {
    expect(shortHash("abc")).toBe("a9993e3647");
  });

  it("safeFileName strips unsafe characters and falls back to 'step'", () => {
    expect(safeFileName("click-Buy now!/x")).toBe("click-Buy-now-x");
    expect(safeFileName("///")).toBe("step");
    expect(safeFileName("a".repeat(120))).toHaveLength(90);
  });

  it("hasChanged detects url, html, scroll, and overlay-count changes", () => {
    const base = { url: "u", htmlHash: "1", scrollY: 0, counts: { dialogs: 0 } };
    expect(hasChanged(base, { ...base })).toBe(false);
    expect(hasChanged(base, { ...base, url: "v" })).toBe(true);
    expect(hasChanged(base, { ...base, htmlHash: "2" })).toBe(true);
    expect(hasChanged(base, { ...base, scrollY: 10 })).toBe(true);
    expect(hasChanged(base, { ...base, counts: { dialogs: 1 } })).toBe(true);
  });

  it("planActions scrolls twice, hovers, clicks only safe targets, and drags canvases", () => {
    const discovered = {
      interactive: [
        { selector: "#a", text: "A", ariaLabel: "", safeClick: true },
        { selector: "#b", text: "", ariaLabel: "Bee", safeClick: false },
        { selector: "#c", text: "", ariaLabel: "", safeClick: true },
      ],
      canvases: [{ selector: "canvas", rect: { x: 0, y: 0, width: 10, height: 10 } }],
    };
    const actions = planActions(discovered, { maxHovers: 2, maxClicks: 5 });
    expect(actions.map((a) => `${a.type}:${a.target}`)).toEqual([
      "scroll:middle",
      "scroll:bottom",
      "hover:A",
      "hover:Bee",
      "click:A",
      "click:#c",
      "canvas-drag:canvas",
    ]);
  });

  it("summarizeFindings counts changes and flags canvas evidence only when present", () => {
    const results = [{ changed: true }, { changed: false }];
    expect(summarizeFindings({ interactive: [1, 2], canvases: [] }, results)).toEqual([
      "2 visible interactive candidates discovered",
      "0 visible canvas targets discovered",
      "1/2 actions changed DOM, URL, scroll, or visible overlay counts",
    ]);
    expect(summarizeFindings({ interactive: [], canvases: [1] }, [])).toContain(
      "Canvas drag evidence exists; inspect screenshots before simplifying WebGL/Canvas behavior.",
    );
  });

  it("markdown renders an escaped action table and optional findings", () => {
    const result = {
      label: "orig",
      url: "https://x.test",
      consoleErrors: ["boom"],
      network: [],
      findings: ["f1"],
      actions: [
        { type: "click", target: "a|b", changed: true, after: { url: "https://x.test/?q=a|b" }, screenshot: "s.png" },
        { type: "scroll", changed: false, after: { url: "u" }, screenshot: "" },
      ],
    };
    const md = markdown(result);
    expect(md).toContain("# orig interaction probe");
    expect(md).toContain("- Console errors: 1");
    expect(md).toContain("| 1 | click | a\\|b | yes | https://x.test/?q=a\\|b | s.png |");
    expect(md).toContain("| 2 | scroll |  | no | u |  |");
    expect(md).toContain("## Findings\n- f1");
    expect(markdown({ ...result, findings: [] })).not.toContain("## Findings");
  });
});

describe("in-page collectors", () => {
  it("snapshot reports url, focus, scroll, text, and visible overlay counts", async () => {
    const page = createFakePage({ env: siteEnv({ dialogOpen: true, scrollY: 12.4 }) });
    const state = await snapshot(page);
    expect(state).toMatchObject({
      url: "https://example.test/",
      title: "Example",
      activeElement: "button",
      scrollY: 12,
      htmlHash: "__HASH_PLACEHOLDER__",
      counts: { dialogs: 1, popovers: 0, canvases: 1, videos: 0, forms: 1 },
    });
    expect(state.bodyTextStart.length).toBeGreaterThan(0);
  });

  it("snapshot tolerates an empty document (no body, no focus, no title)", async () => {
    const document = fakeDocument({ html: { outerHTML: "<html></html>" } });
    document.body = null;
    document.activeElement = null;
    const state = await snapshot(createFakePage({ env: browserEnv({ document }) }));
    expect(state).toMatchObject({ title: "", activeElement: "", bodyTextChars: 0, bodyTextStart: "" });
  });

  it("hashSnapshot replaces the placeholder with a deterministic html hash", async () => {
    const open = await hashSnapshot(createFakePage({ env: siteEnv({ dialogOpen: true }) }), { a: 1 });
    const again = await hashSnapshot(createFakePage({ env: siteEnv({ dialogOpen: true }) }), { a: 1 });
    const closed = await hashSnapshot(createFakePage({ env: siteEnv({}) }), { a: 1 });
    expect(open.a).toBe(1);
    expect(open.htmlHash).toBe(again.htmlHash);
    expect(open.htmlHash).not.toBe(closed.htmlHash);
  });

  it("candidates lists visible interactive nodes with stable selectors and safe-click flags", async () => {
    const found = await candidates(createFakePage({ env: siteEnv({}) }));
    const bySelector = Object.fromEntries(found.interactive.map((item) => [item.selector, item]));
    expect(found.interactive.map((item) => item.text)).toEqual(["Buy now", "Pricing", "Other", "About", "Menu", "More", ""]);
    expect(bySelector["#cta"]).toMatchObject({ tag: "button", safeClick: true, rect: { width: 100, height: 20 } });
    expect(bySelector["html > body:nth-of-type(1) > nav:nth-of-type(1) > a:nth-of-type(1)"]).toMatchObject({ href: "#pricing", safeClick: true });
    expect(bySelector["html > body:nth-of-type(1) > nav:nth-of-type(1) > a:nth-of-type(2)"]).toMatchObject({ safeClick: false, ariaLabel: "Other" });
    expect(bySelector["html > body:nth-of-type(1) > nav:nth-of-type(1) > a:nth-of-type(3)"].safeClick).toBe(true);
    // An id containing whitespace is not a usable #selector — falls back to the path.
    expect(bySelector["html > body:nth-of-type(1) > div:nth-of-type(1)"]).toMatchObject({ role: "button", safeClick: true });
    expect(bySelector["html > body:nth-of-type(1) > summary:nth-of-type(1)"].safeClick).toBe(true);
    expect(bySelector["html > body:nth-of-type(1) > input:nth-of-type(1)"]).toMatchObject({ type: "text", safeClick: false });
    expect(found.canvases).toEqual([{ selector: "html > body:nth-of-type(1) > canvas:nth-of-type(1)", rect: { x: 10, y: 21, width: 400, height: 300 } }]);
  });

  it("candidates caps a selector path at six levels for deeply nested nodes", async () => {
    let node = el({ tag: "button", text: "deep" });
    for (let i = 0; i < 8; i += 1) node = el({ tag: "div", children: [node] });
    const env = browserEnv({ document: fakeDocument({ body: [node] }) });
    const found = await candidates(createFakePage({ env }));
    expect(found.interactive[0].selector.split(" > ")).toHaveLength(6);
  });
});

describe("page actions", () => {
  it("freshPage records only xhr/fetch responses and console errors, tolerating a networkidle timeout", async () => {
    const network = [];
    const consoleErrors = [];
    const page = createFakePage({ loadStateError: new Error("timeout") });
    const browser = createFakeBrowser(() => page);
    await freshPage(browser, { url: "https://x.test", width: 800, waitMs: 5 }, network, consoleErrors);
    await page.emit("console", { type: () => "error", text: () => "bad" });
    await page.emit("console", { type: () => "log", text: () => "fine" });
    await page.emit("response", fakeResponse({ url: "https://x.test/api", resourceType: "xhr", method: "POST", status: 201 }));
    await page.emit("response", fakeResponse({ url: "https://x.test/a.png", resourceType: "image" }));
    expect(browser.newPageOptions).toEqual([{ viewport: { width: 800, height: 900 }, deviceScaleFactor: 1 }]);
    expect(consoleErrors).toEqual(["bad"]);
    expect(network).toEqual([{ url: "https://x.test/api", status: 201, method: "POST", resourceType: "xhr" }]);
    expect(page.calls).toContainEqual(["waitForTimeout", 5]);
  });

  it("freshPage skips the settle wait when --wait is 0", async () => {
    const page = createFakePage();
    await freshPage(createFakeBrowser(() => page), { url: "https://x.test", width: 800, waitMs: 0 }, [], []);
    expect(page.calls.some(([name]) => name === "waitForTimeout")).toBe(false);
  });

  it("captureAction performs each action kind and reports what changed", async () => {
    const outDir = tempDir();
    fs.mkdirSync(path.join(outDir, "screenshots"));
    // A fresh page per action, as the probe itself does.
    const run = async (index, action) => {
      const state = {};
      const page = createFakePage({ env: siteEnv(state), hooks: { click: () => { state.dialogOpen = true; } } });
      const before = await hashSnapshot(page, await snapshot(page));
      return { page, result: await captureAction(page, outDir, index, action, before) };
    };

    const { result: scrolled } = await run(0, { type: "scroll", target: "middle", ratio: 0.5 });
    expect(scrolled.after.scrollY).toBe(1000);
    expect(scrolled.changed).toBe(true);
    expect(fs.existsSync(path.join(outDir, scrolled.screenshot))).toBe(true);
    expect(scrolled.screenshot).toMatch(/^screenshots\/01-scroll-middle-[0-9a-f]{10}\.png$/);

    const { page: hoverPage, result: hovered } = await run(1, { type: "hover", target: "Buy", selector: "#cta" });
    expect(hovered.changed).toBe(false);
    expect(hoverPage.calls).toContainEqual(["hover", "#cta", { timeout: 3000 }]);

    const { page: clickPage, result: clicked } = await run(2, { type: "click", selector: "#cta" });
    expect(clickPage.calls).toContainEqual(["click", "#cta", { timeout: 4000 }]);
    expect(clicked.changed).toBe(true);
    expect(clicked.after.counts.dialogs).toBe(1);
    expect(clicked.screenshot).toMatch(/^screenshots\/03-click--cta-/);

    const { page: dragPage, result: dragged } = await run(3, { type: "canvas-drag", rect: { x: 0, y: 0, width: 400, height: 1000 } });
    expect(dragged.screenshot).toMatch(/^screenshots\/04-canvas-drag-page-/);
    expect(dragPage.calls.filter(([name]) => name.startsWith("mouse."))).toEqual([
      ["mouse.move", 200, 500],
      ["mouse.down"],
      ["mouse.move", 300, 620, { steps: 8 }],
      ["mouse.up"],
    ]);
  });
});

describe("main", () => {
  it("prints usage and exits 0 for --help, 1 when --url is missing", async () => {
    const out = createOutput();
    expect(await main(["--help"], out)).toBe(0);
    expect(await main([], out)).toBe(1);
    expect(out.logs).toHaveLength(2);
    expect(out.logs[0]).toContain("node scripts/interaction-probe.mjs --url <url>");
  });

  it("reports a parse failure as exit 1", async () => {
    const out = createOutput();
    expect(await main(["--bogus"], out)).toBe(1);
    expect(out.errors).toEqual(["interaction-probe failed: Unexpected argument: --bogus"]);
  });

  it("probes a page end to end and writes JSON + markdown evidence", async () => {
    const outDir = tempDir();
    const out = createOutput();
    const browser = createFakeBrowser((options, index) => {
      const state = {};
      const hooks = {
        click: (selector) => {
          if (selector === "#cta") state.dialogOpen = true;
          else throw new Error(`detached: ${selector}`);
        },
      };
      if (index === 0) hooks.goto = (url, page) => page.emit("console", { type: () => "error", text: () => "seed error" });
      return createFakePage({ env: siteEnv(state), hooks });
    });
    const code = await main(
      ["--url", "https://example.test/", "--out", outDir, "--label", "orig", "--max-hovers", "1", "--max-clicks", "2", "--wait", "0"],
      { ...out, ...playwrightPorts(browser), now: () => new Date("2026-01-02T03:04:05Z") },
    );
    expect(code).toBe(0);
    const jsonFile = path.join(outDir, "orig-interactions.json");
    expect(out.logs).toEqual([jsonFile]);
    const result = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    expect(result.capturedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(result.actions.map((a) => [a.type, a.changed, a.error || ""])).toEqual([
      ["scroll", true, ""],
      ["scroll", true, ""],
      ["hover", false, ""],
      ["click", true, ""],
      ["click", false, "detached: html > body:nth-of-type(1) > nav:nth-of-type(1) > a:nth-of-type(1)"],
      ["canvas-drag", false, ""],
    ]);
    expect(result.actions[4]).toMatchObject({ screenshot: "", after: result.actions[4].before });
    expect(result.consoleErrors).toEqual(["seed error"]);
    expect(result.findings).toContain("3/6 actions changed DOM, URL, scroll, or visible overlay counts");
    expect(fs.existsSync(path.join(outDir, "screenshots", "00-initial.png"))).toBe(true);
    expect(fs.readFileSync(path.join(outDir, "orig-interactions.md"), "utf8")).toContain("# orig interaction probe");
    expect(browser.closed).toBe(true);
    expect(browser.pages.every((page) => page.closed)).toBe(true);
  });

  it("stamps capturedAt from the real clock by default and fails with exit 1 when navigation throws", async () => {
    const out = createOutput();
    const ok = createFakeBrowser(() => createFakePage({ env: browserEnv({ document: fakeDocument({ html: { outerHTML: "<html></html>" } }) }) }));
    const outDir = tempDir();
    const before = Date.now();
    expect(await main(["--url", "https://example.test/", "--out", outDir, "--wait", "0"], { ...out, ...playwrightPorts(ok) })).toBe(0);
    const result = JSON.parse(fs.readFileSync(path.join(outDir, "site-interactions.json"), "utf8"));
    expect(Date.parse(result.capturedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(result.actions).toHaveLength(2);

    const failing = createFakeBrowser(() => createFakePage({ gotoError: new Error("net::ERR_NAME_NOT_RESOLVED") }));
    expect(await main(["--url", "https://nope.test/", "--out", outDir], { ...out, ...playwrightPorts(failing) })).toBe(1);
    expect(out.errors).toEqual(["interaction-probe failed: net::ERR_NAME_NOT_RESOLVED"]);
  });
});
