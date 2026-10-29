#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import { HELP_OPTIONS, num, parseCliArgs, text } from "./lib/cli-args.mjs";
import { runCli, runIfMain } from "./lib/main-guard.mjs";
import { trimDashes } from "./lib/trim-dashes.mjs";

// Hard dependencies are ports with real defaults wired here at the CLI edge;
// tests pass fakes (no real browser, captured output, fixed clock).
const DEFAULT_DEPS = { fs, loadPlaywright, launchChromium, log: console.log, error: console.error, now: () => new Date() };

export function usage(log = console.log) {
  log(`Usage:
  node scripts/route-crawl.mjs --url <url> --out RECON/routes [--label original] [--max-pages 25] [--max-depth 2] [--width 1440] [--wait 800] [--allow-subdomains]

Crawls same-site internal links, captures a screenshot per route, and writes a route map.
`);
}

const ARG_SPEC = {
  defaults: {
    url: "",
    outDir: "RECON/routes",
    label: "site",
    maxPages: 25,
    maxDepth: 2,
    width: 1440,
    waitMs: 800,
    allowSubdomains: false,
  },
  options: {
    ...HELP_OPTIONS,
    "--url": { key: "url", parse: text("") },
    "--out": { key: "outDir", parse: text("RECON/routes") },
    "--label": { key: "label", parse: text("site") },
    "--max-pages": { key: "maxPages", parse: num("25") },
    "--max-depth": { key: "maxDepth", parse: num("2") },
    "--width": { key: "width", parse: num("1440") },
    "--wait": { key: "waitMs", parse: num("800") },
    "--allow-subdomains": { key: "allowSubdomains", flag: true },
  },
};

export function parseArgs(argv) {
  return parseCliArgs({ argv, ...ARG_SPEC });
}

/** Canonical http(s) URL (no hash, sorted query, no trailing slash), or "". */
export function normalizeUrl(rawUrl, baseUrl) {
  let normalized = "";
  try {
    const url = new URL(rawUrl, baseUrl);
    if (["http:", "https:"].includes(url.protocol)) {
      url.hash = "";
      url.searchParams.sort();
      normalized = url.toString().replace(/\/$/, "");
    }
  } catch {
    // Unparsable href: not crawlable.
  }
  return normalized;
}

export function sameSite(candidate, origin, allowSubdomains) {
  const url = new URL(candidate);
  const root = new URL(origin);
  if (url.origin === root.origin) return true;
  return allowSubdomains && url.hostname.endsWith(`.${root.hostname}`);
}

// Only called with normalized http(s) URLs, whose hostname is never empty
// and always keeps at least one [a-z0-9] after sanitizing — so the cleaned
// name can never be empty.
export function routeFileName(url) {
  const parsed = new URL(url);
  const clean = trimDashes(`${parsed.hostname}${parsed.pathname}`.replace(/[^a-z0-9._-]+/gi, "-")).slice(0, 90);
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
  return `${clean}-${hash}.png`;
}

function routeRow(route) {
  const url = new URL(route.url);
  // Routes are normalized http(s) URLs, whose pathname is never empty.
  const pathLabel = `${url.pathname}${url.search}`;
  const title = route.title.replaceAll("|", "\\|");
  const h1 = route.h1.join(" / ").replaceAll("|", "\\|");
  return `| ${route.depth} | ${route.status || ""} | ${pathLabel} | ${title} | ${h1} | ${route.linkCount} | ${route.screenshot} |`;
}

export function summarizeMarkdown(result) {
  const lines = [
    `# ${result.label} route map`,
    "",
    `- URL: ${result.url}`,
    `- Captured routes: ${result.routes.length}`,
    `- Max depth: ${result.maxDepth}`,
    `- Max pages: ${result.maxPages}`,
    "",
    "## Routes",
    "| Depth | Status | Path | Title | H1 | Links | Screenshot |",
    "|---:|---:|---|---|---|---:|---|",
  ];
  for (const route of result.routes) lines.push(routeRow(route));
  if (result.skipped.length) {
    lines.push("");
    lines.push("## Skipped / Failed");
    for (const item of result.skipped.slice(0, 80)) {
      lines.push(`- ${item.url} · ${item.reason}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function collectPage(page) {
  return page.evaluate(() => {
    const text = (node) => (node?.textContent || "").trim().replace(/\s+/g, " ");
    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      href: a.href,
      text: text(a).slice(0, 120),
    }));
    const headings = Array.from(document.querySelectorAll("h1,h2,h3")).slice(0, 40).map((node) => ({
      tag: node.tagName.toLowerCase(),
      text: text(node).slice(0, 160),
    }));
    return {
      href: location.href,
      title: document.title || "",
      lang: document.documentElement.lang || "",
      metaDescription: document.querySelector("meta[name='description']")?.content || "",
      h1: Array.from(document.querySelectorAll("h1")).map((node) => text(node)).filter(Boolean).slice(0, 8),
      headings,
      scrollHeight: document.documentElement.scrollHeight,
      counts: {
        links: links.length,
        images: document.images.length,
        canvas: document.querySelectorAll("canvas").length,
        forms: document.forms.length,
        buttons: document.querySelectorAll("button,[role='button']").length,
      },
      links,
    };
  });
}

function enqueueLinks(links, current, crawl) {
  for (const link of links) {
    const nextUrl = normalizeUrl(link.href, current.url);
    if (!nextUrl || crawl.seen.has(nextUrl)) continue;
    if (!sameSite(nextUrl, crawl.startUrl, crawl.args.allowSubdomains)) continue;
    crawl.queue.push({ url: nextUrl, depth: current.depth + 1, from: current.url });
  }
}

// Load one route, record it (status, headings, counts, screenshot, console
// errors), and enqueue its same-site links; a failed load becomes a
// skipped entry with the error as its reason.
async function visit(page, current, crawl) {
  const { args, dirs } = crawl;
  const consoleErrors = [];
  const onConsole = (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  };
  page.on("console", onConsole);
  try {
    const response = await page.goto(current.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    if (args.waitMs > 0) await page.waitForTimeout(args.waitMs);
    const data = await collectPage(page);
    const screenshotPath = path.join(dirs.screenshotsDir, routeFileName(current.url));
    await page.screenshot({ path: screenshotPath, fullPage: true });
    crawl.routes.push({
      url: current.url,
      from: current.from,
      depth: current.depth,
      status: response?.status() || 0,
      title: data.title,
      lang: data.lang,
      metaDescription: data.metaDescription,
      h1: data.h1,
      headings: data.headings,
      counts: data.counts,
      linkCount: data.links.length,
      screenshot: path.relative(dirs.outDir, screenshotPath),
      consoleErrors,
    });
    enqueueLinks(data.links, current, crawl);
  } catch (error) {
    crawl.skipped.push({ url: current.url, reason: error.message });
  } finally {
    page.off("console", onConsole);
  }
}

// Breadth-first over the queue. Every queued URL is same-site by
// construction (the start URL, plus links filtered by `enqueueLinks`), and
// the loop condition guarantees a non-empty queue, so a dequeued entry only
// needs the seen/depth checks.
async function crawlRoutes(page, crawl) {
  const { args } = crawl;
  while (crawl.queue.length && crawl.routes.length < args.maxPages) {
    const current = crawl.queue.shift();
    if (crawl.seen.has(current.url)) continue;
    crawl.seen.add(current.url);
    if (current.depth > args.maxDepth) {
      crawl.skipped.push({ url: current.url, reason: `depth>${args.maxDepth}` });
      continue;
    }
    await visit(page, current, crawl);
  }
}

async function crawlSite(args, deps) {
  const startUrl = normalizeUrl(args.url, args.url);
  if (!startUrl) throw new Error(`Invalid URL: ${args.url}`);

  const outDir = path.resolve(args.outDir);
  const dirs = { outDir, screenshotsDir: path.join(outDir, "screenshots") };
  deps.fs.mkdirSync(dirs.screenshotsDir, { recursive: true });

  const { chromium } = deps.loadPlaywright();
  const browser = await deps.launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: args.width, height: 900 }, deviceScaleFactor: 1 });

  const crawl = { args, dirs, startUrl, queue: [{ url: startUrl, depth: 0, from: "" }], seen: new Set(), routes: [], skipped: [] };
  await crawlRoutes(page, crawl);
  await browser.close();

  const result = {
    label: args.label,
    url: startUrl,
    capturedAt: deps.now().toISOString(),
    maxPages: args.maxPages,
    maxDepth: args.maxDepth,
    allowSubdomains: args.allowSubdomains,
    routes: crawl.routes,
    skipped: crawl.skipped,
  };
  const jsonFile = path.join(outDir, `${args.label}-route-map.json`);
  const mdFile = path.join(outDir, `${args.label}-route-map.md`);
  deps.fs.writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`);
  deps.fs.writeFileSync(mdFile, summarizeMarkdown(result));
  deps.log(jsonFile);
  return 0;
}

/**
 * CLI entry: crawl same-site routes and write `<label>-route-map.{json,md}`.
 * @returns {Promise<number>} exit code (0 ok, 1 usage error or failure).
 */
export async function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  return runCli({ label: "route-crawl", body: () => {
    const args = parseArgs(argv);
    if (args.help || !args.url) {
      usage(io.log);
      return args.help ? 0 : 1;
    }
    return crawlSite(args, io);
  }, report: io.error });
}

await runIfMain({ moduleUrl: import.meta.url, main });
