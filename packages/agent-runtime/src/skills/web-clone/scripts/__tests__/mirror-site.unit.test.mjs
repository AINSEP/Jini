import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isOwnUrl, main, parseArgs, thirdPartyReport, urlToLocalPath } from "../mirror-site.mjs";
import { browserEnv, createFakePage, createOutput, fakeDocument, fakeResponse, playwrightPorts, tempDir } from "./fakes-wc2.mjs";

/** A browser exposing one context whose request.get serves `assets`. */
function mirrorBrowser(page, assets) {
  const ctx = {
    newPage: async () => page,
    request: {
      get: async (url) => {
        const asset = assets[url];
        if (asset instanceof Error) throw asset;
        return { ok: () => asset.status < 400, status: () => asset.status, body: async () => Buffer.from(asset.body || "") };
      },
    },
  };
  const browser = {
    closed: false,
    newContext: async (options) => {
      browser.contextOptions = options;
      return ctx;
    },
    close: async () => {
      browser.closed = true;
    },
  };
  return browser;
}

function pageEmitting(responses, { gotoError, scrollHeight = 1500 } = {}) {
  const env = browserEnv({ document: fakeDocument({ html: { scrollHeight } }) });
  const page = createFakePage({
    env,
    gotoError,
    hooks: {
      goto: async (url, p) => {
        for (const response of responses) await p.emit("response", response);
      },
    },
  });
  return { page, env };
}

describe("argument parsing and pure helpers", () => {
  it("parses integer flags, ignores unknown arguments, and falls back on missing values", () => {
    expect(parseArgs(["--url", "https://s.test", "--out", "o", "--scroll-step", "350px", "--extra", "--settle"])).toEqual({
      url: "https://s.test",
      out: "o",
      scrollStep: 350,
      settle: 2500,
      maxMs: 90000,
      help: false,
    });
    expect(parseArgs(["-h", "--max-ms", "1000"])).toMatchObject({ help: true, maxMs: 1000 });
  });

  it("urlToLocalPath drops the query and maps directories to index.html", () => {
    const origin = "https://s.test";
    expect(urlToLocalPath("https://s.test", origin)).toBe("index.html");
    expect(urlToLocalPath("https://s.test/docs/", origin)).toBe("docs/index.html");
    expect(urlToLocalPath("https://s.test/a/b.js?v=1", origin)).toBe("a/b.js");
  });

  it("isOwnUrl accepts the origin with or without a path, and nothing else", () => {
    const origin = "https://s.test";
    expect(isOwnUrl("https://s.test", origin)).toBe(true);
    expect(isOwnUrl("https://s.test/", origin)).toBe(true);
    expect(isOwnUrl("https://s.test/x", origin)).toBe(true);
    expect(isOwnUrl("https://s.test.evil/x", origin)).toBe(false);
  });

  it("thirdPartyReport dedupes hosts, keeps unparsable urls verbatim, and flags locked webfont CSS", () => {
    const all = [
      { url: "https://s.test/a" },
      { url: "https://cdn.x.test/a.wasm" },
      { url: "https://cdn.x.test/b.wasm" },
      { url: "https://use.typekit.net/abc123.css" },
      { url: "https://fonts.googleapis.com/css2?family=Inter" },
      { url: "not a url" },
    ];
    expect(thirdPartyReport(all, "https://s.test")).toEqual({
      hosts: ["cdn.x.test", "use.typekit.net", "fonts.googleapis.com", "not a url"],
      webfont_css_to_selfhost: ["https://use.typekit.net/abc123.css", "https://fonts.googleapis.com/css2?family=Inter"],
    });
  });
});

describe("main", () => {
  it("prints usage: exit 0 for --help, 1 when --url or --out is missing", async () => {
    const out = createOutput();
    expect(await main({ argv: ["--help"] }, out)).toBe(0);
    expect(await main({ argv: ["--url", "https://s.test"] }, out)).toBe(1);
    expect(out.logs[0]).toContain("node scripts/mirror-site.mjs --url <URL> --out <dir>");
  });

  it("mirrors same-origin assets, records failures, and reports third parties", async () => {
    const outDir = tempDir();
    const out = createOutput();
    const brokenHeaders = fakeResponse({ url: "https://s.test/late" });
    brokenHeaders.headers = () => {
      throw new Error("Target closed");
    };
    const { page, env } = pageEmitting(
      [
        fakeResponse({ url: "https://s.test/", resourceType: "document", headers: { "content-type": "text/html" } }),
        fakeResponse({ url: "https://s.test/assets/app.js?v=3", resourceType: "script" }),
        fakeResponse({ url: "https://s.test/missing.png", status: 404, resourceType: "image" }),
        fakeResponse({ url: "https://s.test/boom.bin" }),
        fakeResponse({ url: "https://cdn.x.test/lib.wasm" }),
        fakeResponse({ url: "https://use.typekit.net/abc123.css", resourceType: "stylesheet" }),
        brokenHeaders,
      ],
      { gotoError: new Error("Timeout 90000ms exceeded") },
    );
    const browser = mirrorBrowser(page, {
      "https://s.test/": { status: 200, body: "<html>home</html>" },
      "https://s.test/assets/app.js?v=3": { status: 200, body: "console.log(1)" },
      "https://s.test/missing.png": { status: 404 },
      "https://s.test/boom.bin": new Error("socket hang up"),
    });

    expect(await main({ argv: ["--url", "https://s.test/", "--out", outDir, "--scroll-step", "700", "--settle", "10"] }, { ...out, ...playwrightPorts(browser) })).toBe(0);

    const site = path.join(outDir, "site");
    expect(fs.readFileSync(path.join(site, "index.html"), "utf8")).toBe("<html>home</html>");
    expect(fs.readFileSync(path.join(site, "assets", "app.js"), "utf8")).toBe("console.log(1)");
    expect(fs.existsSync(path.join(site, "missing.png"))).toBe(false);

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "mirror-manifest.json"), "utf8"));
    expect(manifest).toHaveLength(6);
    expect(manifest[0]).toEqual({ url: "https://s.test/", status: 200, type: "document", ct: "text/html" });
    expect(manifest[1].ct).toBe("");
    expect(fs.readFileSync(path.join(outDir, "own-asset-urls.txt"), "utf8")).toBe("assets/app.js\nboom.bin\nindex.html\nmissing.png\n");
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "third-party.json"), "utf8"))).toEqual({
      hosts: ["cdn.x.test", "use.typekit.net"],
      webfont_css_to_selfhost: ["https://use.typekit.net/abc123.css"],
    });

    expect(out.errors).toEqual(["  goto: Timeout 90000ms exceeded"]);
    expect(out.logs).toContain("▸ 捕获请求 6 个；同源 4 个，开始下载…");
    expect(out.logs).toContain(`✅ 镜像完成: 2 成功 / 2 失败 → ${site}`);
    expect(out.logs).toContain("  ⚠️ 失败:\n   HTTP404 missing.png\n   socket hang up boom.bin");
    expect(out.logs).toContain("▸ 第三方 host: cdn.x.test, use.typekit.net");
    expect(out.logs.some((line) => line.includes("需自托管的 webfont CSS"))).toBe(true);
    // Scrolled through 0, 700, 1400 then bottom, then back to top.
    expect(env.window.scrolls).toEqual([[0, 0], [0, 700], [0, 1400], [0, 1500], [0, 0]]);
    expect(page.calls).toContainEqual(["waitForTimeout", 10]);
    expect(browser.contextOptions).toEqual({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    expect(browser.closed).toBe(true);
  });

  it("reports a clean mirror with no third parties", async () => {
    const outDir = tempDir();
    const out = createOutput();
    const { page } = pageEmitting([fakeResponse({ url: "https://s.test/" })], { scrollHeight: 0 });
    const browser = mirrorBrowser(page, { "https://s.test/": { status: 200, body: "ok" } });
    expect(await main({ argv: ["--url", "https://s.test/", "--out", outDir] }, { ...out, ...playwrightPorts(browser) })).toBe(0);
    expect(out.logs).toContain("▸ 第三方 host: (无)");
    expect(out.logs.some((line) => line.includes("失败:"))).toBe(false);
    expect(out.logs.some((line) => line.includes("webfont"))).toBe(false);
  });

  it("lets an invalid --url propagate as a failure", async () => {
    await expect(main({ argv: ["--url", "not-a-url", "--out", tempDir()] }, createOutput())).rejects.toThrow(/Invalid URL/);
  });
});
