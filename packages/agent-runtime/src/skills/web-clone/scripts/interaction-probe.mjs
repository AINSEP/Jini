#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import { HELP_OPTIONS, num, parseCliArgs, text } from "./lib/cli-args.mjs";
import { runCli, runIfMain } from "./lib/main-guard.mjs";

// Hard dependencies are ports with real defaults wired here at the CLI edge;
// tests pass fakes (no real browser, captured output, fixed clock).
const DEFAULT_DEPS = { fs, loadPlaywright, launchChromium, log: console.log, error: console.error, now: () => new Date() };

export function usage(log = console.log) {
  log(`Usage:
  node scripts/interaction-probe.mjs --url <url> --out RECON/interactions [--label original] [--max-clicks 12] [--max-hovers 8] [--wait 800] [--width 1440]

Exercises scroll, hover, safe clicks, and canvas drag gestures, then saves screenshots plus state/network evidence.
`);
}

const ARG_SPEC = {
  defaults: {
    url: "",
    outDir: "RECON/interactions",
    label: "site",
    maxClicks: 12,
    maxHovers: 8,
    waitMs: 800,
    width: 1440,
  },
  options: {
    ...HELP_OPTIONS,
    "--url": { key: "url", parse: text("") },
    "--out": { key: "outDir", parse: text("RECON/interactions") },
    "--label": { key: "label", parse: text("site") },
    "--max-clicks": { key: "maxClicks", parse: num("12") },
    "--max-hovers": { key: "maxHovers", parse: num("8") },
    "--wait": { key: "waitMs", parse: num("800") },
    "--width": { key: "width", parse: num("1440") },
  },
};

export function parseArgs(argv) {
  return parseCliArgs({ argv, ...ARG_SPEC });
}

export function shortHash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

export function safeFileName(label) {
  return label.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "step";
}

function actionRow(action, index) {
  const target = String(action.target || "").replaceAll("|", "\\|");
  const urlAfter = action.after.url.replaceAll("|", "\\|");
  return `| ${index + 1} | ${action.type} | ${target} | ${action.changed ? "yes" : "no"} | ${urlAfter} | ${action.screenshot || ""} |`;
}

export function markdown(result) {
  const lines = [
    `# ${result.label} interaction probe`,
    "",
    `- URL: ${result.url}`,
    `- Actions: ${result.actions.length}`,
    `- Console errors: ${result.consoleErrors.length}`,
    `- Network events: ${result.network.length}`,
    "",
    "## Actions",
    "| # | Type | Target | Changed | URL after | Screenshot |",
    "|---:|---|---|---:|---|---|",
  ];
  result.actions.forEach((action, index) => lines.push(actionRow(action, index)));
  if (result.findings.length) {
    lines.push("");
    lines.push("## Findings");
    for (const finding of result.findings) lines.push(`- ${finding}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function snapshot(page) {
  return page.evaluate(() => {
    const visible = (selector) => Array.from(document.querySelectorAll(selector)).filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }).length;
    const bodyText = document.body?.innerText || "";
    const html = document.documentElement.outerHTML;
    return {
      url: location.href,
      title: document.title || "",
      activeElement: document.activeElement?.tagName?.toLowerCase() || "",
      scrollY: Math.round(window.scrollY),
      bodyTextChars: bodyText.length,
      bodyTextStart: bodyText.trim().replace(/\s+/g, " ").slice(0, 500),
      counts: {
        dialogs: visible("dialog,[role='dialog'],[aria-modal='true']"),
        popovers: visible("[popover],.popover,.modal,.drawer,.menu,[role='menu']"),
        canvases: document.querySelectorAll("canvas").length,
        videos: document.querySelectorAll("video").length,
        buttons: document.querySelectorAll("button,[role='button']").length,
        forms: document.forms.length,
      },
      htmlHash: "__HASH_PLACEHOLDER__",
      htmlLength: html.length,
    };
  });
}

export async function hashSnapshot(page, state) {
  const htmlHash = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    let hash = 0;
    for (let i = 0; i < html.length; i += 1) {
      hash = ((hash << 5) - hash + html.charCodeAt(i)) | 0;
    }
    return String(hash);
  });
  return { ...state, htmlHash };
}

export async function candidates(page) {
  return page.evaluate(() => {
    function selectorFor(node) {
      if (node.id && !/\s/.test(node.id)) return `#${CSS.escape(node.id)}`;
      const parts = [];
      let current = node;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const index = sameTag.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
        current = parent;
      }
      return parts.join(" > ");
    }
    const text = (node) => (node.innerText || node.textContent || node.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width >= 8 && rect.height >= 8 && style.visibility !== "hidden" && style.display !== "none";
    };
    const interactive = Array.from(document.querySelectorAll("button,a[href],summary,input,textarea,select,[role='button'],[tabindex]"))
      .filter(visible)
      .slice(0, 80)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const tag = node.tagName.toLowerCase();
        const href = node.href || node.getAttribute("href") || "";
        const safeClick = tag === "button" || tag === "summary" || node.getAttribute("role") === "button" || href.startsWith("#") || href.startsWith(location.origin);
        return {
          selector: selectorFor(node),
          tag,
          type: node.getAttribute("type") || "",
          role: node.getAttribute("role") || "",
          href,
          text: text(node).slice(0, 120),
          ariaLabel: node.getAttribute("aria-label") || "",
          safeClick,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });
    const canvases = Array.from(document.querySelectorAll("canvas")).filter(visible).slice(0, 4).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        selector: selectorFor(node),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    });
    return { interactive, canvases };
  });
}

export function hasChanged(before, after) {
  if (before.url !== after.url) return true;
  if (before.htmlHash !== after.htmlHash) return true;
  if (before.scrollY !== after.scrollY) return true;
  return JSON.stringify(before.counts) !== JSON.stringify(after.counts);
}

export async function freshPage(browser, args, network, consoleErrors) {
  const page = await browser.newPage({ viewport: { width: args.width, height: 900 }, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const request = response.request();
    if (["xhr", "fetch"].includes(request.resourceType())) {
      network.push({ url: response.url(), status: response.status(), method: request.method(), resourceType: request.resourceType() });
    }
  });
  await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  if (args.waitMs > 0) await page.waitForTimeout(args.waitMs);
  return page;
}

// One performer per planned action type; `planActions` only ever emits
// these four, so the lookup always hits.
const ACTION_PERFORMERS = {
  scroll: (page, action) =>
    page.evaluate((ratio) => window.scrollTo({ top: Math.round((document.documentElement.scrollHeight - window.innerHeight) * ratio), behavior: "instant" }), action.ratio),
  hover: (page, action) => page.locator(action.selector).first().hover({ timeout: 3000 }),
  click: (page, action) => page.locator(action.selector).first().click({ timeout: 4000 }),
  "canvas-drag": async (page, action) => {
    const rect = action.rect;
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + Math.min(180, rect.width * 0.25), y + Math.min(120, rect.height * 0.2), { steps: 8 });
    await page.mouse.up();
  },
};

export async function captureAction(page, outDir, index, action, before) {
  await ACTION_PERFORMERS[action.type](page, action);
  await page.waitForTimeout(450);
  const after = await hashSnapshot(page, await snapshot(page));
  const screenshotName = `${String(index + 1).padStart(2, "0")}-${safeFileName(`${action.type}-${action.target || action.selector || "page"}`)}-${shortHash(JSON.stringify(action))}.png`;
  const screenshotPath = path.join(outDir, "screenshots", screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return {
    ...action,
    before,
    after,
    changed: hasChanged(before, after),
    screenshot: path.relative(outDir, screenshotPath),
  };
}

/** The scripted action list: two scrolls, hovers, safe clicks, canvas drags. */
export function planActions(discovered, args) {
  const label = (item) => item.text || item.ariaLabel || item.selector;
  return [
    { type: "scroll", target: "middle", ratio: 0.5 },
    { type: "scroll", target: "bottom", ratio: 1 },
    ...discovered.interactive.slice(0, args.maxHovers).map((item) => ({ type: "hover", target: label(item), selector: item.selector, meta: item })),
    ...discovered.interactive.filter((item) => item.safeClick).slice(0, args.maxClicks).map((item) => ({ type: "click", target: label(item), selector: item.selector, meta: item })),
    ...discovered.canvases.map((item) => ({ type: "canvas-drag", target: item.selector, selector: item.selector, rect: item.rect })),
  ];
}

// Each action runs on a fresh page so one action's state never leaks into
// the next; a failing action is recorded (unchanged, with its error) rather
// than aborting the probe.
async function runAction(browser, args, evidence, outDir, index, action) {
  const page = await freshPage(browser, args, evidence.network, evidence.consoleErrors);
  const before = await hashSnapshot(page, await snapshot(page));
  let result;
  try {
    result = await captureAction(page, outDir, index, action, before);
  } catch (error) {
    result = { ...action, before, after: before, changed: false, screenshot: "", error: error.message };
  } finally {
    await page.close();
  }
  return result;
}

export function summarizeFindings(discovered, results) {
  const changedCount = results.filter((action) => action.changed).length;
  const findings = [
    `${discovered.interactive.length} visible interactive candidates discovered`,
    `${discovered.canvases.length} visible canvas targets discovered`,
    `${changedCount}/${results.length} actions changed DOM, URL, scroll, or visible overlay counts`,
  ];
  if (discovered.canvases.length) findings.push("Canvas drag evidence exists; inspect screenshots before simplifying WebGL/Canvas behavior.");
  return findings;
}

async function discover(browser, args, evidence, outDir) {
  const seedPage = await freshPage(browser, args, evidence.network, evidence.consoleErrors);
  const initial = await hashSnapshot(seedPage, await snapshot(seedPage));
  const discovered = await candidates(seedPage);
  await seedPage.screenshot({ path: path.join(outDir, "screenshots", "00-initial.png"), fullPage: true });
  await seedPage.close();
  return { initial, discovered };
}

async function probe(args, deps) {
  const outDir = path.resolve(args.outDir);
  deps.fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });

  const { chromium } = deps.loadPlaywright();
  const browser = await deps.launchChromium(chromium);
  const evidence = { network: [], consoleErrors: [] };
  const { initial, discovered } = await discover(browser, args, evidence, outDir);

  const actions = planActions(discovered, args);
  const results = [];
  for (let index = 0; index < actions.length; index += 1) {
    results.push(await runAction(browser, args, evidence, outDir, index, actions[index]));
  }
  await browser.close();

  const result = {
    label: args.label,
    url: args.url,
    capturedAt: deps.now().toISOString(),
    initial,
    discovered,
    actions: results,
    network: evidence.network,
    consoleErrors: evidence.consoleErrors,
    findings: summarizeFindings(discovered, results),
  };
  const jsonFile = path.join(outDir, `${args.label}-interactions.json`);
  const mdFile = path.join(outDir, `${args.label}-interactions.md`);
  deps.fs.writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`);
  deps.fs.writeFileSync(mdFile, markdown(result));
  deps.log(jsonFile);
  return 0;
}

/**
 * CLI entry: parse `argv`, probe the page, write `<label>-interactions.{json,md}`.
 * @returns {Promise<number>} exit code (0 ok, 1 usage error or failure).
 */
export async function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  return runCli({ label: "interaction-probe", body: () => {
    const args = parseArgs(argv);
    if (args.help || !args.url) {
      usage(io.log);
      return args.help ? 0 : 1;
    }
    return probe(args, io);
  }, report: io.error });
}

await runIfMain({ moduleUrl: import.meta.url, main });
