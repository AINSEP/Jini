/** renderPublicPage and its JSON capture: boundaries the shared render-page fixture does not reach. */
import { test, expect, vi } from "vitest";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import { renderPublicPage, createJsonCapture, type PublicPageInput } from "../public-page.js";
import type { RenderBrowser, RenderContext, RenderPage } from "../render-page.js";
import type { RouteLike, RoutedRequest } from "../request-guard.js";
import type { RenderBrowserPool } from "../lazy-browser.js";
import type { PlaywrightLike } from "../playwright-runtime.js";
import { PageWorkTimeout } from "../page-work-budget.js";

type RouteHandler = Parameters<RenderContext["route"]>[1];

const SNAPSHOT = { html: "<p>hi</p>", text: "hi", title: "Hi", truncated: false, images: [], imagesTruncated: false };

/** A browser whose page answers `evaluate` with a fixed snapshot; `onGoto` may drive the route guard. */
function fakeBrowser(page: Partial<RenderPage> = {}, { onGoto }: { onGoto?: (route: RouteHandler) => Promise<void> } = {}) {
  const events: string[] = [];
  let handler: RouteHandler | undefined;
  const fullPage: RenderPage = {
    goto: async () => { await onGoto?.(handler!); return null; },
    evaluate: async () => ({ ...SNAPSHOT }), title: async () => "Hi",
    waitForTimeout: async ms => { events.push(`wait:${ms}`); },
    ...page,
  };
  const context: RenderContext = { newPage: async () => fullPage, route: async (_pattern, routeHandler) => { handler = routeHandler; }, close: async () => { events.push("context-close"); } };
  const browser: RenderBrowser = { newContext: async () => context, close: async () => { events.push("browser-close"); } };
  const moduleLoader = { load: async (): Promise<PlaywrightLike> => ({ chromium: { launch: async () => browser } }) };
  return { browser, events, moduleLoader };
}

const noNetwork: HttpClientPort = { send: async () => { throw new Error("no request expected"); } };
const input: PublicPageInput = { url: "https://public.example/", maxChars: 100, waitFor: 0 };

test("a JSON capture ignores a data response without a content type", () => {
  const capture = createJsonCapture({});
  capture.record({ url: "https://api.example/rows", resourceType: "fetch", resource: { status: 200, headers: {}, body: Buffer.from("{}"), truncated: false } });
  expect(capture.result()).toEqual({ data: [], dataTruncated: false });
});

test("a missing navigation response reports status 0", async () => {
  const fake = fakeBrowser();
  const result = await renderPublicPage({ input, httpClient: noNetwork }, { moduleLoader: fake.moduleLoader });
  expect(result.status).toBe(0);
  expect(fake.events.slice(-2)).toEqual(["context-close", "browser-close"]);
});

test("an omitted waitFor keeps the shared default settle", async () => {
  const fake = fakeBrowser();
  await renderPublicPage({ input: { url: "https://public.example/", maxChars: 100 }, httpClient: noNetwork }, { moduleLoader: fake.moduleLoader });
  expect(fake.events).toContain("wait:1200");
});

test("an already-cancelled caller signal stops the render before a browser is opened", async () => {
  const fake = fakeBrowser(); const caller = new AbortController(); caller.abort(new Error("caller stop"));
  await expect(renderPublicPage({ input, httpClient: noNetwork }, { moduleLoader: fake.moduleLoader, signal: caller.signal })).rejects.toThrow("caller stop");
  expect(fake.events).toEqual([]);
});

test("a requested screenshot on a browser port without screenshots is refused and the browser closed", async () => {
  const fake = fakeBrowser();
  await expect(renderPublicPage({ input: { ...input, screenshot: true }, httpClient: noNetwork }, { moduleLoader: fake.moduleLoader }))
    .rejects.toThrow("Public render cannot take the requested screenshot: this browser port has no screenshot()");
  expect(fake.events.slice(-2)).toEqual(["context-close", "browser-close"]);
});

/** One unfetchable (ftp:) subresource of the given type, routed during navigation. */
function blockedSubresource(resourceType: string) {
  const routed: RoutedRequest = { url: () => "ftp://api.example/rows", method: () => "GET", headers: () => ({}), resourceType: () => resourceType, isNavigationRequest: () => false, frame: () => ({ parentFrame: () => null }) };
  const aborted: string[] = [];
  const route: RouteLike = { request: () => routed, fulfill: async () => {}, abort: async code => { aborted.push(code ?? "default"); } };
  return { aborted, fake: fakeBrowser({}, { onGoto: handler => handler(route) }) };
}

test("a blocked xhr data request is counted by reason and marks the data incomplete", async () => {
  const { aborted, fake } = blockedSubresource("xhr");
  const result = await renderPublicPage({ input, httpClient: noNetwork }, { moduleLoader: fake.moduleLoader });
  expect(aborted).toEqual(["blockedbyclient"]);
  expect(result.blockedDataRequests).toEqual({ scheme: 1 });
  expect(result.dataTruncated).toBe(true);
});

test("a blocked image is not counted as a data request", async () => {
  const { aborted, fake } = blockedSubresource("image");
  const result = await renderPublicPage({ input, httpClient: noNetwork }, { moduleLoader: fake.moduleLoader });
  expect(aborted).toEqual(["blockedbyclient"]);
  expect(result.blockedDataRequests).toEqual({});
  expect(result.dataTruncated).toBe(false);
});

test("a pooled browser that arrives after the deadline is handed straight back", async () => {
  const fake = fakeBrowser(); const released: string[] = [];
  let deliver!: (lease: { browser: RenderBrowser; release(): void }) => void;
  const pool: RenderBrowserPool = { acquire: () => new Promise(resolve => { deliver = resolve; }), close: async () => {} };
  // Only the budget's per-step timer is frozen, so the native deadline decides when the render gives up.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let failure: unknown;
  try {
    failure = await renderPublicPage({ input, httpClient: noNetwork }, { browserPool: pool, timeoutMs: 10 }).catch(error => error);
  } finally {
    vi.useRealTimers();
  }
  expect((failure as Error).name).toBe("TimeoutError");
  deliver({ browser: fake.browser, release: () => { released.push("lease"); } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(released).toEqual(["lease"]);
  expect(fake.events).toEqual([]);
});

test("a pooled browser leased after the page budget ran out is released and the render times out", async () => {
  const fake = fakeBrowser(); const released: string[] = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const pool: RenderBrowserPool = {
      acquire: async () => { vi.setSystemTime(Date.now() + 60_000); return { browser: fake.browser, release: () => { released.push("lease"); } }; },
      close: async () => {},
    };
    await expect(renderPublicPage({ input, httpClient: noNetwork }, { browserPool: pool, timeoutMs: 1000 })).rejects.toThrow(PageWorkTimeout);
  } finally {
    vi.useRealTimers();
  }
  expect(released).toEqual(["lease"]);
  expect(fake.events).toEqual([]);
});
