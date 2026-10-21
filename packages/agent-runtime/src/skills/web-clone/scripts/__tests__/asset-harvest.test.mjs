import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classify,
  downloadAll,
  launchBrowser,
  localPathFor,
  main,
  parseArgs,
  rewriteFontCss,
  urlsFromRecon,
} from "../asset-harvest.mjs";
import { fakeBrowser, fakeFetch, fakeNetworkResponse, makeIo, makeTempDir } from "./fakes-wc1.mjs";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("returns the documented defaults for an empty argv", () => {
    expect(parseArgs([])).toEqual({
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
    });
  });

  it("reads every value flag and switch", () => {
    const args = parseArgs([
      "--url", "https://a.test/", "--recon", "r.json", "--out", "o", "--manifest", "m.json",
      "--types", " image, ,font ", "--max-bytes", "10", "--scroll-step", "50", "--settle", "7",
      "--recon-only", "--all-external", "-h",
    ]);
    expect(args).toMatchObject({
      url: "https://a.test/", recon: "r.json", outDir: "o", manifest: "m.json", types: ["image", "font"],
      maxBytes: 10, scrollStep: 50, settle: 7, reconOnly: true, allExternal: true, help: true,
    });
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("falls back per flag when the trailing value is missing", () => {
    expect(parseArgs(["--max-bytes", "5", "--max-bytes"]).maxBytes).toBe(5);
    expect(parseArgs(["--out"]).outDir).toBe("assets");
    expect(parseArgs(["--scroll-step"]).scrollStep).toBe(700);
    expect(parseArgs(["--settle"]).settle).toBe(2500);
    expect(parseArgs(["--types"]).types).toEqual([]);
    expect(parseArgs(["--url"]).url).toBe("");
  });

  it("rejects unknown arguments, including Object.prototype names", () => {
    expect(() => parseArgs(["--nope"])).toThrow("Unexpected argument: --nope");
    expect(() => parseArgs(["constructor"])).toThrow("Unexpected argument: constructor");
  });
});

describe("classify", () => {
  it("prefers font over every other signal", () => {
    expect(classify("https://x/a", "image", "font/woff2")).toBe("font");
    expect(classify("https://x/a", "other", "application/font-woff")).toBe("font");
    expect(classify("https://x/a.woff2?v=1", "other", undefined)).toBe("font");
  });

  it("detects images by content type, resource type or extension", () => {
    expect(classify("https://x/a", "other", "IMAGE/PNG")).toBe("image");
    expect(classify("https://x/a", "image", "")).toBe("image");
    expect(classify("https://x/a.svg#frag", "other", "")).toBe("image");
  });

  it("detects media by video/audio type, resource type or extension", () => {
    expect(classify("https://x/a", "other", "video/mp4")).toBe("media");
    expect(classify("https://x/a", "other", "audio/mpeg")).toBe("media");
    expect(classify("https://x/a", "media", "")).toBe("media");
    expect(classify("https://x/a.webm", "other", "")).toBe("media");
  });

  it("detects stylesheets and ignores everything else", () => {
    expect(classify("https://x/a", "other", "text/css; charset=utf-8")).toBe("stylesheet");
    expect(classify("https://x/a", "stylesheet", "")).toBe("stylesheet");
    expect(classify("https://x/app.js", "script", "text/javascript")).toBeNull();
  });
});

describe("localPathFor", () => {
  it("files each kind under its folder and host with a hashed, sanitized name", () => {
    const image = localPathFor("image", "https://cdn.ex-ample.com/p/hero shot.PNG?x=1");
    expect(image).toMatch(/^images\/cdn\.ex-ample\.com\/hero-20shot-[0-9a-f]{10}\.PNG$/);
    expect(localPathFor("font", "https://f.test/a.woff2")).toMatch(/^fonts\/f\.test\/a-[0-9a-f]{10}\.woff2$/);
    expect(localPathFor("media", "https://m.test/v.mp4")).toMatch(/^media\/m\.test\//);
    expect(localPathFor("stylesheet", "https://s.test/c.css")).toMatch(/^css\/s\.test\//);
  });

  it("names extensionless and empty paths asset/.bin, and hashes per URL", () => {
    expect(localPathFor("image", "https://a.test/")).toMatch(/^images\/a\.test\/asset-[0-9a-f]{10}\.bin$/);
    expect(localPathFor("image", "https://a.test/x?1")).not.toBe(localPathFor("image", "https://a.test/x?2"));
  });
});

describe("urlsFromRecon", () => {
  it("collects image src/srcset, @font-face srcs, stylesheets and resource lists as absolute URLs", () => {
    const urls = urlsFromRecon({
      url: "https://site.test/page/",
      captures: [
        {
          signals: {
            images: [{ src: "hero.png", srcset: "a.png 1x, https://cdn.test/b.png 2x" }, { src: "" }],
            fontFaces: [{ srcUrls: ["../f.woff2"], sheetHref: "https://site.test/css/main.css" }, {}],
            stylesheets: ["/main.css"],
            resources: { images: ["https://cdn.test/r.jpg"], fonts: ["https://cdn.test/r.woff"], media: ["https://cdn.test/v.mp4"] },
          },
        },
        {},
      ],
    });
    expect(Object.fromEntries(urls)).toEqual({
      "https://site.test/page/hero.png": "image",
      "https://site.test/page/a.png": "image",
      "https://cdn.test/b.png": "image",
      "https://site.test/f.woff2": "font",
      "https://site.test/main.css": "stylesheet",
      "https://cdn.test/r.jpg": "image",
      "https://cdn.test/r.woff": "font",
      "https://cdn.test/v.mp4": "media",
    });
  });

  it("keeps the first hinted kind, skips non-http and unresolvable refs", () => {
    const urls = urlsFromRecon({
      captures: [
        { signals: { images: [{ src: "https://x.test/dup" }, { src: "data:image/png;base64,AA" }, { src: "relative-without-base.png" }] } },
        { signals: { resources: { fonts: ["https://x.test/dup"] } } },
      ],
    });
    expect(Object.fromEntries(urls)).toEqual({ "https://x.test/dup": "image" });
    expect(urlsFromRecon({}).size).toBe(0);
  });
});

describe("rewriteFontCss", () => {
  const map = new Map([["https://fonts.test/a.woff2", "fonts/fonts.test/a-1.woff2"]]);

  it("rewrites url() refs it downloaded to paths relative to fonts/, keeping quotes", () => {
    const css = `src: url("a.woff2") format("woff2"), url( 'https://other.test/b.woff' ), url(a.woff2);`;
    expect(rewriteFontCss(css, "https://fonts.test/css", map)).toBe(
      `src: url("fonts.test/a-1.woff2") format("woff2"), url( 'https://other.test/b.woff' ), url(fonts.test/a-1.woff2);`,
    );
  });

  it("leaves refs untouched when they cannot be resolved against the CSS URL", () => {
    expect(rewriteFontCss("url(a.woff2)", "not a url", map)).toBe("url(a.woff2)");
  });
});

describe("downloadAll", () => {
  it("records HTTP errors, oversize bodies and transport failures without throwing", async () => {
    const dir = makeTempDir();
    const get = async (url) => {
      if (url.endsWith("boom")) throw new Error("socket hang up");
      if (url.endsWith("big")) return { ok: true, status: 200, body: async () => Buffer.alloc(11) };
      return { ok: false, status: 503, body: async () => Buffer.alloc(0) };
    };
    const entries = ["https://a.test/boom", "https://a.test/big", "https://a.test/down"].map((url) => ({ url, kind: "image", via: "recon" }));
    const results = await downloadAll(entries, get, { outDir: dir, maxBytes: 10, referer: "https://a.test/", fs });
    expect(results.map((r) => [r.status, r.error])).toEqual([
      ["error", "socket hang up"],
      ["error", "exceeds --max-bytes (11)"],
      ["error", "HTTP 503"],
    ]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("launchBrowser", () => {
  it("launches the loaded Playwright chromium through the injected loaders", async () => {
    const chromium = { name: "chromium" };
    const launched = await launchBrowser({ load: () => ({ chromium }), launch: async (c) => ({ launchedWith: c }) });
    expect(launched).toEqual({ launchedWith: chromium });
  });
});

describe("main", () => {
  it("prints usage and exits 0 for --help, 1 when neither --url nor --recon is given", async () => {
    const { io, out } = makeIo("/nowhere");
    expect(await main({ argv: ["--help"] }, io)).toBe(0);
    expect(await main({ argv: [] }, io)).toBe(1);
    expect(out.logs).toHaveLength(2);
    expect(out.logs[0]).toContain("node scripts/asset-harvest.mjs --url <URL>");
  });

  it("falls back to the real fs/console ports when none are injected", async () => {
    const dir = makeTempDir();
    const reconFile = path.join(dir, "recon.json");
    fs.writeFileSync(reconFile, JSON.stringify({ url: "https://site.test/", captures: [] }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main({ argv: ["--recon", reconFile, "--recon-only", "--out", path.join(dir, "out")] })).toBe(0);
    expect(readJson(path.join(dir, "out", "asset-manifest.json"))).toMatchObject({ url: "https://site.test/", total: 0, assets: [] });
  });

  it("reports failures on stderr and exits 1", async () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "recon.json"), JSON.stringify({ captures: [] }));
    const { io, out } = makeIo(dir);
    expect(await main({ argv: ["--recon", "recon.json", "--recon-only"] }, io)).toBe(1);
    expect(await main({ argv: ["--bad"] }, io)).toBe(1);
    expect(out.errors).toEqual([
      "asset-harvest failed: need --url or a recon JSON with a url",
      "asset-harvest failed: Unexpected argument: --bad",
    ]);
  });

  it("--recon-only downloads recon URLs with fetch, self-hosts @font-face and writes the manifest", async () => {
    const dir = makeTempDir();
    const recon = {
      url: "https://site.test/",
      captures: [
        {
          signals: {
            images: [{ src: "/logo.png" }, { src: "/missing.png" }],
            fontFaces: [
              { srcUrls: ["/f/brand.woff2"], cssText: "@font-face{font-family:B;src:url(/f/brand.woff2)}" },
              { srcUrls: ["https://cdn.test/x.woff2"], sheetHref: "https://cdn.test/s.css", cssText: "@font-face{src:url(x.woff2)}" },
              { srcUrls: [] },
            ],
            resources: { media: ["https://site.test/v.mp4"] },
          },
        },
      ],
    };
    fs.writeFileSync(path.join(dir, "recon.json"), JSON.stringify(recon));
    const fetch = fakeFetch({
      "https://site.test/logo.png": { body: "PNG" },
      "https://site.test/f/brand.woff2": { body: "WOFF" },
      "https://cdn.test/x.woff2": { reject: "ECONNRESET" },
    });
    const { io, out } = makeIo(dir);
    const launch = vi.fn();
    const code = await main(
      { argv: ["--recon", "recon.json", "--out", "assets", "--recon-only", "--types", "image,font"] },
      { ...io, fs, fetch: fetch.impl, launchBrowser: launch },
    );
    expect(code).toBe(0);
    expect(launch).not.toHaveBeenCalled();
    expect(fetch.calls[0]).toEqual({ url: "https://site.test/logo.png", init: { headers: { referer: "https://site.test/", accept: "*/*" } } });

    const manifest = readJson(path.join(dir, "assets", "asset-manifest.json"));
    expect(manifest).toMatchObject({ url: "https://site.test/", capturedVia: "recon-only", total: 4, ok: 2, error: 2, fontsCss: "fonts/fonts.css" });
    expect(manifest.assets.map((a) => a.url)).not.toContain("https://site.test/v.mp4");
    const logo = manifest.assets.find((a) => a.url.endsWith("logo.png"));
    expect(fs.readFileSync(path.join(dir, "assets", logo.localPath), "utf8")).toBe("PNG");
    expect(manifest.assets.find((a) => a.url.endsWith("missing.png"))).toMatchObject({ status: "error", error: "HTTP 404" });

    const brand = manifest.assets.find((a) => a.url.endsWith("brand.woff2")).localPath;
    const fontsCss = fs.readFileSync(path.join(dir, "assets", "fonts", "fonts.css"), "utf8");
    expect(fontsCss).toBe(`@font-face{font-family:B;src:url(${brand.replace(/^fonts\//, "")})}\n\n@font-face{src:url(x.woff2)}\n`);

    expect(out.logs[0]).toBe("▸ 候选资产 4 个(图片 2 / 字体 2)，开始下载…");
    expect(out.logs[1]).toBe(`✅ 下载 2 成功 / 2 失败 → ${path.join(dir, "assets")}`);
    expect(out.logs[2]).toBe(`▸ 自托管字体样式: ${path.join("assets", "fonts/fonts.css")} (页面 <link> 引入即可)`);
    expect(out.logs[3]).toBe("⚠️ 1 个字体下载失败——不许用系统字体糊弄，逐个排查:\n   ECONNRESET https://cdn.test/x.woff2");
    expect(out.logs[4]).toBe(path.join(dir, "assets", "asset-manifest.json"));
  });

  it("captures network assets in a browser, downloads through its context and closes it", async () => {
    const dir = makeTempDir();
    const typekit = "https://use.typekit.net/abc123.css";
    const { browser, state } = fakeBrowser({
      scrollHeight: 1500,
      gotoError: new Error("Timeout 90000ms exceeded"),
      responses: [
        fakeNetworkResponse("https://cdn.test/hero.jpg", { resourceType: "image", contentType: "image/jpeg" }),
        fakeNetworkResponse(typekit, { resourceType: "stylesheet", contentType: "text/css" }),
        fakeNetworkResponse("https://use.typekit.net/af/font.woff2", { resourceType: "font" }),
        fakeNetworkResponse("https://cdn.test/app.js", { resourceType: "script", contentType: "application/javascript" }),
        { url: () => { throw new Error("Target closed"); } },
      ],
      replies: {
        "https://cdn.test/hero.jpg": { body: "JPG" },
        [typekit]: { body: `@font-face{src:url("/af/font.woff2")}` },
        "https://use.typekit.net/af/font.woff2": { body: "W2" },
      },
    });
    const { io, out } = makeIo(dir);
    const code = await main(
      { argv: ["--url", "https://site.test/", "--out", "out", "--manifest", "m/manifest.json", "--scroll-step", "700", "--settle", "10"] },
      { ...io, fs, launchBrowser: async () => browser },
    );
    expect(code).toBe(0);
    expect(state.contextOptions).toEqual({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    expect(state.gotos).toEqual([{ url: "https://site.test/", options: { waitUntil: "networkidle", timeout: 90000 } }]);
    expect(out.warns).toEqual(["  goto: Timeout 90000ms exceeded"]);
    expect(state.scrolls).toEqual([[0, 0], [0, 700], [0, 1400], [0, 0]]);
    expect(state.waits).toEqual([180, 180, 180, 10, 800]);
    expect(state.pageClosed).toBe(true);
    expect(state.closed).toBe(true);
    expect(state.requests[0]).toEqual({ url: "https://cdn.test/hero.jpg", options: { headers: { referer: "https://site.test/" }, maxRedirects: 5 } });

    const manifest = readJson(path.join(dir, "m", "manifest.json"));
    expect(manifest).toMatchObject({ capturedVia: "browser-network+recon", total: 3, ok: 3, error: 0, fontsCss: "fonts/fonts.css" });
    expect(manifest.assets.map((a) => [a.kind, a.via])).toEqual([["image", "network"], ["stylesheet", "network"], ["font", "network"]]);
    const font = manifest.assets.find((a) => a.kind === "font").localPath;
    expect(fs.readFileSync(path.join(dir, "out", "fonts", "fonts.css"), "utf8")).toBe(
      `/* self-hosted from ${typekit} */\n@font-face{src:url("${font.replace(/^fonts\//, "")}")}\n`,
    );
    expect(out.logs[0]).toBe("▸ 加载 + 全程滚动捕获资产请求: https://site.test/");
  });

  it("writes no fonts.css when nothing needs self-hosting and closes the browser on failure", async () => {
    const dir = makeTempDir();
    const { browser, state } = fakeBrowser({ responses: [fakeNetworkResponse("https://cdn.test/a.png")] });
    const { io, out } = makeIo(dir);
    const ok = await main({ argv: ["--url", "https://site.test/"] }, { ...io, fs, launchBrowser: async () => browser });
    expect(ok).toBe(0);
    expect(readJson(path.join(dir, "assets", "asset-manifest.json"))).toMatchObject({ total: 1, ok: 0, fontsCss: null });
    expect(fs.existsSync(path.join(dir, "assets", "fonts"))).toBe(false);
    expect(out.logs).toHaveLength(4);

    const broken = { ...browser, newContext: async () => { throw new Error("context crashed"); }, close: browser.close };
    state.closed = false;
    expect(await main({ argv: ["--url", "https://site.test/"] }, { ...io, fs, launchBrowser: async () => broken })).toBe(1);
    expect(out.errors).toEqual(["asset-harvest failed: context crashed"]);
    expect(state.closed).toBe(true);
  });
});
