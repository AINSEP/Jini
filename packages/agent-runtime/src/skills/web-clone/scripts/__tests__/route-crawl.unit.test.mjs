import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectPage, main, normalizeUrl, parseArgs, routeFileName, sameSite, summarizeMarkdown } from "../route-crawl.mjs";
import { browserEnv, createFakeBrowser, createFakePage, createOutput, el, fakeDocument, playwrightPorts, tempDir } from "./fakes-wc2.mjs";

const link = (href, text = "") => el({ tag: "a", href, text, matches: ["a[href]"] });

/** A tiny site keyed by normalized URL: title, h1s, and outgoing links. */
const SITE = {
  "https://s.test": {
    title: "Home | Site",
    h1: ["Wel|come"],
    links: [
      link("https://s.test/about", "About"),
      link("https://s.test/about#team"),
      link("https://s.test/blog?b=2&a=1", "Blog"),
      link("https://other.test/x", "Other"),
      link("mailto:hi@s.test", "Mail"),
      link("https://sub.s.test/", "Sub"),
      link("http://[bad", "Bad"),
    ],
  },
  "https://s.test/about": { title: "About", h1: ["About", "Us"], links: [link("https://s.test/"), link("https://s.test/about/team", "Team")] },
  "https://s.test/about/team": { title: "Team", h1: [], links: [] },
  "https://sub.s.test": { title: "Sub", h1: ["Sub"], links: [] },
};

function documentFor(url) {
  const page = SITE[url] || { title: "", h1: [], links: [] };
  const doc = fakeDocument({
    title: page.title,
    html: { lang: "en", scrollHeight: 1200 },
    body: [
      el({ tag: "meta", content: `${page.title} description`, matches: ["meta[name='description']"] }),
      ...page.h1.map((text) => el({ tag: "h1", text })),
      el({ tag: "h2", text: "Section" }),
      el({ tag: "canvas" }),
      el({ tag: "button", matches: ["[role='button']"] }),
      ...page.links,
    ],
  });
  doc.images = [{}, {}];
  doc.forms = [{}];
  return doc;
}

function sitePage({ failOn = "", nullResponseOn = "" } = {}) {
  const state = { url: "" };
  const page = createFakePage({
    env: () => browserEnv({ document: documentFor(state.url), href: state.url }),
    loadStateError: new Error("timeout"),
    hooks: {
      goto: async (url, p) => {
        state.url = url;
        await p.emit("console", { type: () => "error", text: () => `err@${url}` });
        await p.emit("console", { type: () => "log", text: () => "noise" });
        if (url === failOn) throw new Error(`net::ERR_FAILED at ${url}`);
      },
    },
  });
  const goto = page.goto;
  page.goto = async (url, options) => {
    const response = await goto(url, options);
    return url === nullResponseOn ? null : response;
  };
  return page;
}

describe("argument parsing and URL helpers", () => {
  it("parses flags and defaults, rejecting unknown ones", () => {
    expect(parseArgs(["--url", "https://s.test", "--max-pages", "3", "--allow-subdomains", "--wait"])).toEqual({
      url: "https://s.test",
      outDir: "RECON/routes",
      label: "site",
      maxPages: 3,
      maxDepth: 2,
      width: 1440,
      waitMs: 800,
      allowSubdomains: true,
    });
    expect(parseArgs(["-h", "--out", "o", "--label", "c", "--max-depth", "0", "--width", "390"])).toMatchObject({ help: true, outDir: "o", label: "c", maxDepth: 0, width: 390 });
    expect(() => parseArgs(["--deep"])).toThrow("Unexpected argument: --deep");
  });

  it("normalizeUrl strips hash and trailing slash, sorts the query, and rejects non-http or unparsable input", () => {
    expect(normalizeUrl("/a/?z=1&a=2#h", "https://s.test/x")).toBe("https://s.test/a/?a=2&z=1");
    expect(normalizeUrl("https://s.test/", "https://s.test/")).toBe("https://s.test");
    expect(normalizeUrl("mailto:a@b.c", "https://s.test/")).toBe("");
    expect(normalizeUrl("http://[bad", "https://s.test/")).toBe("");
  });

  it("sameSite allows the origin, and subdomains only when asked", () => {
    expect(sameSite("https://s.test/a", "https://s.test", false)).toBe(true);
    expect(sameSite("https://sub.s.test/a", "https://s.test", false)).toBe(false);
    expect(sameSite("https://sub.s.test/a", "https://s.test", true)).toBe(true);
    expect(sameSite("https://evil-s.test/a", "https://s.test", true)).toBe(false);
  });

  it("routeFileName is a sanitized host+path with a short hash", () => {
    expect(routeFileName("https://s.test/a/b?x=1")).toMatch(/^s.test-a-b-[0-9a-f]{8}\.png$/);
    expect(routeFileName("http://[::1]:8080/")).toMatch(/^1-[0-9a-f]{8}\.png$/);
  });
});

describe("collectPage", () => {
  it("reads title, language, description, headings, counts, and links", async () => {
    const data = await collectPage(createFakePage({ env: browserEnv({ document: documentFor("https://s.test/about"), href: "https://s.test/about" }) }));
    expect(data).toEqual({
      href: "https://s.test/about",
      title: "About",
      lang: "en",
      metaDescription: "About description",
      h1: ["About", "Us"],
      headings: [
        { tag: "h1", text: "About" },
        { tag: "h1", text: "Us" },
        { tag: "h2", text: "Section" },
      ],
      scrollHeight: 1200,
      counts: { links: 2, images: 2, canvas: 1, forms: 1, buttons: 1 },
      links: [
        { href: "https://s.test/", text: "" },
        { href: "https://s.test/about/team", text: "Team" },
      ],
    });
  });

  it("falls back to empty strings for an untitled page", async () => {
    const document = fakeDocument();
    const data = await collectPage(createFakePage({ env: browserEnv({ document }) }));
    expect(data).toMatchObject({ title: "", lang: "", metaDescription: "", h1: [], links: [] });
  });
});

describe("summarizeMarkdown", () => {
  it("renders an escaped route table and a skipped list only when needed", () => {
    const result = {
      label: "orig",
      url: "https://s.test",
      maxDepth: 2,
      maxPages: 25,
      routes: [
        { url: "https://s.test", depth: 0, status: 200, title: "A | B", h1: ["x|y", "z"], linkCount: 3, screenshot: "s/a.png" },
        { url: "https://s.test/q?a=1", depth: 1, status: 0, title: "", h1: [], linkCount: 0, screenshot: "s/b.png" },
      ],
      skipped: [{ url: "https://s.test/x", reason: "depth>2" }],
    };
    const md = summarizeMarkdown(result);
    expect(md).toContain("| 0 | 200 | / | A \\| B | x\\|y / z | 3 | s/a.png |");
    expect(md).toContain("| 1 |  | /q?a=1 |  |  | 0 | s/b.png |");
    expect(md).toContain("## Skipped / Failed\n- https://s.test/x · depth>2");
    expect(summarizeMarkdown({ ...result, skipped: [] })).not.toContain("Skipped");
  });
});

describe("main", () => {
  it("prints usage: exit 0 for --help, 1 without --url, 1 on a bad flag", async () => {
    const out = createOutput();
    expect(await main({ argv: ["--help"] }, out)).toBe(0);
    expect(await main({ argv: [] }, out)).toBe(1);
    expect(await main({ argv: ["--x"] }, out)).toBe(1);
    expect(out.logs[0]).toContain("node scripts/route-crawl.mjs --url <url>");
    expect(out.errors).toEqual(["route-crawl failed: Unexpected argument: --x"]);
  });

  it("rejects a non-http start URL", async () => {
    const out = createOutput();
    expect(await main({ argv: ["--url", "ftp://s.test/"] }, out)).toBe(1);
    expect(out.errors).toEqual(["route-crawl failed: Invalid URL: ftp://s.test/"]);
  });

  it("crawls same-site routes breadth-first within depth, recording failures and skips", async () => {
    const outDir = tempDir();
    const out = createOutput();
    const page = sitePage({ failOn: "https://s.test/blog?a=1&b=2", nullResponseOn: "https://s.test/about" });
    const browser = createFakeBrowser(() => page);
    const code = await main({ argv: ["--url", "https://s.test/", "--out", outDir, "--label", "orig", "--max-depth", "1", "--wait", "3", "--width", "1024"] }, {
      ...out,
      ...playwrightPorts(browser),
      now: () => new Date("2026-07-08T09:10:11Z"),
    });
    expect(code).toBe(0);
    const jsonFile = path.join(outDir, "orig-route-map.json");
    expect(out.logs).toEqual([jsonFile]);
    const result = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    expect(result).toMatchObject({ label: "orig", url: "https://s.test", capturedAt: "2026-07-08T09:10:11.000Z", maxDepth: 1, maxPages: 25, allowSubdomains: false });
    expect(result.routes.map((r) => [r.url, r.from, r.depth, r.status, r.linkCount])).toEqual([
      ["https://s.test", "", 0, 200, 7],
      ["https://s.test/about", "https://s.test", 1, 0, 2],
    ]);
    expect(result.routes[0]).toMatchObject({ title: "Home | Site", lang: "en", h1: ["Wel|come"], consoleErrors: ["err@https://s.test"] });
    expect(result.routes[0].screenshot).toMatch(/^screenshots\/s.test-[0-9a-f]{8}\.png$/);
    expect(fs.existsSync(path.join(outDir, result.routes[0].screenshot))).toBe(true);
    expect(result.skipped).toEqual([
      { url: "https://s.test/blog?a=1&b=2", reason: "net::ERR_FAILED at https://s.test/blog?a=1&b=2" },
      { url: "https://s.test/about/team", reason: "depth>1" },
    ]);
    // The console listener is detached after every route.
    expect(page.handlers.console).toEqual([]);
    expect(page.calls).toContainEqual(["waitForTimeout", 3]);
    expect(browser.newPageOptions).toEqual([{ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 }]);
    expect(browser.closed).toBe(true);
    const md = fs.readFileSync(path.join(outDir, "orig-route-map.md"), "utf8");
    expect(md).toContain("- Captured routes: 2");
    expect(md).toContain("## Skipped / Failed");
  });

  it("follows subdomains when allowed, stops at --max-pages, and stamps the real clock by default", async () => {
    const outDir = tempDir();
    const out = createOutput();
    const page = sitePage();
    const before = Date.now();
    const code = await main({ argv: ["--url", "https://s.test", "--out", outDir, "--allow-subdomains", "--max-pages", "4", "--wait", "0"] }, { ...out, ...playwrightPorts(createFakeBrowser(() => page)) });
    expect(code).toBe(0);
    const result = JSON.parse(fs.readFileSync(path.join(outDir, "site-route-map.json"), "utf8"));
    expect(result.routes.map((r) => r.url)).toEqual(["https://s.test", "https://s.test/about", "https://s.test/blog?a=1&b=2", "https://sub.s.test"]);
    expect(result.skipped).toEqual([]);
    expect(Date.parse(result.capturedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(page.calls.some(([name]) => name === "waitForTimeout")).toBe(false);
  });
});
