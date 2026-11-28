import { ToolInputError } from "@jini-ai/core";
import { expect, test } from "vitest";
import type { PageCapture, PageCaptureRequest } from "@jini-ai/core/contracts/site/web-screenshot";
import {
  CAPTURE_LIMITS,
  captureRelativePaths,
  createWebScreenshotService,
  MAX_FULL_PAGE_HEIGHT_PX,
  PageCaptureError,
  readWebScreenshotInput,
  UNTRUSTED_NOTICE,
  VIEWPORT_PRESETS,
  type EncodeTiles,
  type OpenOwnSite,
  type WebScreenshotEvent,
  type WebScreenshotPorts,
} from "../web-screenshot.js";

/**
 * Characterizes `web_screenshot_page`'s domain with fake ports only: the capture port, tile encoder,
 * clock and queue timer are all stand-ins, so no browser or image codec is needed here. The host keeps
 * the end-to-end test that runs the real codec-backed encoder.
 */

const AT_MS = Date.UTC(2026, 9, 8, 13, 4, 5, 67);

function shot(overrides: Partial<PageCapture> = {}): PageCapture {
  return { png: Buffer.from("png"), finalUrl: "https://example.com/about", status: 200, title: "About", pageHeight: 800, capturedHeight: 800, blockedRequests: 2, ...overrides };
}

const twoTiles: EncodeTiles = async () => [
  { top: 0, width: 1280, height: 1600, bytes: Buffer.from("tile-1") },
  { top: 1600, width: 1280, height: 400, bytes: Buffer.from("tile-2") },
];

function harness({ capture, encodeTiles = twoTiles }: { capture: (request: PageCaptureRequest) => Promise<PageCapture>; encodeTiles?: EncodeTiles }) {
  const requests: PageCaptureRequest[] = [];
  const events: WebScreenshotEvent[] = [];
  const ports: WebScreenshotPorts = {
    capture: { capture: async (request) => { requests.push(request); return capture(request); }, close: async () => {} },
    encodeTiles,
    nowMs: () => AT_MS,
    observe: (event) => events.push(event),
  };
  return { service: createWebScreenshotService({ ports }), requests, events };
}

test("reads a url input with defaults and strips the fragment", () => {
  expect(readWebScreenshotInput({ input: { url: "https://example.com/about#team" } })).toEqual({
    target: { kind: "url", url: "https://example.com/about" }, viewport: "desktop", fullPage: false, waitMs: 1200,
  });
  expect(readWebScreenshotInput({ input: { sitePath: "/blog", viewport: "mobile", fullPage: true, waitMs: 0, dismissCookieBanners: true, themeId: "my-theme" } })).toEqual({
    target: { kind: "site", path: "/blog" }, viewport: "mobile", fullPage: true, waitMs: 0, dismissCookieBanners: true, themeId: "my-theme",
  });
});

test("refuses ambiguous targets and invalid options with the tool's prefix", () => {
  const refused = (input: Record<string, unknown>) => () => readWebScreenshotInput({ input });
  expect(refused({})).toThrow(ToolInputError);
  expect(refused({ url: "https://a.example", sitePath: "/" })).toThrow(/web_screenshot_page: pass exactly one of 'url'/);
  expect(refused({ url: "https://user:pw@example.com" })).toThrow(/embedded credentials/);
  expect(refused({ url: "ftp://example.com" })).toThrow(/only http and https pages can be captured, not 'ftp:'/);
  expect(refused({ sitePath: "//evil.example" })).toThrow(/root-relative path/);
  expect(refused({ url: "https://example.com", themeId: "x" })).toThrow(/themeId only applies to sitePath/);
  expect(refused({ url: "https://example.com", viewport: "watch" })).toThrow(/viewport must be one of desktop, tablet, mobile/);
  expect(refused({ url: "https://example.com", waitMs: 5001 })).toThrow(/waitMs must be an integer from 0 to 5000/);
});

test("names saved captures by UTC date, time, page slug, viewport, theme and tile", () => {
  const input = readWebScreenshotInput({ input: { sitePath: "/About Us?x=1", themeId: "Dark.Theme" } });
  expect(captureRelativePaths({ capturedAtMs: AT_MS, input, count: 2 })).toEqual([
    "2026-10-08/130405-067-site-about-us-desktop-theme-dark-theme-1.jpg",
    "2026-10-08/130405-067-site-about-us-desktop-theme-dark-theme-2.jpg",
  ]);
  expect(captureRelativePaths({ capturedAtMs: AT_MS, input: readWebScreenshotInput({ input: { url: "https://Example.com/a/b" } }), count: 1 })).toEqual(["2026-10-08/130405-067-example-com-a-b-desktop.jpg"]);
});

test("pins the host capture limits", () => {
  expect(CAPTURE_LIMITS).toEqual({ baseMs: 20_000, fullPageMs: 10_000, capMs: 45_000, reserveMs: 4_000 });
});

test("a public url capture returns facts then one jpeg block per tile, marked untrusted", async () => {
  const { service, requests, events } = harness({ capture: async () => shot({ pageHeight: 9000, capturedHeight: 8000 }) });
  const input = readWebScreenshotInput({ input: { url: "https://example.com/about", fullPage: true } });
  const result = await service.screenshot({ input });
  expect(requests).toEqual([{ url: "https://example.com/about", viewport: VIEWPORT_PRESETS.desktop, fullPage: true, maxPageHeightPx: MAX_FULL_PAGE_HEIGHT_PX, settleMs: 1200, allowedOrigins: [] }]);
  const [facts, ...images] = result.content;
  expect(JSON.parse((facts as { text: string }).text)).toMatchObject({
    requestedUrl: "https://example.com/about", finalUrl: "https://example.com/about", status: 200, truncated: true,
    width: 1280, height: 2000, images: [{ index: 0, top: 0, height: 1600 }, { index: 1, top: 1600, height: 400 }],
    blockedRequests: 2, capturedAt: new Date(AT_MS).toISOString(), untrusted: true, untrustedNotice: UNTRUSTED_NOTICE,
  });
  expect(images).toEqual([
    { type: "image", mimeType: "image/jpeg", data: Buffer.from("tile-1").toString("base64") },
    { type: "image", mimeType: "image/jpeg", data: Buffer.from("tile-2").toString("base64") },
  ]);
  expect(events).toEqual([{ target: "url", origin: "https://example.com", viewport: "desktop", outcome: "captured", durationMs: 0, blockedRequests: 2 }]);
});

test("an own-site capture lets only the loopback origin through, reports a site path and closes the server", async () => {
  let closed = 0;
  const { service, requests } = harness({ capture: async () => shot({ finalUrl: "http://127.0.0.1:4555/blog?p=2" }) });
  const result = await service.screenshot({
    input: readWebScreenshotInput({ input: { sitePath: "/blog" } }),
    openOwnSite: async () => ({ origin: "http://127.0.0.1:4555", close: async () => { closed += 1; } }),
  });
  expect(requests[0]?.allowedOrigins).toEqual(["http://127.0.0.1:4555"]);
  const facts = JSON.parse((result.content[0] as { text: string }).text);
  expect(facts).toMatchObject({ sitePath: "/blog", finalPath: "/blog?p=2" });
  expect(facts.untrusted).toBeUndefined();
  expect(closed).toBe(1);
});

test("maps capture failures to caller-safe refusals", async () => {
  const fail = (error: PageCaptureError) => harness({ capture: async () => { throw error; } }).service.screenshot({ input: readWebScreenshotInput({ input: { url: "https://example.com" } }) });
  await expect(fail(new PageCaptureError({ kind: "refused", message: "x" }))).rejects.toThrow(/https:\/\/example.com is not a public internet address/);
  await expect(fail(new PageCaptureError({ kind: "timeout", message: "x", limitMs: 20_000, loaded: false }))).rejects.toThrow(/did not answer within 20 seconds/);
  await expect(fail(new PageCaptureError({ kind: "timeout", message: "x" }))).rejects.toThrow(/did not finish rendering in time/);
  await expect(fail(new PageCaptureError({ kind: "unavailable", message: "x" }))).rejects.toThrow(/headless browser/);
});

test("a disk failure while saving keeps the pictures and explains the save error", async () => {
  const { service } = harness({ capture: async () => shot() });
  const saveCaptureFiles = async () => { throw Object.assign(new Error("full"), { code: "ENOSPC" }); };
  const result = await service.screenshot({ input: readWebScreenshotInput({ input: { url: "https://example.com" } }), saveCaptureFiles });
  expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ savedFiles: [], saveError: expect.stringContaining("(ENOSPC)") });
  expect(result.content).toHaveLength(3);
});

test("a queued call that outlives its deadline is refused as busy without starting a capture", async () => {
  let finishFirst!: () => void;
  const events: WebScreenshotEvent[] = [];
  const timeouts: Array<() => void> = [];
  let calls = 0;
  const ports: WebScreenshotPorts = {
    capture: { capture: async () => { calls += 1; await new Promise<void>(resolve => { finishFirst = resolve; }); return shot(); }, close: async () => {} },
    encodeTiles: twoTiles,
    nowMs: () => AT_MS,
    observe: (event) => events.push(event),
    scheduleQueueTimeout: ({ onTimeout }) => { timeouts.push(onTimeout); return () => {}; },
  };
  const service = createWebScreenshotService({ ports }, { maxQueueWaitMs: 1000 });
  const input = readWebScreenshotInput({ input: { url: "https://example.com" } });
  const first = service.screenshot({ input });
  const second = service.screenshot({ input });
  await new Promise(resolve => setTimeout(resolve, 0));
  timeouts[1]?.();
  await expect(second).rejects.toThrow(/waited 1000 ms in the screenshot queue/);
  expect(calls).toBe(1);
  expect(events.map(event => event.outcome)).toEqual(["busy"]);
  finishFirst();
  await expect(first).resolves.toBeDefined();
  expect(() => createWebScreenshotService({ ports }, { maxQueueWaitMs: 60_001 })).toThrow(/maxQueueWaitMs must be an integer from 0 to 60000/);
});

test("refuses malformed theme ids, urls and option types with their own exact reasons", () => {
  const refused = (input: Record<string, unknown>) => () => readWebScreenshotInput({ input });
  expect(refused({ sitePath: "/", themeId: 7 })).toThrow(/themeId must be an installed theme's id/);
  expect(refused({ sitePath: "/", themeId: "-starts-with-dash" })).toThrow(/themeId must be an installed theme's id/);
  expect(refused({ url: 42 })).toThrow(/url must be an absolute http\(s\) URL of at most 2048 characters/);
  expect(refused({ url: "" })).toThrow(/url must be an absolute http\(s\) URL of at most 2048 characters/);
  expect(refused({ url: `https://example.com/${"a".repeat(2048)}` })).toThrow(/at most 2048 characters/);
  expect(refused({ url: "not a url" })).toThrow(/url must be an absolute http\(s\) URL, e\.g\. https:\/\/example\.com\/about/);
  expect(refused({ url: "https://example.com", dismissCookieBanners: "yes" })).toThrow(/dismissCookieBanners must be a boolean/);
  expect(refused({ url: "https://example.com", fullPage: "true" })).toThrow(/fullPage must be a boolean/);
  expect(readWebScreenshotInput({ input: { url: "https://example.com", dismissCookieBanners: false } }).dismissCookieBanners).toBe(false);
});

test("an own-site themed capture opens the site with that theme, forwards the banner flag and signal, and saves every tile", async () => {
  const opened: unknown[] = [];
  const saved: (readonly { relPath: string; bytes: Buffer }[])[] = [];
  const { service, requests } = harness({ capture: async () => shot({ finalUrl: "https://elsewhere.example/landing", note: "banner dismissed" }) });
  const controller = new AbortController();
  const ports: { openOwnSite: OpenOwnSite } = { openOwnSite: async (_required, options) => { opened.push(options); return { origin: "http://127.0.0.1:4555", close: async () => {} }; } };
  const input = readWebScreenshotInput({ input: { sitePath: "/shop", themeId: "night", dismissCookieBanners: true } });
  const result = await service.screenshot({ input, openOwnSite: ports.openOwnSite,
    saveCaptureFiles: async ({ files }) => { saved.push(files); return files.map((file) => `.captures/${file.relPath}`); } }, { signal: controller.signal });
  expect(opened).toEqual([{ themeId: "night" }]);
  expect(requests[0]).toMatchObject({ url: "http://127.0.0.1:4555/shop", dismissCookieBanners: true, allowedOrigins: ["http://127.0.0.1:4555"] });
  const facts = JSON.parse((result.content[0] as { text: string }).text);
  const paths = captureRelativePaths({ capturedAtMs: AT_MS, input, count: 2 });
  expect(facts).toMatchObject({ sitePath: "/shop", finalPath: "https://elsewhere.example/landing", themeId: "night", note: "banner dismissed", savedFiles: paths.map((p) => `.captures/${p}`) });
  expect(saved).toEqual([[{ relPath: paths[0], bytes: Buffer.from("tile-1") }, { relPath: paths[1], bytes: Buffer.from("tile-2") }]]);
});

test("the capture port receives the caller's signal only when one is given", async () => {
  const options: unknown[] = [];
  const ports: WebScreenshotPorts = { capture: { capture: async (_request, opts) => { options.push(opts); return shot(); }, close: async () => {} }, encodeTiles: twoTiles, nowMs: () => AT_MS };
  const service = createWebScreenshotService({ ports });
  const input = readWebScreenshotInput({ input: { url: "https://example.com" } });
  const controller = new AbortController();
  await service.screenshot({ input }, { signal: controller.signal });
  await service.screenshot({ input });
  expect(options).toEqual([{ signal: controller.signal }, {}]);
});

test("an own-site request without a site opener is refused before any capture", async () => {
  const { service, requests } = harness({ capture: async () => shot() });
  await expect(service.screenshot({ input: readWebScreenshotInput({ input: { sitePath: "/" } }) })).rejects.toThrow(/cannot render this site's own pages here; pass a public url instead/);
  expect(requests).toEqual([]);
});

test("an opener origin that the site path does not resolve back to is refused before any capture", async () => {
  const { service, requests } = harness({ capture: async () => shot() });
  const input = readWebScreenshotInput({ input: { sitePath: "/about" } });
  await expect(service.screenshot({ input, openOwnSite: async () => ({ origin: "http://127.0.0.1:80", close: async () => {} }) })).rejects.toThrow(/sitePath must stay on this site/);
  expect(requests).toEqual([]);
});

test("a final URL that cannot be parsed is reported as given", async () => {
  const { service } = harness({ capture: async () => shot({ finalUrl: "not a url" }) });
  const result = await service.screenshot({ input: readWebScreenshotInput({ input: { sitePath: "/" } }), openOwnSite: async () => ({ origin: "http://127.0.0.1:4555", close: async () => {} }) });
  expect(JSON.parse((result.content[0] as { text: string }).text).finalPath).toBe("not a url");
});

test("a save failure without an error code still explains itself, and a page with no tiles reports zero width", async () => {
  const { service } = harness({ capture: async () => shot(), encodeTiles: async () => [] });
  const result = await service.screenshot({ input: readWebScreenshotInput({ input: { url: "https://example.com" } }), saveCaptureFiles: async () => { throw new Error("denied"); } });
  const facts = JSON.parse((result.content[0] as { text: string }).text);
  expect(facts).toMatchObject({ width: 0, height: 0, images: [], savedFiles: [], saveError: "the capture could not be saved to disk (write failed); the images above are still valid." });
  expect(result.content).toHaveLength(1);
});

test("a generic capture failure and a loaded-but-unsettled timeout get their own messages and outcomes", async () => {
  const failing = (error: PageCaptureError) => harness({ capture: async () => { throw error; } });
  const input = readWebScreenshotInput({ input: { url: "https://example.com/x" } });
  const generic = failing(new PageCaptureError({ kind: "failed", message: "net::ERR_NAME_NOT_RESOLVED" }));
  await expect(generic.service.screenshot({ input })).rejects.toThrow("could not load https://example.com (net::ERR_NAME_NOT_RESOLVED). Check the address and that the site is up.");
  expect(generic.events.map((event) => event.outcome)).toEqual(["failed"]);
  const slow = failing(new PageCaptureError({ kind: "timeout", message: "x", limitMs: 30_000, loaded: true }));
  await expect(slow.service.screenshot({ input })).rejects.toThrow("https://example.com did not finish rendering within 30 seconds.");
});

test("an unexpected capture error propagates unchanged and the own-site server is still closed", async () => {
  const boom = new TypeError("port crashed");
  let closed = 0;
  const { service, events } = harness({ capture: async () => { throw boom; } });
  await expect(service.screenshot({ input: readWebScreenshotInput({ input: { sitePath: "/" } }), openOwnSite: async () => ({ origin: "http://127.0.0.1:4555", close: async () => { closed += 1; } }) })).rejects.toBe(boom);
  expect(closed).toBe(1);
  expect(events).toEqual([]);
});

function blockingPorts(extra: Partial<WebScreenshotPorts> = {}) {
  let finishFirst!: () => void;
  const events: WebScreenshotEvent[] = [];
  let calls = 0;
  const ports: WebScreenshotPorts = {
    capture: { capture: async () => { calls += 1; if (calls === 1) await new Promise<void>((resolve) => { finishFirst = resolve; }); return shot(); }, close: async () => {} },
    encodeTiles: twoTiles, nowMs: () => AT_MS, observe: (event) => events.push(event), ...extra,
  };
  return { ports, events, calls: () => calls, finish: () => finishFirst() };
}

test("a queued own-site call that times out is observed as busy for the own site", async () => {
  const timeouts: Array<() => void> = [];
  const { ports, events, finish } = blockingPorts({ scheduleQueueTimeout: ({ onTimeout }) => { timeouts.push(onTimeout); return () => {}; } });
  const service = createWebScreenshotService({ ports }, { maxQueueWaitMs: 500 });
  const first = service.screenshot({ input: readWebScreenshotInput({ input: { url: "https://example.com" } }) });
  const second = service.screenshot({ input: readWebScreenshotInput({ input: { sitePath: "/" } }), openOwnSite: async () => ({ origin: "http://127.0.0.1:4555", close: async () => {} }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  timeouts[1]?.();
  await expect(second).rejects.toThrow(/waited 500 ms/);
  expect(events).toEqual([{ target: "site", origin: "own-site", viewport: "desktop", outcome: "busy", durationMs: 0 }]);
  finish();
  await first;
});

test("a queued call stopped by its caller rejects with the abort reason, cancels its timer and never captures", async () => {
  const cancelled: number[] = [];
  const { ports, calls, finish } = blockingPorts({ scheduleQueueTimeout: () => () => { cancelled.push(1); } });
  const service = createWebScreenshotService({ ports });
  const input = readWebScreenshotInput({ input: { url: "https://example.com" } });
  const first = service.screenshot({ input });
  const controller = new AbortController();
  const second = service.screenshot({ input }, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const reason = new Error("stopped by user");
  controller.abort(reason);
  await expect(second).rejects.toBe(reason);
  expect(calls()).toBe(1);
  expect(cancelled.length).toBe(2);
  finish();
  await first;
});

test("a queue timer that cannot be scheduled fails the call without capturing", async () => {
  const failure = new Error("no timers");
  const { ports, calls } = blockingPorts({ scheduleQueueTimeout: () => { throw failure; } });
  const service = createWebScreenshotService({ ports });
  await expect(service.screenshot({ input: readWebScreenshotInput({ input: { url: "https://example.com" } }) })).rejects.toBe(failure);
  expect(calls()).toBe(0);
});
