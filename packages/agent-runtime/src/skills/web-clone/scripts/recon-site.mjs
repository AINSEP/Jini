#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import { HELP_OPTIONS, num, parseCliArgs, text } from "./lib/cli-args.mjs";
import { runCli, runIfMain } from "./lib/main-guard.mjs";

// Hard dependencies are ports with real defaults wired here at the CLI edge;
// tests pass fakes (no real browser, captured output, fixed clock).
const DEFAULT_DEPS = { fs, loadPlaywright, launchChromium, log: console.log, error: console.error, now: () => new Date() };

export function usage(log = console.log) {
  log(`Usage:
  node scripts/recon-site.mjs --url <url> --out <RECON dir> [--label original|clone] [--widths 1440,768,390] [--wait 1200]

Outputs:
  <out>/<label>-recon.json
  <out>/<label>-summary.md
  <out>/screenshots/<label>-<width>.png
`);
}

const ARG_SPEC = {
  defaults: {
    url: "",
    outDir: "RECON",
    label: "site",
    widths: [1440, 768, 390],
    waitMs: 1200,
  },
  options: {
    ...HELP_OPTIONS,
    "--url": { key: "url", parse: text("") },
    "--out": { key: "outDir", parse: text("") },
    "--label": { key: "label", parse: text("site") },
    "--widths": { key: "widths", parse: (raw) => (raw || "").split(",").map((n) => Number(n.trim())).filter(Boolean) },
    "--wait": { key: "waitMs", parse: num("1200") },
  },
};

export function parseArgs(argv) {
  return parseCliArgs({ argv, ...ARG_SPEC });
}

export function summarizeFlags(signals) {
  return Object.entries(signals.frameworks || {})
    .filter(([, value]) => value)
    .map(([key]) => key);
}

function overviewLines(data, first) {
  return [
    `# ${data.label} recon`,
    "",
    `- URL: ${data.url}`,
    `- Title: ${first.title || ""}`,
    `- Lang: ${first.lang || ""}`,
    `- Viewports: ${data.captures.map((c) => c.viewport.width).join(", ")}`,
    `- Framework signals: ${summarizeFlags(first).join(", ") || "none"}`,
  ];
}

function countLines(data, counts = {}) {
  return [
    `- Canvas count: ${counts.canvas ?? 0}`,
    `- Video count: ${counts.video ?? 0}`,
    `- Image count: ${counts.images ?? 0}`,
    `- Link count: ${counts.links ?? 0}`,
    `- Console errors: ${data.console.errors.length}`,
    `- Page errors: ${data.console.pageErrors.length}`,
  ];
}

function paletteLines(palette = {}) {
  return [
    "",
    "## Palette (computed — 复刻必须照抄这些值，不许目测)",
    ...Object.entries(palette)
      .filter(([key, value]) => key !== "buttons" && value)
      .map(([key, value]) => `- ${key}: bg ${value.backgroundColor} · text ${value.color} · font ${value.fontFamily?.split(",")[0] || ""}`),
  ];
}

function assetLines(first, resources = {}) {
  return [
    "",
    "## Fonts (真字体自托管，禁止系统字体近似)",
    `- Loaded families: ${(first.fonts || []).join(", ") || "none"}`,
    `- @font-face rules: ${(first.fontFaces || []).length}; font files: ${(resources.fonts || []).length}`,
    "",
    "## Assets",
    `- Image resources loaded: ${(resources.images || []).length} (run asset-harvest to download ALL of them)`,
  ];
}

/** The `<label>-summary.md` body for a recon result (first capture's signals). */
export function summaryMarkdown(data) {
  const first = data.captures[0]?.signals || {};
  const lines = [
    ...overviewLines(data, first),
    ...countLines(data, first.counts),
    ...paletteLines(first.palette),
    ...assetLines(first, first.resources),
    "",
    "## Screenshots",
    ...data.captures.map((c) => `- ${c.viewport.width}: ${c.screenshot}`),
    "",
  ];
  return lines.join("\n");
}

// Runs inside the page via `page.evaluate`, so it must stay self-contained:
// every helper is nested in the callback (Playwright serializes only the
// function itself), and each nested helper keeps one concern.
export async function collectSignals(page) {
  return page.evaluate(() => {
    const bySelector = (selector) => Array.from(document.querySelectorAll(selector));
    const text = (node) => (node?.textContent || "").trim().replace(/\s+/g, " ");
    const win = window;
    // A cross-origin stylesheet throws on `cssRules` access: treat it as empty.
    const sheetRules = (sheet) => {
      let rules = [];
      try {
        rules = Array.from(sheet.cssRules || []);
      } catch {
        // SecurityError: unreadable sheet.
      }
      return rules;
    };
    const allRules = () => Array.from(document.styleSheets).flatMap(sheetRules);
    const rectOf = (rect) => ({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    const sectionOf = (node) => {
      const style = getComputedStyle(node);
      return {
        tag: node.tagName.toLowerCase(),
        id: node.id || "",
        className: String(node.className || "").slice(0, 160),
        text: text(node).slice(0, 240),
        rect: rectOf(node.getBoundingClientRect()),
        style: {
          display: style.display,
          position: style.position,
          backgroundColor: style.backgroundColor,
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
        },
      };
    };
    const ruleVariables = (rule) => {
      const style = rule.style;
      if (!style) return [];
      return Array.from(style)
        .filter((name) => name.startsWith("--"))
        .map((name) => [name, style.getPropertyValue(name).trim()]);
    };
    const imageSize = (img) => ({
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
    });
    const imageOf = (img) => ({
      src: img.currentSrc || img.src || img.getAttribute("data-src") || "",
      srcset: img.srcset || img.getAttribute("data-srcset") || "",
      alt: img.alt || "",
      ...imageSize(img),
    });
    const fontFaceOf = (sheet) => (rule) => {
      const src = rule.style.getPropertyValue("src");
      const srcUrls = Array.from(src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)).map((m) => m[1]);
      return {
        family: rule.style.getPropertyValue("font-family").replace(/['"]/g, "").trim(),
        weight: rule.style.getPropertyValue("font-weight") || "",
        style: rule.style.getPropertyValue("font-style") || "",
        srcUrls,
        cssText: rule.cssText,
        sheetHref: sheet.href || location.href,
      };
    };
    const resourceKind = (entry) => {
      const url = entry.name;
      if (/\.(woff2?|ttf|otf|eot)(?:$|[?#])/i.test(url)) return "fonts";
      if (entry.initiatorType === "img" || /\.(png|jpe?g|gif|webp|avif|svg|ico)(?:$|[?#])/i.test(url)) return "images";
      if (/\.(mp4|webm|m4v|mp3|ogg)(?:$|[?#])/i.test(url)) return "media";
      return "";
    };
    const loadedResources = () => {
      const resources = { images: [], fonts: [], media: [] };
      for (const entry of performance.getEntriesByType("resource")) {
        const kind = resourceKind(entry);
        if (kind) resources[kind].push(entry.name);
      }
      resources.images = Array.from(new Set(resources.images)).slice(0, 300);
      resources.fonts = Array.from(new Set(resources.fonts)).slice(0, 60);
      resources.media = Array.from(new Set(resources.media)).slice(0, 40);
      return resources;
    };
    const paletteOf = (node) => {
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderTopColor,
        fontFamily: style.fontFamily,
        backgroundImage: style.backgroundImage !== "none" ? style.backgroundImage.slice(0, 300) : "",
      };
    };
    const scrollRuleCounts = () => {
      const counts = { scrollSnapRules: 0, smoothScrollRules: 0 };
      for (const rule of allRules()) {
        const ruleText = rule.cssText || "";
        if (ruleText.includes("scroll-snap")) counts.scrollSnapRules += 1;
        if (ruleText.includes("scroll-behavior") && ruleText.includes("smooth")) counts.smoothScrollRules += 1;
      }
      return counts;
    };
    const motionSignals = () => {
      const stickyOrFixedCount = bySelector("header,nav,aside,section,div")
        .slice(0, 500)
        .filter((el) => {
          const position = getComputedStyle(el).position;
          return position === "sticky" || position === "fixed";
        }).length;
      return {
        htmlScrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        ...scrollRuleCounts(),
        stickyOrFixedCount,
      };
    };
    const scriptHas = (scripts, test) => scripts.some(test);
    const frameworkSignals = (scripts) => ({
      react: Boolean(win.__REACT_DEVTOOLS_GLOBAL_HOOK__) || Boolean(document.querySelector("#__next,[data-reactroot],[data-reactid]")),
      next: Boolean(document.querySelector("#__next")) || scriptHas(scripts, (src) => src.includes("/_next/")),
      vue: Boolean(win.__VUE__) || Boolean(document.querySelector("[data-v-app]")),
      nuxt: Boolean(win.__NUXT__) || scriptHas(scripts, (src) => src.includes("/_nuxt/")),
      svelte: Boolean(document.querySelector("[data-svelte-h]")),
      astro: Boolean(document.querySelector("[data-astro-cid]")) || scriptHas(scripts, (src) => src.includes("astro")),
      three: Boolean(win.THREE) || scriptHas(scripts, (src) => /three(\.module)?(\.min)?\.js/i.test(src)),
      gsap: Boolean(win.gsap) || scriptHas(scripts, (src) => src.toLowerCase().includes("gsap")),
      lenis: Boolean(win.Lenis) || scriptHas(scripts, (src) => src.toLowerCase().includes("lenis")),
    });
    const countSignals = (scripts, stylesheets, sections) => ({
      links: bySelector("a[href]").length,
      images: bySelector("img").length,
      video: bySelector("video").length,
      canvas: bySelector("canvas").length,
      sections: sections.length,
      forms: bySelector("form").length,
      buttons: bySelector("button").length,
      inputs: bySelector("input,textarea,select").length,
      interactive: bySelector("a[href],button,input,textarea,select,summary,[role='button'],[tabindex]").length,
      scripts: scripts.length,
      stylesheets: stylesheets.length,
    });
    const documentSignals = () => ({
      href: location.href,
      title: document.title,
      lang: document.documentElement.lang || "",
      bodyTextChars: (document.body?.innerText || "").length,
      scrollHeight: document.documentElement.scrollHeight,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      h1: bySelector("h1").map((h) => text(h)).filter(Boolean).slice(0, 10),
      metaDescription: document.querySelector("meta[name='description']")?.content || "",
      fonts: Array.from(document.fonts || []).map((font) => font.family).filter(Boolean).slice(0, 40),
    });

    const scripts = bySelector("script[src]").map((s) => s.src);
    const stylesheets = bySelector("link[rel='stylesheet']").map((s) => s.href);
    const headings = bySelector("h1,h2,h3").slice(0, 60).map((h) => ({
      tag: h.tagName.toLowerCase(),
      text: text(h).slice(0, 160),
    }));
    const sections = bySelector("header,nav,main,section,article,aside,footer").slice(0, 80).map(sectionOf);
    const cssVariables = allRules().flatMap(ruleVariables).slice(0, 200);
    const images = bySelector("img").slice(0, 120).map(imageOf);
    // @font-face 规则原文 + 解析出的 src url——复刻必须自托管这些真字体，
    // 禁止用系统字体近似(见 SKILL.md 保真门槛)。
    const fontFaces = Array.from(document.styleSheets).flatMap((sheet) =>
      sheetRules(sheet)
        .filter((rule) => rule instanceof CSSFontFaceRule)
        .map(fontFaceOf(sheet)),
    ).slice(0, 60);
    // 页面实际加载过的资源 URL(懒加载图、CSS 背景图、字体二进制都在这)——
    // 这是"真实用到的资产"全集，asset-harvest 以此下载。
    const resources = loadedResources();
    // 关键区块的精确取色——复刻时颜色必须照抄这里的值，不许目测。
    const palette = {
      body: paletteOf(document.body),
      header: paletteOf(document.querySelector("header")),
      nav: paletteOf(document.querySelector("nav")),
      main: paletteOf(document.querySelector("main")),
      footer: paletteOf(document.querySelector("footer")),
      buttons: bySelector("button,[role='button'],a[class*='btn' i],a[class*='button' i]")
        .slice(0, 12)
        .map((node) => ({ text: text(node).slice(0, 40), ...paletteOf(node) })),
    };
    // 滚动体感信号——复刻必须还原原站的滚动手感(平滑滚动库/snap/sticky)，
    // 配合 frameworks 里的 lenis/gsap 检测一起读。
    const motion = motionSignals();
    // :root 自定义属性的"计算后"值(声明值可能是 var() 链)。
    const rootStyle = getComputedStyle(document.documentElement);
    const rootVariables = cssVariables
      .map(([name]) => [name, rootStyle.getPropertyValue(name).trim()])
      .filter(([, value]) => value)
      .slice(0, 200);
    const canvases = bySelector("canvas").map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.getBoundingClientRect().width,
      cssHeight: canvas.getBoundingClientRect().height,
    }));
    const { fonts, metaDescription, ...doc } = documentSignals();
    return {
      ...doc,
      headings,
      metaDescription,
      counts: countSignals(scripts, stylesheets, sections),
      frameworks: frameworkSignals(scripts),
      scripts: scripts.slice(0, 120),
      stylesheets: stylesheets.slice(0, 80),
      sections,
      cssVariables,
      rootVariables,
      palette,
      motion,
      fonts,
      fontFaces,
      resources,
      images,
      canvases,
    };
  });
}

// 全程滚动一遍再采集: 懒加载图(loading=lazy / IntersectionObserver)只有滚到才
// 发请求; 不滚的话 images/resources 只覆盖首屏, 复刻必然缺图。
export async function scrollThroughPage(page, stepPx = 700) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= total; y += stepPx) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
}

// One viewport: load, settle, scroll through (lazy assets), collect, screenshot.
async function captureWidth(browser, args, width, consoleState, dirs) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    const entry = { type: message.type(), text: message.text(), viewport: width };
    if (message.type() === "error") consoleState.errors.push(entry);
    if (message.type() === "warning") consoleState.warnings.push(entry);
  });
  page.on("pageerror", (error) => {
    consoleState.pageErrors.push({ message: error.message, viewport: width });
  });

  await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  if (args.waitMs > 0) await page.waitForTimeout(args.waitMs);
  await scrollThroughPage(page);

  const signals = await collectSignals(page);
  const screenshotPath = path.join(dirs.screenshotsDir, `${args.label}-${width}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.close();
  return {
    viewport: { width, height: 900 },
    screenshot: path.relative(dirs.outDir, screenshotPath),
    signals,
  };
}

async function recon(args, deps) {
  const { chromium } = deps.loadPlaywright();
  const outDir = path.resolve(args.outDir);
  const dirs = { outDir, screenshotsDir: path.join(outDir, "screenshots") };
  deps.fs.mkdirSync(dirs.screenshotsDir, { recursive: true });

  const consoleState = { errors: [], warnings: [], pageErrors: [] };
  const browser = await deps.launchChromium(chromium);
  const captures = [];
  for (const width of args.widths) {
    captures.push(await captureWidth(browser, args, width, consoleState, dirs));
  }
  await browser.close();

  const result = {
    label: args.label,
    url: args.url,
    capturedAt: deps.now().toISOString(),
    console: consoleState,
    captures,
  };
  const jsonFile = path.join(outDir, `${args.label}-recon.json`);
  deps.fs.writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`);
  deps.fs.writeFileSync(path.join(outDir, `${args.label}-summary.md`), summaryMarkdown(result));
  deps.log(jsonFile);
  return 0;
}

/**
 * CLI entry: recon each viewport width, write `<label>-recon.json` + summary.
 * @returns {Promise<number>} exit code (0 ok, 1 usage error or failure).
 */
export async function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  return runCli({ label: "recon-site", body: () => {
    const args = parseArgs(argv);
    if (args.help || !args.url) {
      usage(io.log);
      return args.help ? 0 : 1;
    }
    return recon(args, io);
  }, report: io.error });
}

await runIfMain({ moduleUrl: import.meta.url, main });
