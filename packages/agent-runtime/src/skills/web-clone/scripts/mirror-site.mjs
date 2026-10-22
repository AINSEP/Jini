#!/usr/bin/env node
// mirror-site.mjs — 把"静态构建站"(Astro / Vite SSG / Hugo 等)的部署资产整套镜像下来，做 1:1 忠实复刻。
// 原理: 这类站的"真源码"不在 GitHub，但部署出来的静态资产(HTML + bundle + CSS + 运行时 fetch 的
//       .sog/.buf/.wasm/.riv/字体/图)就是真相。用真浏览器全程滚动一遍捕获每一个真实请求，按路径镜像同源资产。
// 用法:
//   node scripts/mirror-site.mjs --url <URL> --out <dir> [--scroll-step 700] [--settle 2500] [--max-ms 90000]
// 产物:
//   <dir>/site/...                镜像的同源资产(保留路径；目录 URL 存为 index.html)
//   <dir>/mirror-manifest.json    全部请求(同源+第三方) + 每项状态
//   <dir>/own-asset-urls.txt      同源资产路径清单
//   <dir>/third-party.json        第三方 host + 需自托管的 webfont CSS(typekit/google) 提示
// 纪律: 只搬"真实请求到的"资产，不臆造路径。第三方 CDN(字体/wasm/视频)不自动改写——按 third-party.json 人工处理。
//       后续手工: 自托管锁域名字体(典型 Typekit @import) → 改写 CSS @import 为本地 → 删追踪 → 从 site/ 作 web 根服务。
//       完整配方见 references/static-mirror.md。

import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import { HELP_OPTIONS, int, parseCliArgs, text } from "./lib/cli-args.mjs";
import { runIfMain } from "./lib/main-guard.mjs";
import fs from "node:fs";
import path from "node:path";

// 硬依赖(fs / Playwright / 输出)作为端口注入，默认值在 CLI 边界接好；测试传假实现。
const DEFAULT_DEPS = { fs, loadPlaywright, launchChromium, log: console.log, warn: console.warn };

// 未知参数被静默忽略(与原脚本行为一致)，所以 strict: false。
const ARG_SPEC = {
  defaults: { url: "", out: "", scrollStep: 700, settle: 2500, maxMs: 90000, help: false },
  options: {
    ...HELP_OPTIONS,
    "--url": { key: "url", parse: text("") },
    "--out": { key: "out", parse: text("") },
    "--scroll-step": { key: "scrollStep", parse: int("700") },
    "--settle": { key: "settle", parse: int("2500") },
    "--max-ms": { key: "maxMs", parse: int("90000") },
  },
};

export function parseArgs(argv) {
  return parseCliArgs({ argv, ...ARG_SPEC }, { strict: false });
}

export function usage(log = console.log) {
  log(`mirror-site.mjs — 静态构建站全量资产镜像(1:1 忠实复刻)

  node scripts/mirror-site.mjs --url <URL> --out <dir> [--scroll-step 700] [--settle 2500] [--max-ms 90000]

适用: Astro / Vite SSG / Hugo / 任何把客户端运行时输出成可下载静态资产的站(含 WebGL/Canvas 重前端)。
不适用: 真·服务端渲染/数据驱动 SPA(需 network-capture.mjs 做 API 替身)。
配方与后续改写步骤(自托管字体/删追踪/服务) → references/static-mirror.md`);
}

// 同源资产 URL → 本地相对路径(去 query；目录结尾存 index.html)
export function urlToLocalPath(u, origin) {
  let p = u.slice(origin.length);
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  if (p === "" || p.endsWith("/")) p += "index.html";
  return p.replace(/^\/+/, "");
}

// 全程滚动捕获: 先加载，再按步长滚到底、停留 settle，最后回顶。
async function captureAllRequests(page, args, deps) {
  deps.log(`▸ 加载 + 全程滚动捕获: ${args.url}`);
  await page.goto(args.url, { waitUntil: "networkidle", timeout: args.maxMs }).catch((e) => deps.warn("  goto:", e.message));
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= total; y += args.scrollStep) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(180);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(args.settle);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
}

/** 同源资产(含 origin 本身与 origin/)。 */
export function isOwnUrl(url, origin) {
  return url.startsWith(origin + "/") || url === origin || url === origin + "/";
}

async function downloadOwnAssets(ctx, ownUrls, origin, siteDir, deps) {
  const tally = { ok: 0, fail: 0, failed: [] };
  for (const r of ownUrls) {
    const rel = urlToLocalPath(r.url, origin);
    const dest = path.join(siteDir, rel);
    try {
      const resp = await ctx.request.get(r.url); // 复用浏览器网络栈(cookie/TUN/代理一致)
      if (!resp.ok()) { tally.fail++; tally.failed.push(`HTTP${resp.status()} ${rel}`); continue; }
      const buf = await resp.body();
      deps.fs.mkdirSync(path.dirname(dest), { recursive: true });
      deps.fs.writeFileSync(dest, buf);
      tally.ok++;
    } catch (e) {
      tally.fail++; tally.failed.push(`${e.message} ${rel}`);
    }
  }
  return tally;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}

// 第三方 + webfont 提示
export function thirdPartyReport(all, origin) {
  const thirdHosts = [...new Set(all.filter((r) => !r.url.startsWith(origin)).map((r) => hostOf(r.url)))];
  const webfontCss = all.map((r) => r.url).filter((u) => /use\.typekit\.net\/[a-z0-9]+\.css|fonts\.googleapis\.com\/css/i.test(u));
  return { hosts: thirdHosts, webfont_css_to_selfhost: webfontCss };
}

function printReport({ tally, third, siteDir }, log) {
  log(`✅ 镜像完成: ${tally.ok} 成功 / ${tally.fail} 失败 → ${siteDir}`);
  if (tally.failed.length) log("  ⚠️ 失败:\n   " + tally.failed.slice(0, 20).join("\n   "));
  log(`▸ 第三方 host: ${third.hosts.join(", ") || "(无)"}`);
  if (third.webfont_css_to_selfhost.length) log(`▸ 需自托管的 webfont CSS(锁域名,见 static-mirror.md): \n   ${third.webfont_css_to_selfhost.join("\n   ")}`);
  log(`▸ 下一步: 自托管字体 + 改写 CSS @import + 删追踪 → cd ${siteDir} && python3 -m http.server 8124`);
}

async function mirror(args, deps) {
  const origin = new URL(args.url).origin;
  const outRoot = path.resolve(args.out);
  const siteDir = path.join(outRoot, "site");
  deps.fs.mkdirSync(siteDir, { recursive: true });

  const responses = new Map(); // url -> {status, type, ct}
  const pw = deps.loadPlaywright();
  const browser = await deps.launchChromium(pw.chromium);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("response", (resp) => {
    try {
      const h = resp.headers();
      responses.set(resp.url(), { status: resp.status(), type: resp.request().resourceType(), ct: h["content-type"] || "" });
    } catch {}
  });

  await captureAllRequests(page, args, deps);

  const all = [...responses.entries()].map(([url, m]) => ({ url, ...m }));
  const ownUrls = all.filter((r) => isOwnUrl(r.url, origin));

  deps.log(`▸ 捕获请求 ${all.length} 个；同源 ${ownUrls.length} 个，开始下载…`);
  const tally = await downloadOwnAssets(ctx, ownUrls, origin, siteDir, deps);

  const third = thirdPartyReport(all, origin);
  deps.fs.writeFileSync(path.join(outRoot, "mirror-manifest.json"), JSON.stringify(all, null, 2));
  deps.fs.writeFileSync(path.join(outRoot, "own-asset-urls.txt"), ownUrls.map((r) => urlToLocalPath(r.url, origin)).sort().join("\n") + "\n");
  deps.fs.writeFileSync(path.join(outRoot, "third-party.json"), JSON.stringify(third, null, 2));

  printReport({ tally, third, siteDir }, deps.log);
  await browser.close();
}

/**
 * CLI entry. Unlike the try/catch scripts, a failure here propagates (the
 * original script let it crash with a stack trace and exit 1).
 * @returns {Promise<number>} 0 ok, 1 usage error.
 */
export async function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  const args = parseArgs(argv);
  if (args.help || !args.url || !args.out) {
    usage(io.log);
    return args.help ? 0 : 1;
  }
  await mirror(args, io);
  return 0;
}

await runIfMain({ moduleUrl: import.meta.url, main });
