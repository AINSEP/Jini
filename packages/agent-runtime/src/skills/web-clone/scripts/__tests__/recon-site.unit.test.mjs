import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectSignals, main, parseArgs, scrollThroughPage, summarizeFlags, summaryMarkdown } from "../recon-site.mjs";
import { browserEnv, createFakeBrowser, createFakePage, createOutput, el, fakeDocument, playwrightPorts, tempDir } from "./fakes-wc2.mjs";

/** A CSSStyleDeclaration stand-in: iterable property names + getPropertyValue. */
function decl(props) {
  const names = Object.keys(props);
  names.getPropertyValue = (name) => props[name] ?? "";
  return names;
}

class FakeFontFaceRule {
  constructor(props, cssText) {
    this.style = decl(props);
    this.cssText = cssText;
  }
}

function reconStyle(node) {
  return {
    display: "block",
    position: "static",
    backgroundColor: "rgb(255, 255, 255)",
    color: "rgb(0, 0, 0)",
    borderTopColor: "rgb(0, 0, 0)",
    fontFamily: "Inter, sans-serif",
    fontSize: "16px",
    backgroundImage: "none",
    scrollBehavior: "auto",
    ...node.style,
    getPropertyValue: (name) => node.style.vars?.[name] ?? "",
  };
}

function richDocument() {
  const scripts = [
    "https://s.test/_next/static/main.js",
    "https://s.test/_nuxt/app.js",
    "https://cdn.test/astro.island.js",
    "https://cdn.test/three.module.min.js",
    "https://cdn.test/GSAP.js",
    "https://cdn.test/lenis.js",
  ].map((src) => el({ tag: "script", src, matches: ["script[src]"] }));
  const crossOrigin = {
    href: "https://cdn.test/x.css",
    get cssRules() {
      throw new Error("SecurityError");
    },
  };
  const doc = fakeDocument({
    title: "Rich",
    html: { lang: "en", scrollHeight: 3000, style: { scrollBehavior: "smooth", vars: { "--brand": " #ff0000 " } } },
    body: [
      ...scripts,
      el({ tag: "link", href: "https://s.test/site.css", matches: ["link[rel='stylesheet']"] }),
      el({ tag: "meta", content: "A rich page", matches: ["meta[name='description']"] }),
      el({ tag: "div", id: "__next", matches: ["#__next", "#__next,[data-reactroot],[data-reactid]"] }),
      el({ tag: "div", matches: ["[data-v-app]", "[data-svelte-h]", "[data-astro-cid]"] }),
      el({
        tag: "header",
        id: "top",
        className: "hdr",
        text: "  Site   header ",
        rect: { x: 0.4, y: 0, width: 1440.6, height: 80 },
        style: { position: "sticky", backgroundImage: "linear-gradient(red, blue)" },
      }),
      el({ tag: "nav", style: { position: "fixed", fontFamily: undefined } }),
      el({ tag: "main" }),
      el({ tag: "section", className: undefined }),
      el({ tag: "footer" }),
      el({ tag: "h1", text: "Hello  world" }),
      el({ tag: "h1", text: "" }),
      el({ tag: "h2", text: "Sub" }),
      el({ tag: "img", currentSrc: "https://s.test/a.png", srcset: "a.png 1x", alt: "A", naturalWidth: 640, naturalHeight: 480 }),
      el({ tag: "img", attrs: { "data-src": "/lazy.png", "data-srcset": "/lazy.png 2x" }, width: 32, height: 16 }),
      el({ tag: "img" }),
      el({ tag: "canvas", width: 800, height: 600, rect: { x: 0, y: 0, width: 400, height: 300 } }),
      el({ tag: "a", text: "Docs", matches: ["a[href]", "a[class*='btn' i]"] }),
      el({ tag: "button", text: "Go" }),
      el({ tag: "video" }),
      el({ tag: "form" }),
      el({ tag: "input" }),
    ],
    styleSheets: [
      {
        href: "https://s.test/site.css",
        cssRules: [
          { style: decl({ "--brand": " #f00 ", "--gap": "4px", color: "red" }), cssText: ":root{--brand:#f00;--gap:4px}" },
          new FakeFontFaceRule({ src: 'url("/f/a.woff2") format("woff2"), url( '/f/a.woff' )', "font-family": '"Inter"', "font-weight": "700" }, "@font-face{font-family:Inter}"),
          { cssText: "@media (min-width: 1px) { html { scroll-behavior: smooth } }" },
          { style: decl({}), cssText: ".rail{scroll-snap-type:x mandatory}" },
          { style: decl({}) },
        ],
      },
      { href: null, cssRules: [new FakeFontFaceRule({ src: "local(Inter)", "font-family": "Mono" }, "@font-face{font-family:Mono}")] },
      crossOrigin,
      { href: "https://s.test/empty.css" },
    ],
    fonts: [{ family: "Inter" }, { family: "" }],
  });
  return doc;
}

function richEnv() {
  const entries = [
    { name: "https://s.test/f/a.woff2?v=1", initiatorType: "css" },
    { name: "https://s.test/a.png", initiatorType: "img" },
    { name: "https://s.test/a.png", initiatorType: "img" },
    { name: "https://s.test/img?id=1", initiatorType: "img" },
    { name: "https://s.test/bg.webp", initiatorType: "css" },
    { name: "https://s.test/v.mp4#t=1", initiatorType: "video" },
    { name: "https://s.test/app.js", initiatorType: "script" },
  ];
  return browserEnv({
    document: richDocument(),
    href: "https://s.test/",
    extra: {
      getComputedStyle: reconStyle,
      CSSFontFaceRule: FakeFontFaceRule,
      performance: { getEntriesByType: (type) => (type === "resource" ? entries : []) },
    },
  });
}

function sparseEnv(window = {}) {
  const document = fakeDocument({ html: { scrollHeight: 0 } });
  document.body = null;
  return browserEnv({
    document,
    window,
    extra: { getComputedStyle: reconStyle, CSSFontFaceRule: FakeFontFaceRule, performance: { getEntriesByType: () => [] } },
  });
}

describe("parseArgs", () => {
  it("parses widths and defaults, rejecting unknown flags", () => {
    expect(parseArgs(["--url", "https://s.test", "--widths", "1280, 0,abc,375", "--wait", "0"])).toEqual({
      url: "https://s.test",
      outDir: "RECON",
      label: "site",
      widths: [1280, 375],
      waitMs: 0,
    });
    expect(parseArgs(["-h", "--out", "R", "--label", "clone", "--widths"])).toMatchObject({ help: true, outDir: "R", label: "clone", widths: [] });
    expect(() => parseArgs(["--zoom"])).toThrow("Unexpected argument: --zoom");
  });
});

describe("collectSignals", () => {
  it("extracts structure, styles, fonts, resources, motion, and framework signals", async () => {
    const signals = await collectSignals(createFakePage({ env: richEnv() }));
    expect(signals).toMatchObject({
      href: "https://s.test/",
      title: "Rich",
      lang: "en",
      scrollHeight: 3000,
      viewport: { width: 1440, height: 900 },
      h1: ["Hello world"],
      metaDescription: "A rich page",
      headings: [
        { tag: "h1", text: "Hello world" },
        { tag: "h1", text: "" },
        { tag: "h2", text: "Sub" },
      ],
      frameworks: { react: true, next: true, vue: true, nuxt: true, svelte: true, astro: true, three: true, gsap: true, lenis: true },
      cssVariables: [
        ["--brand", "#f00"],
        ["--gap", "4px"],
      ],
      rootVariables: [["--brand", "#ff0000"]],
      motion: { htmlScrollBehavior: "smooth", scrollSnapRules: 1, smoothScrollRules: 1, stickyOrFixedCount: 2 },
      fonts: ["Inter"],
      resources: {
        fonts: ["https://s.test/f/a.woff2?v=1"],
        images: ["https://s.test/a.png", "https://s.test/img?id=1", "https://s.test/bg.webp"],
        media: ["https://s.test/v.mp4#t=1"],
      },
      canvases: [{ width: 800, height: 600, cssWidth: 400, cssHeight: 300 }],
    });
    expect(signals.counts).toEqual({
      links: 1,
      images: 3,
      video: 1,
      canvas: 1,
      sections: 5,
      forms: 1,
      buttons: 1,
      inputs: 1,
      interactive: 3,
      scripts: 6,
      stylesheets: 1,
    });
    expect(signals.scripts).toHaveLength(6);
    expect(signals.stylesheets).toEqual(["https://s.test/site.css"]);
    expect(signals.sections[0]).toEqual({
      tag: "header",
      id: "top",
      className: "hdr",
      text: "Site header",
      rect: { x: 0, y: 0, width: 1441, height: 80 },
      style: { display: "block", position: "sticky", backgroundColor: "rgb(255, 255, 255)", color: "rgb(0, 0, 0)", fontFamily: "Inter, sans-serif", fontSize: "16px" },
    });
    expect(signals.sections[3]).toMatchObject({ tag: "section", id: "", className: "" });
    expect(signals.images).toEqual([
      { src: "https://s.test/a.png", srcset: "a.png 1x", alt: "A", width: 640, height: 480 },
      { src: "/lazy.png", srcset: "/lazy.png 2x", alt: "", width: 32, height: 16 },
      { src: "", srcset: "", alt: "", width: 0, height: 0 },
    ]);
    expect(signals.fontFaces).toEqual([
      { family: "Inter", weight: "700", style: "", srcUrls: ["/f/a.woff2", "/f/a.woff"], cssText: "@font-face{font-family:Inter}", sheetHref: "https://s.test/site.css" },
      { family: "Mono", weight: "", style: "", srcUrls: [], cssText: "@font-face{font-family:Mono}", sheetHref: "https://s.test/" },
    ]);
    expect(signals.palette.header).toEqual({
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(0, 0, 0)",
      borderColor: "rgb(0, 0, 0)",
      fontFamily: "Inter, sans-serif",
      backgroundImage: "linear-gradient(red, blue)",
    });
    expect(signals.palette.body.backgroundImage).toBe("");
    expect(signals.palette.buttons.map((b) => b.text)).toEqual(["Docs", "Go"]);
  });

  it("falls back cleanly on an empty page and reads framework globals from window", async () => {
    const empty = await collectSignals(createFakePage({ env: sparseEnv() }));
    expect(empty).toMatchObject({ title: "", lang: "", bodyTextChars: 0, h1: [], metaDescription: "", fonts: [], cssVariables: [], fontFaces: [] });
    expect(empty.palette).toEqual({ body: null, header: null, nav: null, main: null, footer: null, buttons: [] });
    expect(Object.values(empty.frameworks).every((flag) => flag === false)).toBe(true);

    const globals = await collectSignals(
      createFakePage({ env: sparseEnv({ __REACT_DEVTOOLS_GLOBAL_HOOK__: {}, __VUE__: 1, __NUXT__: {}, THREE: {}, gsap: {}, Lenis: class {} }) }),
    );
    expect(globals.frameworks).toEqual({ react: true, next: false, vue: true, nuxt: true, svelte: false, astro: false, three: true, gsap: true, lenis: true });
  });
});

describe("scrollThroughPage", () => {
  it("steps through the full height, then returns to the top", async () => {
    const env = browserEnv({ document: fakeDocument({ html: { scrollHeight: 1500 } }) });
    const page = createFakePage({ env });
    await scrollThroughPage(page);
    expect(env.window.scrolls).toEqual([[0, 0], [0, 700], [0, 1400], [0, 0]]);
    await scrollThroughPage(page, 1000);
    expect(env.window.scrolls.slice(4)).toEqual([[0, 0], [0, 1000], [0, 0]]);
  });
});

describe("summary", () => {
  it("summarizeFlags lists only true framework flags", () => {
    expect(summarizeFlags({ frameworks: { react: true, vue: false, astro: true } })).toEqual(["react", "astro"]);
    expect(summarizeFlags({})).toEqual([]);
  });

  it("renders signal fallbacks for a run without captures", () => {
    const md = summaryMarkdown({ label: "x", url: "u", console: { errors: [], pageErrors: [1] }, captures: [] });
    expect(md).toContain("- Title: \n- Lang: \n- Viewports: \n- Framework signals: none");
    expect(md).toContain("- Canvas count: 0\n- Video count: 0\n- Image count: 0\n- Link count: 0\n- Console errors: 0\n- Page errors: 1");
    expect(md).toContain("- Loaded families: none\n- @font-face rules: 0; font files: 0");
    expect(md).toContain("- Image resources loaded: 0 (run asset-harvest to download ALL of them)");
  });

  it("renders palette rows, skipping buttons and missing regions", () => {
    const signals = {
      title: "T",
      lang: "en",
      frameworks: { next: true },
      counts: { canvas: 1, video: 2, images: 3, links: 4 },
      palette: {
        body: { backgroundColor: "white", color: "black", fontFamily: "Inter, sans-serif" },
        header: null,
        nav: { backgroundColor: "red", color: "blue" },
        buttons: [{ backgroundColor: "x" }],
      },
      fonts: ["Inter", "Mono"],
      fontFaces: [{}],
      resources: { fonts: ["a", "b"], images: ["i"] },
    };
    const md = summaryMarkdown({ label: "orig", url: "u", console: { errors: [1, 2], pageErrors: [] }, captures: [{ viewport: { width: 1440 }, screenshot: "s/a.png", signals }, { viewport: { width: 390 }, screenshot: "s/b.png", signals: {} }] });
    expect(md.split("\n")).toEqual([
      "# orig recon",
      "",
      "- URL: u",
      "- Title: T",
      "- Lang: en",
      "- Viewports: 1440, 390",
      "- Framework signals: next",
      "- Canvas count: 1",
      "- Video count: 2",
      "- Image count: 3",
      "- Link count: 4",
      "- Console errors: 2",
      "- Page errors: 0",
      "",
      "## Palette (computed — 复刻必须照抄这些值，不许目测)",
      "- body: bg white · text black · font Inter",
      "- nav: bg red · text blue · font ",
      "",
      "## Fonts (真字体自托管，禁止系统字体近似)",
      "- Loaded families: Inter, Mono",
      "- @font-face rules: 1; font files: 2",
      "",
      "## Assets",
      "- Image resources loaded: 1 (run asset-harvest to download ALL of them)",
      "",
      "## Screenshots",
      "- 1440: s/a.png",
      "- 390: s/b.png",
      "",
    ]);
  });
});

describe("main", () => {
  it("prints usage: exit 0 for --help, 1 without --url, 1 on a bad flag", async () => {
    const out = createOutput();
    expect(await main(["--help"], out)).toBe(0);
    expect(await main([], out)).toBe(1);
    expect(await main(["--x"], out)).toBe(1);
    expect(out.logs[0]).toContain("node scripts/recon-site.mjs --url <url> --out <RECON dir>");
    expect(out.errors).toEqual(["recon-site failed: Unexpected argument: --x"]);
  });

  it("captures every width with console evidence and writes JSON + summary", async () => {
    const outDir = tempDir();
    const out = createOutput();
    const browser = createFakeBrowser(() =>
      createFakePage({
        env: richEnv(),
        loadStateError: new Error("timeout"),
        hooks: {
          goto: async (url, page) => {
            await page.emit("console", { type: () => "error", text: () => "E" });
            await page.emit("console", { type: () => "warning", text: () => "W" });
            await page.emit("console", { type: () => "log", text: () => "L" });
            await page.emit("pageerror", new Error("boom"));
          },
        },
      }),
    );
    const code = await main(["--url", "https://s.test/", "--out", outDir, "--label", "orig", "--widths", "1440,390", "--wait", "5"], {
      ...out,
      ...playwrightPorts(browser),
      now: () => new Date("2026-05-06T07:08:09Z"),
    });
    expect(code).toBe(0);
    const jsonFile = path.join(outDir, "orig-recon.json");
    expect(out.logs).toEqual([jsonFile]);
    const result = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    expect(result).toMatchObject({ label: "orig", url: "https://s.test/", capturedAt: "2026-05-06T07:08:09.000Z" });
    expect(result.console).toEqual({
      errors: [
        { type: "error", text: "E", viewport: 1440 },
        { type: "error", text: "E", viewport: 390 },
      ],
      warnings: [
        { type: "warning", text: "W", viewport: 1440 },
        { type: "warning", text: "W", viewport: 390 },
      ],
      pageErrors: [
        { message: "boom", viewport: 1440 },
        { message: "boom", viewport: 390 },
      ],
    });
    expect(result.captures.map((c) => [c.viewport, c.screenshot, c.signals.title])).toEqual([
      [{ width: 1440, height: 900 }, "screenshots/orig-1440.png", "Rich"],
      [{ width: 390, height: 900 }, "screenshots/orig-390.png", "Rich"],
    ]);
    expect(fs.existsSync(path.join(outDir, "screenshots", "orig-390.png"))).toBe(true);
    expect(fs.readFileSync(path.join(outDir, "orig-summary.md"), "utf8")).toContain("- Framework signals: react, next, vue, nuxt, svelte, astro, three, gsap, lenis");
    expect(browser.newPageOptions).toEqual([
      { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
      { viewport: { width: 390, height: 900 }, deviceScaleFactor: 1 },
    ]);
    expect(browser.pages[0].calls).toContainEqual(["waitForTimeout", 5]);
    expect(browser.pages.every((p) => p.closed)).toBe(true);
    expect(browser.closed).toBe(true);
  });

  it("skips the settle wait at --wait 0, uses the real clock by default, and exits 1 on failure", async () => {
    const outDir = tempDir();
    const out = createOutput();
    const browser = createFakeBrowser(() => createFakePage({ env: sparseEnv() }));
    const before = Date.now();
    expect(await main(["--url", "https://s.test/", "--out", outDir, "--widths", "800", "--wait", "0"], { ...out, ...playwrightPorts(browser) })).toBe(0);
    expect(browser.pages[0].calls.filter(([name, ms]) => name === "waitForTimeout" && ms === 0)).toEqual([]);
    const result = JSON.parse(fs.readFileSync(path.join(outDir, "site-recon.json"), "utf8"));
    expect(Date.parse(result.capturedAt)).toBeGreaterThanOrEqual(before - 1000);

    const failing = createFakeBrowser(() => createFakePage({ gotoError: new Error("net::ERR_ABORTED") }));
    expect(await main(["--url", "https://s.test/", "--out", outDir], { ...out, ...playwrightPorts(failing) })).toBe(1);
    expect(out.errors).toEqual(["recon-site failed: net::ERR_ABORTED"]);
  });
});
