/** Availability results of the optional browser capability, against injected loader/launch ports. */
import * as nodeOs from "node:os";
import { describe, expect, it } from "vitest";
import { nodeModuleLoader, openPlaywrightRenderBrowser } from "../playwright-runtime.js";
import type { RenderBrowser } from "../render-page.js";

const browser: RenderBrowser = { close: async () => {}, newContext: async () => { throw new Error("unused"); } };

describe("openPlaywrightRenderBrowser", () => {
  it("launches headless Chromium with the caller's launch options merged in", async () => {
    const launches: unknown[] = [];
    const result = await openPlaywrightRenderBrowser({}, {
      moduleLoader: { load: async () => ({ chromium: { launch: async options => { launches.push(options); return browser; } } }) },
      launchOptions: { args: ["--no-first-run"] },
    });
    expect(result).toEqual({ available: true, browser });
    expect(launches).toEqual([{ headless: true, args: ["--no-first-run"] }]);
  });

  it("reports a module-load Error as unavailable, quoting its message", async () => {
    const result = await openPlaywrightRenderBrowser({}, { moduleLoader: { load: async () => { throw new Error("Cannot find package 'playwright'"); } } });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("(Cannot find package 'playwright')") });
  });

  it("reports a non-Error module-load failure as unavailable, with its string form", async () => {
    const result = await openPlaywrightRenderBrowser({}, { moduleLoader: { load: async () => { throw "ERR_MODULE_NOT_FOUND"; } } });
    expect(result.available).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("the 'playwright' package is not installed") });
    expect(result).toMatchObject({ reason: expect.stringContaining("(ERR_MODULE_NOT_FOUND)") });
  });

  it("reports a launch failure as unavailable with install guidance, for Error and non-Error failures alike", async () => {
    for (const [failure, detail] of [[new Error("sandbox unsupported"), "sandbox unsupported"], [42, "42"]] as const) {
      const result = await openPlaywrightRenderBrowser({}, { moduleLoader: { load: async () => ({ chromium: { launch: async () => { throw failure; } } }) } });
      expect(result).toMatchObject({ available: false, reason: expect.stringContaining("npx playwright install --with-deps chromium") });
      expect(result).toMatchObject({ reason: expect.stringMatching(new RegExp(`Underlying error: ${detail}$`)) });
    }
  });
});

describe("nodeModuleLoader", () => {
  it("performs a real dynamic import by module name", async () => {
    const loaded: unknown = await nodeModuleLoader.load({ moduleName: "node:os" });
    expect(loaded).toBe(nodeOs);
  });

  it("rejects for a module that is not installed", async () => {
    await expect(nodeModuleLoader.load({ moduleName: "jini-diagnostics-no-such-module" })).rejects.toThrow();
  });
});
