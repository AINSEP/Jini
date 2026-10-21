#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import { HELP_OPTIONS, num, parseCliArgs, text } from "./lib/cli-args.mjs";
import { runCli, runIfMain } from "./lib/main-guard.mjs";

// Hard dependencies are ports with real defaults wired here at the CLI edge.
const DEFAULT_DEPS = { fs, loadPlaywright, launchChromium, log: console.log, error: console.error, now: () => new Date() };

export function usage(log = console.log) {
  log(`Usage:
  node scripts/network-capture.mjs --url <url> --out RECON/network [--label original] [--wait 5000] [--max-bytes 1000000]

Captures browser requests and saves JSON/text XHR/fetch responses as fixtures.
`);
}

const ARG_SPEC = {
  defaults: { url: "", outDir: "RECON/network", label: "site", waitMs: 5000, maxBytes: 1_000_000 },
  options: {
    ...HELP_OPTIONS,
    "--url": { key: "url", parse: text("") },
    "--out": { key: "outDir", parse: text("RECON/network") },
    "--label": { key: "label", parse: text("site") },
    "--wait": { key: "waitMs", parse: num("5000") },
    "--max-bytes": { key: "maxBytes", parse: num("1000000") },
  },
};

export function parseArgs(argv) {
  return parseCliArgs(argv, ARG_SPEC);
}

export function safeFixtureName(url, contentType) {
  const parsed = new URL(url);
  const cleanPath = parsed.pathname.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "response";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
  const ext = contentType.includes("json") ? ".json" : ".txt";
  return `${cleanPath}-${hash}${ext}`;
}

export function shouldSave(resourceType, contentType) {
  if (!["xhr", "fetch"].includes(resourceType)) return false;
  return /json|text|graphql|javascript/i.test(contentType || "");
}

function requestEntry(request) {
  return {
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    headers: request.headers(),
    postData: request.postData() || "",
  };
}

// Saves an xhr/fetch JSON/text body as a fixture (bounded by --max-bytes);
// a body that cannot be read is recorded as the entry's error.
async function saveFixture(response, entry, args, dirs, deps) {
  try {
    const body = await response.body();
    if (body.length <= args.maxBytes) {
      const file = path.join(dirs.fixturesDir, safeFixtureName(response.url(), entry.contentType));
      deps.fs.writeFileSync(file, body);
      entry.fixture = path.relative(dirs.outDir, file);
      entry.bytes = body.length;
    } else {
      entry.error = `body too large: ${body.length}`;
    }
  } catch (error) {
    entry.error = error.message;
  }
}

async function responseEntry(response, args, dirs, deps) {
  const request = response.request();
  const headers = response.headers();
  const contentType = headers["content-type"] || "";
  const entry = {
    url: response.url(),
    status: response.status(),
    ok: response.ok(),
    method: request.method(),
    resourceType: request.resourceType(),
    contentType,
    fixture: "",
    error: "",
  };
  if (shouldSave(request.resourceType(), contentType)) await saveFixture(response, entry, args, dirs, deps);
  return entry;
}

async function capture(args, deps) {
  const outDir = path.resolve(args.outDir);
  const dirs = { outDir, fixturesDir: path.join(outDir, "fixtures") };
  deps.fs.mkdirSync(dirs.fixturesDir, { recursive: true });

  const { chromium } = deps.loadPlaywright();
  const browser = await deps.launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const requests = [];
  // Playwright does not await event handlers, so each response's entry is kept
  // as a pending promise (in arrival order) and settled before the browser
  // closes: a body still being read would otherwise fail or miss the manifest.
  const pendingResponses = [];
  page.on("request", (request) => {
    requests.push(requestEntry(request));
  });
  page.on("response", (response) => {
    pendingResponses.push(responseEntry(response, args, dirs, deps));
  });

  await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: args.waitMs }).catch(() => {});
  if (args.waitMs > 0) await page.waitForTimeout(args.waitMs);
  const responses = await Promise.all(pendingResponses);
  await browser.close();

  const manifest = {
    label: args.label,
    url: args.url,
    capturedAt: deps.now().toISOString(),
    requestCount: requests.length,
    responseCount: responses.length,
    fixtureCount: responses.filter((response) => response.fixture).length,
    requests,
    responses,
  };

  const manifestFile = path.join(outDir, `${args.label}-network.json`);
  deps.fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  deps.log(manifestFile);
  return 0;
}

/**
 * CLI entry: capture requests and xhr/fetch fixtures into `<label>-network.json`.
 * @returns {Promise<number>} exit code (0 ok, 1 usage error or failure).
 */
export async function main(argv, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  return runCli("network-capture", () => {
    const args = parseArgs(argv);
    if (args.help || !args.url) {
      usage(io.log);
      return args.help ? 0 : 1;
    }
    return capture(args, io);
  }, io.error);
}

await runIfMain(import.meta.url, main);
