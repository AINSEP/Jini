import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main, parseArgs, safeFixtureName, shouldSave } from "../network-capture.mjs";
import { createFakeBrowser, createFakePage, createOutput, fakeResponse, playwrightPorts, tempDir } from "./fakes-wc2.mjs";

describe("argument parsing and pure helpers", () => {
  it("parses flags with defaults and rejects unknown ones", () => {
    expect(parseArgs(["--url", "https://s.test", "--wait", "0", "--max-bytes"])).toEqual({
      url: "https://s.test",
      outDir: "RECON/network",
      label: "site",
      waitMs: 0,
      maxBytes: 1000000,
    });
    expect(parseArgs(["-h", "--out", "o", "--label", "clone"])).toMatchObject({ help: true, outDir: "o", label: "clone" });
    expect(() => parseArgs(["--nope"])).toThrow("Unexpected argument: --nope");
  });

  it("safeFixtureName derives a sanitized, hashed name with a json/txt extension", () => {
    expect(safeFixtureName("https://s.test/api/v1/items?x=1", "application/json")).toMatch(/^api-v1-items-[0-9a-f]{10}\.json$/);
    expect(safeFixtureName("https://s.test/", "text/plain")).toMatch(/^response-[0-9a-f]{10}\.txt$/);
  });

  it("shouldSave keeps only xhr/fetch bodies with a textual content type", () => {
    expect(shouldSave("xhr", "application/json")).toBe(true);
    expect(shouldSave("fetch", "application/graphql-response+json")).toBe(true);
    expect(shouldSave("fetch", "text/javascript")).toBe(true);
    expect(shouldSave("fetch", "image/png")).toBe(false);
    expect(shouldSave("fetch", undefined)).toBe(false);
    expect(shouldSave("script", "text/javascript")).toBe(false);
  });
});

describe("main", () => {
  it("prints usage: exit 0 for --help, 1 without --url, 1 on a bad flag", async () => {
    const out = createOutput();
    expect(await main({ argv: ["-h"] }, out)).toBe(0);
    expect(await main({ argv: [] }, out)).toBe(1);
    expect(await main({ argv: ["--bogus"] }, out)).toBe(1);
    expect(out.logs[0]).toContain("node scripts/network-capture.mjs --url <url>");
    expect(out.errors).toEqual(["network-capture failed: Unexpected argument: --bogus"]);
  });

  it("records requests and saves xhr/fetch fixtures within the size limit", async () => {
    const outDir = tempDir();
    const out = createOutput();
    const responses = [
      fakeResponse({ url: "https://s.test/api/items", resourceType: "xhr", headers: { "content-type": "application/json" }, body: '{"a":1}' }),
      fakeResponse({ url: "https://s.test/notes", resourceType: "fetch", headers: { "content-type": "text/plain" }, body: "hi" }),
      fakeResponse({ url: "https://s.test/big", resourceType: "fetch", headers: { "content-type": "application/json" }, body: "x".repeat(50) }),
      fakeResponse({ url: "https://s.test/gone", resourceType: "xhr", status: 500, headers: { "content-type": "application/json" }, bodyError: new Error("No resource with given identifier") }),
      fakeResponse({ url: "https://s.test/logo.png", resourceType: "image", headers: { "content-type": "image/png" } }),
      fakeResponse({ url: "https://s.test/raw", resourceType: "fetch" }),
    ];
    const page = createFakePage({
      loadStateError: new Error("timeout"),
      hooks: {
        goto: async (url, p) => {
          await p.emit("request", fakeResponse({ url: "https://s.test/api/items", method: "POST", postData: '{"q":1}', requestHeaders: { a: "b" } }).request());
          await p.emit("request", fakeResponse({ url: "https://s.test/logo.png" }).request());
          for (const response of responses) await p.emit("response", response);
        },
      },
    });
    const browser = createFakeBrowser(() => page);
    const code = await main({ argv: ["--url", "https://s.test/", "--out", outDir, "--label", "orig", "--wait", "7", "--max-bytes", "10"] }, {
      ...out,
      ...playwrightPorts(browser),
      now: () => new Date("2026-03-04T05:06:07Z"),
    });
    expect(code).toBe(0);

    const manifestFile = path.join(outDir, "orig-network.json");
    expect(out.logs).toEqual([manifestFile]);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    expect(manifest).toMatchObject({ label: "orig", url: "https://s.test/", capturedAt: "2026-03-04T05:06:07.000Z", requestCount: 2, responseCount: 6, fixtureCount: 2 });
    expect(manifest.requests).toEqual([
      { url: "https://s.test/api/items", method: "POST", resourceType: "fetch", headers: { a: "b" }, postData: '{"q":1}' },
      { url: "https://s.test/logo.png", method: "GET", resourceType: "fetch", headers: {}, postData: "" },
    ]);
    const [items, notes, big, gone, logo, raw] = manifest.responses;
    expect(items).toMatchObject({ status: 200, ok: true, method: "GET", contentType: "application/json", bytes: 7, error: "" });
    expect(fs.readFileSync(path.join(outDir, items.fixture), "utf8")).toBe('{"a":1}');
    expect(items.fixture).toMatch(/^fixtures\/api-items-[0-9a-f]{10}\.json$/);
    expect(notes.fixture).toMatch(/\.txt$/);
    expect(big).toMatchObject({ fixture: "", error: "body too large: 50" });
    expect(gone).toMatchObject({ ok: false, fixture: "", error: "No resource with given identifier" });
    expect(logo).toMatchObject({ fixture: "", error: "" });
    expect(raw).toMatchObject({ contentType: "", fixture: "" });
    expect(page.calls).toContainEqual(["waitForLoadState", "networkidle", { timeout: 7 }]);
    expect(page.calls).toContainEqual(["waitForTimeout", 7]);
    expect(browser.newPageOptions).toEqual([{ viewport: { width: 1440, height: 900 } }]);
    expect(browser.closed).toBe(true);
  });

  it("waits for a response body still being read before closing the browser and writing the manifest", async () => {
    const outDir = tempDir();
    const out = createOutput();
    let browser;
    const slow = fakeResponse({ url: "https://s.test/api/slow", resourceType: "xhr", headers: { "content-type": "application/json" } });
    slow.body = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (browser.closed) throw new Error("Target page, context or browser has been closed");
      return Buffer.from('{"late":true}');
    };
    const page = createFakePage({ hooks: { goto: async (url, p) => p.emit("response", slow) } });
    browser = createFakeBrowser(() => page);
    expect(await main({ argv: ["--url", "https://s.test/", "--out", outDir, "--wait", "0"] }, { ...out, ...playwrightPorts(browser) })).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "site-network.json"), "utf8"));
    expect(manifest).toMatchObject({ responseCount: 1, fixtureCount: 1 });
    expect(manifest.responses[0]).toMatchObject({ url: "https://s.test/api/slow", error: "", bytes: 13 });
    expect(fs.readFileSync(path.join(outDir, manifest.responses[0].fixture), "utf8")).toBe('{"late":true}');
    expect(browser.closed).toBe(true);
  });

  it("skips the settle wait at --wait 0, stamps the real clock by default, and fails with exit 1 on navigation errors", async () => {
    const outDir = tempDir();
    const out = createOutput();
    const page = createFakePage();
    const before = Date.now();
    expect(await main({ argv: ["--url", "https://s.test/", "--out", outDir, "--wait", "0"] }, { ...out, ...playwrightPorts(createFakeBrowser(() => page)) })).toBe(0);
    expect(page.calls.some(([name]) => name === "waitForTimeout")).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "site-network.json"), "utf8"));
    expect(Date.parse(manifest.capturedAt)).toBeGreaterThanOrEqual(before - 1000);

    const failing = createFakeBrowser(() => createFakePage({ gotoError: new Error("net::ERR_FAILED") }));
    expect(await main({ argv: ["--url", "https://s.test/", "--out", outDir] }, { ...out, ...playwrightPorts(failing) })).toBe(1);
    expect(out.errors).toEqual(["network-capture failed: net::ERR_FAILED"]);
  });
});
