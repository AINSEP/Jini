#!/usr/bin/env node
// asset-harvest.mjs — 把目标页真实用到的图片/字体/媒体"想尽一切办法"全部拔到本地。
//
// 为什么用真浏览器而不是裸 fetch:
//   1. 大站的图片/字体几乎都在第三方 CDN(static.nike.com / use.typekit.net /
//      fonts.gstatic.com …)，带防盗链(referer/UA/cookie 校验)。裸 fetch + 机器人
//      UA 会被 403；复用浏览器网络栈(同一 UA/cookie/协议)则和真实用户无差别。
//   2. 懒加载图(loading=lazy / data-src / IntersectionObserver)只有真滚动才发请求。
//   3. CSS background-image、@font-face、srcset/picture 变体只在渲染时按需请求，
//      静态解析 HTML 抓不全；监听 network response 才是"页面真实用到的资产"全集。
//
// 用法(首选, --url 直接捕获):
//   node scripts/asset-harvest.mjs --url <URL> --out assets [--recon RECON/original-recon.json]
//     [--types image,font,media,stylesheet] [--max-bytes 26214400] [--scroll-step 700] [--settle 2500]
// 兼容旧用法(--recon-only, 无浏览器捕获, 仅按 recon JSON 里的 URL 裸下载):
//   node scripts/asset-harvest.mjs --recon original-recon.json --out assets/original --recon-only
//
// 产物:
//   <out>/images/<host>/<name>   全部图片(含第三方 CDN、srcset 变体、CSS 背景图)
//   <out>/fonts/<host>/<name>    全部字体二进制(woff2/woff/ttf/otf)
//   <out>/fonts/fonts.css        自托管 @font-face(从 webfont CSS + @font-face 规则改写为本地路径)
//   <out>/media/<host>/<name>    音视频(受 --max-bytes 限制)
//   <out>/asset-manifest.json    originalUrl → localPath 全映射 + 每项状态
//     构建复刻页时照 manifest 机械替换引用，禁止凭记忆写外链。
//
// Module shape: importing this file has no side effects. The CLI edge at the
// bottom runs `main` only when the file is executed directly; `main` takes its
// hard dependencies (fs, fetch, browser launcher, console, cwd) as an optional
// ports object so the harvesting logic is testable without a real browser.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import { flag, list, parseCliArgs, rejectUnknown, runIfMain, text } from "./lib/script-cli.mjs";

export function usage(log) {
  log(`asset-harvest.mjs — 抓取页面真实用到的图片/字体/媒体(含第三方 CDN)并生成本地映射

  node scripts/asset-harvest.mjs --url <URL> --out assets [--recon RECON/original-recon.json]
    [--types image,font,media,stylesheet] [--max-bytes 26214400] [--scroll-step 700] [--settle 2500]

产物: <out>/{images,fonts,media}/<host>/<name> + <out>/fonts/fonts.css(自托管 @font-face)
      + <out>/asset-manifest.json(originalUrl → localPath, 构建时照此机械替换)`);
}

const ARG_SPEC = {
  defaults: {
    url: "",
    recon: "",
    outDir: "assets",
    manifest: "",
    types: ["image", "font", "media", "stylesheet"],
    maxBytes: 25 * 1024 * 1024,
    scrollStep: 700,
    settle: 2500,
    reconOnly: false,
    allExternal: true,
  },
  flags: {
    "--help": flag("help"),
    "-h": flag("help"),
    "--url": { key: "url", read: text() },
    "--recon": { key: "recon", read: text() },
    "--out": { key: "outDir", read: text("assets") },
    "--manifest": { key: "manifest", read: text() },
    "--types": { key: "types", read: list() },
    "--max-bytes": { key: "maxBytes", read: (raw, out) => Number(raw || out.maxBytes) },
    "--scroll-step": { key: "scrollStep", read: (raw) => Number(raw || "700") },
    "--settle": { key: "settle", read: (raw) => Number(raw || "2500") },
    "--recon-only": flag("reconOnly"),
    "--all-external": flag("allExternal"),
  },
  onOther: rejectUnknown,
};

export function parseArgs(argv) {
  return parseCliArgs(argv, ARG_SPEC);
}

const FONT_EXT = /\.(woff2?|ttf|otf|eot)(?:$|[?#])/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)(?:$|[?#])/i;
const MEDIA_EXT = /\.(mp4|webm|m4v|mov|mp3|ogg|wav)(?:$|[?#])/i;
const WEBFONT_CSS = /use\.typekit\.net\/[a-z0-9]+\.css|fonts\.googleapis\.com\/css/i;

// First match wins, in this order: a font served as image/* is still a font.
const KIND_TESTS = [
  ["font", (url, rt, ct) => ct.startsWith("font/") || ct.includes("font-woff") || FONT_EXT.test(url)],
  ["image", (url, rt, ct) => ct.startsWith("image/") || rt === "image" || IMAGE_EXT.test(url)],
  ["media", (url, rt, ct) => ct.startsWith("video/") || ct.startsWith("audio/") || rt === "media" || MEDIA_EXT.test(url)],
  ["stylesheet", (url, rt, ct) => ct.includes("text/css") || rt === "stylesheet"],
];

export function classify(url, resourceType, contentType) {
  const ct = (contentType || "").toLowerCase();
  const hit = KIND_TESTS.find(([, test]) => test(url, resourceType, ct));
  return hit ? hit[0] : null;
}

function safeName(url) {
  const parsed = new URL(url);
  const ext = path.extname(parsed.pathname).slice(0, 12);
  const base = path.basename(parsed.pathname, ext).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80) || "asset";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
  return `${base}-${hash}${ext || ".bin"}`;
}

const KIND_DIRS = { image: "images", font: "fonts", media: "media" };

export function localPathFor(kind, url) {
  const host = new URL(url).hostname.replace(/[^a-z0-9.-]+/gi, "-");
  return path.join(KIND_DIRS[kind] || "css", host, safeName(url));
}

const arr = (value) => value || [];

function imageRefs(image) {
  const srcset = String(image.srcset || "").split(",").map((candidate) => [candidate.trim().split(/\s+/)[0], "image"]);
  return [[image.src, "image"], ...srcset];
}

// One capture's statically visible refs as [raw, hintedKind, base?] tuples,
// in the order the first-hinted kind should win.
function captureRefs(capture) {
  const signals = capture.signals || {};
  const resources = signals.resources || {};
  return [
    ...arr(signals.images).flatMap(imageRefs),
    ...arr(signals.fontFaces).flatMap((face) => arr(face.srcUrls).map((src) => [src, "font", face.sheetHref])),
    ...arr(signals.stylesheets).map((href) => [href, "stylesheet"]),
    ...arr(resources.images).map((url) => [url, "image"]),
    ...arr(resources.fonts).map((url) => [url, "font"]),
    ...arr(resources.media).map((url) => [url, "media"]),
  ];
}

function absoluteHttpUrl(raw, base) {
  let abs = "";
  try {
    abs = new URL(raw, base).href;
  } catch {
    // relative ref with no usable base, or not a URL at all: skip it
  }
  return /^https?:/i.test(abs) ? abs : null;
}

// recon JSON 里能静态看出来的 URL(img src/srcset、@font-face src、stylesheet)——
// 补充给 network 捕获兜底(比如首屏截图后才出现的资源)。
export function urlsFromRecon(recon) {
  const urls = new Map(); // url -> hinted kind
  for (const capture of arr(recon.captures)) {
    for (const [raw, kind, base] of captureRefs(capture)) {
      const abs = raw ? absoluteHttpUrl(raw, base || recon.url) : null;
      if (abs && !urls.has(abs)) urls.set(abs, kind);
    }
  }
  return urls;
}

function localFontRef(ref, cssUrl, urlToLocal) {
  let local;
  try {
    local = urlToLocal.get(new URL(ref, cssUrl).href);
  } catch {
    // unresolvable ref: leave the url() exactly as written
  }
  // fonts.css 落在 <out>/fonts/ 下，字体在 <out>/fonts/<host>/,
  // 所以相对引用去掉前导 "fonts/"。
  return local ? path.relative("fonts", local).split(path.sep).join("/") : null;
}

// 把 webfont CSS / @font-face 源 CSS 里的 url(...) 改写为本地字体路径，
// 汇总成一份可直接 <link> 的 fonts.css。
export function rewriteFontCss(cssText, cssUrl, urlToLocal) {
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, ref) => {
    const local = localFontRef(ref, cssUrl, urlToLocal);
    return local ? `url(${quote}${local}${quote})` : match;
  });
}

// Download transports share one shape: (url, referer) -> { ok, status, body() }.
// The browser context reuses the page's network stack (UA/cookies); plain
// fetch is the --recon-only fallback.
function playwrightTransport(ctx) {
  return async (url, referer) => {
    const resp = await ctx.request.get(url, { headers: { referer }, maxRedirects: 5 });
    return { ok: resp.ok(), status: resp.status(), body: () => resp.body() };
  };
}

function fetchTransport(fetchImpl) {
  return async (url, referer) => {
    const resp = await fetchImpl(url, { headers: { referer, accept: "*/*" } });
    return { ok: resp.ok, status: resp.status, body: async () => Buffer.from(await resp.arrayBuffer()) };
  };
}

async function downloadOne(entry, get, { outDir, maxBytes, referer, fs: files }) {
  const rel = localPathFor(entry.kind, entry.url);
  const resp = await get(entry.url, referer);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buffer = await resp.body();
  if (buffer.length > maxBytes) throw new Error(`exceeds --max-bytes (${buffer.length})`);
  const dest = path.join(outDir, rel);
  files.mkdirSync(path.dirname(dest), { recursive: true });
  files.writeFileSync(dest, buffer);
  return { ...entry, status: "ok", bytes: buffer.length, localPath: rel.split(path.sep).join("/") };
}

/** Sequentially downloads every entry; a failure is recorded, never thrown. */
export async function downloadAll(entries, get, options) {
  const results = [];
  for (const entry of entries) {
    results.push(await downloadOne(entry, get, options).catch((error) => ({ ...entry, status: "error", error: error.message })));
  }
  return results;
}

function createCandidates(types) {
  const byUrl = new Map(); // url -> {url, kind, via}; first sighting wins
  return {
    add(url, kind, via) {
      if (types.includes(kind) && !byUrl.has(url)) byUrl.set(url, { url, kind, via });
    },
    list: () => Array.from(byUrl.values()),
  };
}

function recordResponse(resp, candidates) {
  try {
    candidates.add(resp.url(), classify(resp.url(), resp.request().resourceType(), resp.headers()["content-type"]), "network");
  } catch {
    // a response whose metadata can no longer be read (page torn down) is skipped
  }
}

// Loads the page and scrolls its full height so lazy images / on-demand
// fonts actually hit the network; every classified response becomes a candidate.
async function captureNetworkAssets(page, { pageUrl, args, io, candidates }) {
  page.on("response", (resp) => recordResponse(resp, candidates));
  io.log(`▸ 加载 + 全程滚动捕获资产请求: ${pageUrl}`);
  await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 90000 }).catch((e) => io.warn("  goto:", e.message));
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= total; y += args.scrollStep) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(args.settle);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  await page.close();
}

// One downloaded webfont stylesheet as a self-hosted block. A stylesheet that
// cannot be read back is skipped so the remaining CSS, the recon @font-face
// rules and the asset manifest are still written.
function webfontCssBlock(css, { outDir, urlToLocal, files }) {
  let cssText;
  try {
    cssText = files.readFileSync(path.join(outDir, css.localPath), "utf8");
  } catch {
    return [];
  }
  return [`/* self-hosted from ${css.url} */\n${rewriteFontCss(cssText, css.url, urlToLocal)}`];
}

// 自托管 @font-face: 抓 webfont CSS(typekit/google fonts) + recon 里的 @font-face
// 规则，把 url() 改写成本地字体路径，汇成一份 fonts.css。Returns whether it was written.
export function writeFontsCss(results, recon, { pageUrl, outDir, fs: files }) {
  const okResults = results.filter((r) => r.status === "ok");
  const urlToLocal = new Map(okResults.map((r) => [r.url, r.localPath]));
  const blocks = okResults
    .filter((r) => r.kind === "stylesheet" && WEBFONT_CSS.test(r.url))
    .flatMap((css) => webfontCssBlock(css, { outDir, urlToLocal, files }));
  for (const capture of arr(recon?.captures)) {
    for (const face of arr(capture.signals?.fontFaces)) {
      if (face.cssText) blocks.push(rewriteFontCss(face.cssText, face.sheetHref || pageUrl, urlToLocal));
    }
  }
  if (!blocks.length) return false;
  const fontsDir = path.join(outDir, "fonts");
  files.mkdirSync(fontsDir, { recursive: true });
  files.writeFileSync(path.join(fontsDir, "fonts.css"), `${Array.from(new Set(blocks)).join("\n\n")}\n`);
  return true;
}

function writeManifest(manifestFile, { pageUrl, args, results, hasFontsCss, fs: files }) {
  const okCount = results.filter((r) => r.status === "ok").length;
  files.mkdirSync(path.dirname(manifestFile), { recursive: true });
  files.writeFileSync(manifestFile, `${JSON.stringify({
    url: pageUrl,
    capturedVia: args.reconOnly ? "recon-only" : "browser-network+recon",
    total: results.length,
    ok: okCount,
    error: results.length - okCount,
    fontsCss: hasFontsCss ? "fonts/fonts.css" : null,
    assets: results,
  }, null, 2)}\n`);
  return okCount;
}

function reportSummary({ io, args, outDir, results, okCount, hasFontsCss, manifestFile }) {
  io.log(`✅ 下载 ${okCount} 成功 / ${results.length - okCount} 失败 → ${outDir}`);
  if (hasFontsCss) io.log(`▸ 自托管字体样式: ${path.join(args.outDir, "fonts/fonts.css")} (页面 <link> 引入即可)`);
  const failedFonts = results.filter((r) => r.kind === "font" && r.status === "error");
  if (failedFonts.length) io.log(`⚠️ ${failedFonts.length} 个字体下载失败——不许用系统字体糊弄，逐个排查:\n   ${failedFonts.map((f) => `${f.error} ${f.url}`).slice(0, 10).join("\n   ")}`);
  io.log(manifestFile);
}

function loadRecon(args, io) {
  return args.recon ? JSON.parse(io.fs.readFileSync(path.resolve(io.cwd(), args.recon), "utf8")) : null;
}

// 候选资产: network 捕获(权威) + recon 静态清单(兜底)。
async function collectCandidates({ args, recon, pageUrl, io, session }) {
  const candidates = createCandidates(args.types);
  let get = fetchTransport(io.fetch);
  if (!args.reconOnly) {
    session.browser = await io.launchBrowser();
    const ctx = await session.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await captureNetworkAssets(await ctx.newPage(), { pageUrl, args, io, candidates });
    get = playwrightTransport(ctx);
  }
  for (const [url, kind] of recon ? urlsFromRecon(recon) : []) candidates.add(url, kind, "recon");
  return { entries: candidates.list(), get };
}

async function harvest(argv, io, session) {
  const args = parseArgs(argv);
  if (args.help || (!args.url && !args.recon)) {
    usage(io.log);
    return args.help ? 0 : 1;
  }
  const recon = loadRecon(args, io);
  const pageUrl = args.url || recon?.url;
  if (!pageUrl) throw new Error("need --url or a recon JSON with a url");
  const outDir = path.resolve(io.cwd(), args.outDir);

  const { entries, get } = await collectCandidates({ args, recon, pageUrl, io, session });
  const fontCount = entries.filter((e) => e.kind === "font").length;
  const imageCount = entries.filter((e) => e.kind === "image").length;
  io.log(`▸ 候选资产 ${entries.length} 个(图片 ${imageCount} / 字体 ${fontCount})，开始下载…`);

  const results = await downloadAll(entries, get, { outDir, maxBytes: args.maxBytes, referer: pageUrl, fs: io.fs });
  const hasFontsCss = writeFontsCss(results, recon, { pageUrl, outDir, fs: io.fs });
  const manifestFile = path.resolve(io.cwd(), args.manifest || path.join(args.outDir, "asset-manifest.json"));
  const okCount = writeManifest(manifestFile, { pageUrl, args, results, hasFontsCss, fs: io.fs });
  reportSummary({ io, args, outDir, results, okCount, hasFontsCss, manifestFile });
  return 0;
}

const PLAYWRIGHT = { load: loadPlaywright, launch: launchChromium };

/** Real-browser launcher (the default `launchBrowser` port). */
export async function launchBrowser(loaders = {}) {
  const { load, launch } = { ...PLAYWRIGHT, ...loaders };
  return launch(load().chromium);
}

const DEFAULT_DEPS = {
  fs,
  fetch,
  launchBrowser,
  log: console.log,
  warn: console.warn,
  error: console.error,
  cwd: process.cwd,
};

/**
 * CLI entry: harvests, writes the manifest, and returns the exit code
 * (0 ok / help, 1 usage error or failure). Any browser it opened is closed
 * before returning, on success and on failure.
 */
export async function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  const session = { browser: null };
  const code = await harvest(argv, io, session).catch((error) => {
    io.error(`asset-harvest failed: ${error.message}`);
    return 1;
  });
  if (session.browser) await session.browser.close();
  return code;
}

await runIfMain({ moduleUrl: import.meta.url, main });
