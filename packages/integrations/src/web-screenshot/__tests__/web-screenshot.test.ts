import { ToolInputError } from "@jini-ai/core";
import { expect, test } from "vitest";
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
  type PageCapture,
  type PageCaptureRequest,
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
  expect(readWebScreenshotInput({ url: "https://example.com/about#team" })).toEqual({
    target: { kind: "url", url: "https://example.com/about" }, viewport: "desktop", fullPage: false, waitMs: 1200,
  });
  expect(readWebScreenshotInput({ sitePath: "/blog", viewport: "mobile", fullPage: true, waitMs: 0, dismissCookieBanners: true, themeId: "my-theme" })).toEqual({
    target: { kind: "site", path: "/blog" }, viewport: "mobile", fullPage: true, waitMs: 0, dismissCookieBanners: true, themeId: "my-theme",
  });
});

test("refuses ambiguous targets and invalid options with the tool's prefix", () => {
  const refused = (input: Record<string, unknown>) => () => readWebScreenshotInput(input);
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
  const input = readWebScreenshotInput({ sitePath: "/About Us?x=1", themeId: "Dark.Theme" });
  expect(captureRelativePaths({ capturedAtMs: AT_MS, input, count: 2 })).toEqual([
    "2026-10-08/130405-067-site-about-us-desktop-theme-dark-theme-1.jpg",
    "2026-10-08/130405-067-site-about-us-desktop-theme-dark-theme-2.jpg",
  ]);
  expect(captureRelativePaths({ capturedAtMs: AT_MS, input: readWebScreenshotInput({ url: "https://Example.com/a/b" }), count: 1 })).toEqual(["2026-10-08/130405-067-example-com-a-b-desktop.jpg"]);
});

test("pins the host capture limits", () => {
  expect(CAPTURE_LIMITS).toEqual({ baseMs: 20_000, fullPageMs: 10_000, capMs: 45_000, reserveMs: 4_000 });
});

test("a public url capture returns facts then one jpeg block per tile, marked untrusted", async () => {
  const { service, requests, events } = harness({ capture: async () => shot({ pageHeight: 9000, capturedHeight: 8000 }) });
  const input = readWebScreenshotInput({ url: "https://example.com/about", fullPage: true });
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
    input: readWebScreenshotInput({ sitePath: "/blog" }),
    openOwnSite: async () => ({ origin: "http://127.0.0.1:4555", close: async () => { closed += 1; } }),
  });
  expect(requests[0]?.allowedOrigins).toEqual(["http://127.0.0.1:4555"]);
  const facts = JSON.parse((result.content[0] as { text: string }).text);
  expect(facts).toMatchObject({ sitePath: "/blog", finalPath: "/blog?p=2" });
  expect(facts.untrusted).toBeUndefined();
  expect(closed).toBe(1);
});

test("maps capture failures to caller-safe refusals", async () => {
  const fail = (error: PageCaptureError) => harness({ capture: async () => { throw error; } }).service.screenshot({ input: readWebScreenshotInput({ url: "https://example.com" }) });
  await expect(fail(new PageCaptureError({ kind: "refused", message: "x" }))).rejects.toThrow(/https:\/\/example.com is not a public internet address/);
  await expect(fail(new PageCaptureError({ kind: "timeout", message: "x", limitMs: 20_000, loaded: false }))).rejects.toThrow(/did not answer within 20 seconds/);
  await expect(fail(new PageCaptureError({ kind: "timeout", message: "x" }))).rejects.toThrow(/did not finish rendering in time/);
  await expect(fail(new PageCaptureError({ kind: "unavailable", message: "x" }))).rejects.toThrow(/headless browser/);
});

test("a disk failure while saving keeps the pictures and explains the save error", async () => {
  const { service } = harness({ capture: async () => shot() });
  const saveCaptureFiles = async () => { throw Object.assign(new Error("full"), { code: "ENOSPC" }); };
  const result = await service.screenshot({ input: readWebScreenshotInput({ url: "https://example.com" }), saveCaptureFiles });
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
  const input = readWebScreenshotInput({ url: "https://example.com" });
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
