import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeThemeCanvasPort, defaultThemeCanvasPort, ThemeServerResponseError } from "../theme-canvas-dependencies.hooks.js";

/**
 * @file Coverage for `theme-canvas-dependencies.hooks.ts`'s `defaultThemeCanvasPort` — neither
 * method was ever invoked by any existing suite (`use-theme-canvas-styling.unit.test.ts` only ever
 * constructs `createFakeThemeCanvasPort`; nothing rendered the former wired hook, which used this real-`fetch` port). This covers both the success and the
 * `!res.ok`-throws path for each method directly against a stubbed global `fetch`.
 *
 * Also closes a mutation-survived gap in `createFakeThemeCanvasPort.fetchThemeTokens`'s own
 * "nothing seeded at this URL" guard: `use-theme-canvas-styling.unit.test.ts` DOES call it unseeded
 * (`createFakeThemeCanvasPort()`), but only asserts the HOOK's downstream fallback state, which
 * turns out identical whether this guard rejects or silently resolves `undefined` — so disabling it
 * left that test green. Asserted here directly against the port's own promise instead.
 */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("defaultThemeCanvasPort.fetchThemeTokens", () => {
  it("resolves the parsed JSON body when the response is ok", async () => {
    const tokens = { colors: { primary: "#111" } };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(tokens) }) as typeof fetch;
    await expect(defaultThemeCanvasPort.fetchThemeTokens({ url: "/theme-assets/basic/tokens.json" })).resolves.toEqual(tokens);
    expect(global.fetch).toHaveBeenCalledWith("/theme-assets/basic/tokens.json");
  });

  it("throws naming the status when the response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as typeof fetch;
    await expect(defaultThemeCanvasPort.fetchThemeTokens({ url: "/theme-assets/basic/tokens.light.json" })).rejects.toThrow(
      "the theme server responded with 404",
    );
    await expect(defaultThemeCanvasPort.fetchThemeTokens({ url: "/theme-assets/basic/tokens.light.json" })).rejects.toBeInstanceOf(ThemeServerResponseError);
    await expect(defaultThemeCanvasPort.fetchThemeTokens({ url: "/theme-assets/basic/tokens.light.json" })).rejects.toMatchObject({ status: 404 });
  });

  it("surfaces invalid JSON from a successful tokens response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("{invalid", { status: 200 })) as typeof fetch;
    await expect(defaultThemeCanvasPort.fetchThemeTokens({ url: "/theme-assets/basic/tokens.json" })).rejects.toBeInstanceOf(SyntaxError);
    expect(global.fetch).toHaveBeenCalledWith("/theme-assets/basic/tokens.json");
  });
});

describe("defaultThemeCanvasPort.fetchTemplateMarkup", () => {
  it("resolves the response text when the response is ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("<main></main>") }) as typeof fetch;
    await expect(defaultThemeCanvasPort.fetchTemplateMarkup({ url: "/theme-assets/basic/pages/page-shell.html" })).resolves.toBe(
      "<main></main>",
    );
    expect(global.fetch).toHaveBeenCalledWith("/theme-assets/basic/pages/page-shell.html");
  });

  it("throws naming the status when the response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as typeof fetch;
    await expect(defaultThemeCanvasPort.fetchTemplateMarkup({ url: "/theme-assets/basic/pages/missing.html" })).rejects.toThrow(
      "the theme server responded with 500",
    );
    await expect(defaultThemeCanvasPort.fetchTemplateMarkup({ url: "/theme-assets/basic/pages/missing.html" })).rejects.toBeInstanceOf(ThemeServerResponseError);
    await expect(defaultThemeCanvasPort.fetchTemplateMarkup({ url: "/theme-assets/basic/pages/missing.html" })).rejects.toMatchObject({ status: 500 });
  });
});

describe("createFakeThemeCanvasPort.fetchThemeTokens — unseeded URL", () => {
  it("rejects, naming the URL, rather than resolving with undefined", async () => {
    const port = createFakeThemeCanvasPort();
    await expect(port.fetchThemeTokens({ url: "/theme-assets/basic/tokens.json" })).rejects.toThrow(
      "fake theme canvas port: nothing seeded at /theme-assets/basic/tokens.json",
    );
  });
});
