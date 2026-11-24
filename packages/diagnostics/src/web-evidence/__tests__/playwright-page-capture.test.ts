import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { CaptureBudgetLimits } from "../capture-budget.js";
import { PageWorkTimeout, type RenderBrowserPool } from "../playwright-browser.js";

import type { HttpResponse } from "@jini-ai/core/primitives";
import { createPlaywrightPageCapture, type CaptureHttpClient as HttpClientPort, type CaptureBrowser, type CaptureBrowserLauncher, type CaptureContextOptions, type CaptureLaunchOptions, type CapturePage } from "../playwright-page-capture.js";
import { MAX_REDIRECT_HOPS, type RouteLike } from "../playwright-browser.js";
import type { PageCaptureRequest } from "@jini-ai/core/contracts/site/web-screenshot";
import { captureDeps, EgressRefusedError, PageCaptureError, VIEWPORT_PRESETS } from "./page-capture-test-deps.js";

/**
 * @file The Playwright adapter against a structural fake browser (no Chromium, no module mocks).
 * The fake page's `goto` drives the registered route handler with a main-frame navigation request,
 * the way Chromium would, so refusal detection is exercised through the real router.
 */

interface FakeOptions {
  failLaunch?: boolean;
  /** Status the fake "network" (the fulfilled route) answers the navigation with. */
  hangGoto?: boolean;
  pageHeight?: unknown;
  gotoError?: unknown;
  nullResponse?: boolean;
  scrollError?: Error;
  onGoto?: () => void;
  /** Thrown by the Nth (0-based) screenshot call; later calls succeed. */
  screenshotErrors?: unknown[];
  onScreenshot?: (options: { timeout: number; animations: string }) => void;
  onTitle?: () => void;
}

function fakeBrowser({ failLaunch = false, hangGoto = false, pageHeight = 2400, gotoError, nullResponse = false, scrollError, onGoto, screenshotErrors = [], onScreenshot, onTitle }: FakeOptions = {}) {
  const events: string[] = [];
  const launches: CaptureLaunchOptions[] = [];
  const contexts: CaptureContextOptions[] = [];
  // `animations` widened to string: the adapter's current-frame fallback passes Playwright's "allow".
  const screenshots: Array<Omit<Parameters<CapturePage["screenshot"]>[0], "animations"> & { animations: string }> = [];
  const browser: CaptureBrowser = {
    async newContext(options) {
      contexts.push(options);
      let handler: ((route: RouteLike) => Promise<void>) | undefined;
      return {
        async route(pattern, routeHandler) { events.push(`route:${pattern}`); handler = routeHandler; },
        async routeWebSocket(pattern) { events.push(`ws:${pattern}`); },
        async newPage() {
          let current = "about:blank";
          const page: CapturePage = {
            async goto(url) {
              onGoto?.();
              if (gotoError !== undefined) throw gotoError;
              if (hangGoto) await new Promise(() => {});
              let fulfilled: number | undefined;
              let aborted: string | undefined;
              await handler!({
                request: () => ({ url: () => url, method: () => "GET", headers: () => ({}), resourceType: () => "document", isNavigationRequest: () => true, frame: () => ({ parentFrame: () => null }) }),
                fulfill: async ({ status }) => { fulfilled = status; },
                abort: async (code) => { aborted = code; },
              });
              if (aborted) throw new Error(`page.goto: net::ERR_BLOCKED_BY_CLIENT at ${url}`);
              current = url;
              return nullResponse ? null : { status: () => fulfilled! };
            },
            async waitForTimeout(ms) { events.push(`settle:${ms}`); },
            async evaluate(expression) {
              const scrolling = expression.includes("scrollTo");
              events.push(scrolling ? "scroll-through" : "measure");
              if (scrolling && scrollError) throw scrollError;
              return pageHeight;
            },
            async title() { onTitle?.(); return "T".repeat(400); },
            url: () => current,
            async screenshot(options) {
              screenshots.push(options);
              onScreenshot?.(options);
              const failure = screenshotErrors[screenshots.length - 1];
              if (failure !== undefined) throw failure;
              const mode: string = options.animations;
              return Buffer.from(mode === "allow" ? "png-allow" : "png");
            },
          };
          return page;
        },
        async close() { events.push("context-close"); },
      };
    },
    async close() { events.push("browser-close"); },
  };
  const launcher: CaptureBrowserLauncher = {
    async launch(options) {
      launches.push(options);
      events.push("launch");
      if (failLaunch) throw new Error("Executable doesn't exist at /Users/x/ms-playwright/chromium");
      return browser;
    },
  };
  return { launcher, events, launches, contexts, screenshots };
}

/** Limits under which every request gets exactly `totalMs`, however long its requested wait. */
function fixedLimits({ totalMs, reserveMs }: { totalMs: number; reserveMs: number }): CaptureBudgetLimits {
  return { baseMs: totalMs, fullPageMs: 0, capMs: totalMs, reserveMs };
}

function client(behavior: "ok" | "refuse"): HttpClientPort & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async send(request) {
      urls.push(request.url);
      if (behavior === "refuse") throw new EgressRefusedError({ message: "private" }, { callerSafeMessage: "refused" });
      return { status: 200, headers: { "content-type": "text/html" }, bodyText: "<p>x</p>", bodyBytes: Buffer.from("<p>x</p>") };
    },
  };
}

function request(overrides: Partial<PageCaptureRequest> = {}): PageCaptureRequest {
  return { url: "https://example.com/", viewport: VIEWPORT_PRESETS.desktop, fullPage: false, maxPageHeightPx: 8000, settleMs: 1200, allowedOrigins: [], ...overrides };
}

test("launches sandboxed Chromium behind a dead proxy, in a fresh isolated context per capture, and reuses one browser", async () => {
  const fake = fakeBrowser();
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  const first = await capture.capture(request());
  await capture.capture(request({ viewport: VIEWPORT_PRESETS.mobile }));
  await capture.close();

  assert.equal(fake.launches.length, 1);
  assert.equal(fake.launches[0]!.chromiumSandbox, true, "untrusted pages must render with the sandbox on");
  assert.ok(fake.launches[0]!.args.includes("--proxy-server=http://127.0.0.1:9"));
  assert.ok(fake.launches[0]!.args.includes("--proxy-bypass-list=<-loopback>"));
  assert.ok(!fake.launches[0]!.args.includes("--no-sandbox"));
  assert.deepEqual(fake.contexts.map((context) => [context.viewport.width, context.viewport.height, context.deviceScaleFactor, context.isMobile, context.hasTouch]), [[1280, 800, 1, false, false], [375, 812, 2, true, true]]);
  for (const context of fake.contexts) {
    assert.equal(context.serviceWorkers, "block");
    assert.equal(context.acceptDownloads, false);
    assert.equal(context.ignoreHTTPSErrors, false);
  }
  assert.deepEqual(fake.events, [
    "launch", "ws:/.*/", "route:**/*", "settle:1200", "context-close",
    "ws:/.*/", "route:**/*", "settle:1200", "context-close", "browser-close",
  ]);
  assert.equal(first.status, 200);
  assert.equal(first.finalUrl, "https://example.com/");
  assert.equal(first.title.length, 300, "titles are capped");
  assert.deepEqual([first.pageHeight, first.capturedHeight], [800, 800]);
});

test("allowUnsandboxed is the only way to turn the sandbox off", async () => {
  const fake = fakeBrowser();
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher, allowUnsandboxed: true });
  await capture.capture(request());
  await capture.close();
  assert.equal(fake.launches[0]!.chromiumSandbox, false);
});

test("full page: height is measured, capped at maxPageHeightPx, and captured as a clip of that size", async () => {
  const fake = fakeBrowser({ pageHeight: 20_000 });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  const shot = await capture.capture(request({ fullPage: true }));
  await capture.close();
  assert.deepEqual([shot.pageHeight, shot.capturedHeight], [20_000, 8000]);
  // Scroll-reveal sections and lazy images only render once scrolled into view, so the page is
  // scrolled through (bounded by the cap) BEFORE its height is measured and shot.
  assert.deepEqual(fake.events.filter((event) => event === "scroll-through" || event === "measure"), ["scroll-through", "measure"]);
  const { timeout, ...shotOptions } = fake.screenshots[0]!;
  assert.ok(timeout > 0 && timeout <= 31_200 - 4_000, "screenshot gets only the remaining total budget (a full page with a 1.2 s wait may take 31.2 s) less the fallback reserve");
  assert.deepEqual(shotOptions, { type: "png", fullPage: true, animations: "disabled", clip: { x: 0, y: 0, width: 1280, height: 8000 } });
});

test("a top-level navigation the egress guard refuses is a 'refused' PageCaptureError, and the context is still closed", async () => {
  const fake = fakeBrowser();
  const httpClient = client("refuse");
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient }), { loadLauncher: async () => fake.launcher });
  await assert.rejects(capture.capture(request({ url: "http://intranet.example/" })), (error: unknown) => error instanceof PageCaptureError && error.kind === "refused");
  await capture.close();
  assert.deepEqual(httpClient.urls, ["http://intranet.example/"]);
  assert.ok(fake.events.includes("context-close"));
});

test("a missing browser is 'unavailable', and the next capture tries to launch again", async () => {
  const fake = fakeBrowser({ failLaunch: true });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  await assert.rejects(capture.capture(request()), (error: unknown) => error instanceof PageCaptureError && error.kind === "unavailable");
  await assert.rejects(capture.capture(request()), (error: unknown) => error instanceof PageCaptureError && error.kind === "unavailable");
  assert.equal(fake.launches.length, 2);
});

test("a page that never finishes is a 'timeout', and the whole browser is closed so a hung renderer cannot linger", async () => {
  const fake = fakeBrowser({ hangGoto: true });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok"), limits: fixedLimits({ totalMs: 30, reserveMs: 10 }) }), { loadLauncher: async () => fake.launcher });
  await assert.rejects(capture.capture(request()), (error: unknown) => error instanceof PageCaptureError && error.kind === "timeout");
  assert.ok(fake.events.includes("browser-close"));
});

test("the browser closes by itself after the idle period", async () => {
  const fake = fakeBrowser();
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher, idleCloseMs: 10 });
  await capture.capture(request());
  assert.ok(!fake.events.includes("browser-close"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(fake.events.at(-1), "browser-close");
});

// Playwright does not route the next hop of a fulfilled 3xx, so the page's redirects are followed
// by navigating again — every hop goes through the router (and the guard) like the first.
function redirectingClient(hops: Record<string, string>): HttpClientPort & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async send(request): Promise<HttpResponse> {
      urls.push(request.url);
      const location = hops[request.url];
      if (location !== undefined) return { status: 301, headers: { location }, bodyText: "", bodyBytes: new Uint8Array() };
      return { status: 200, headers: { "content-type": "text/html" }, bodyText: "<p>x</p>", bodyBytes: Buffer.from("<p>x</p>") };
    },
  };
}

test("the page's own redirect is followed by navigating to its target, so the capture reports the real final URL", async () => {
  const fake = fakeBrowser();
  const httpClient = redirectingClient({ "https://example.com/": "https://www.example.com/" });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient }), { loadLauncher: async () => fake.launcher });
  const shot = await capture.capture(request());
  await capture.close();
  assert.deepEqual(httpClient.urls, ["https://example.com/", "https://www.example.com/"]);
  assert.equal(shot.finalUrl, "https://www.example.com/");
  assert.equal(shot.status, 200);
});

test("a redirect to a private address is 'refused' at that hop; endless redirects are 'failed' after MAX_REDIRECT_HOPS", async () => {
  const fake = fakeBrowser();
  const toPrivate: HttpClientPort & { urls: string[] } = {
    urls: [],
    async send(request) {
      this.urls.push(request.url);
      if (request.url.includes("intranet")) throw new EgressRefusedError({ message: "private" }, { callerSafeMessage: "refused" });
      return { status: 302, headers: { location: "http://intranet.example/secret" }, bodyText: "", bodyBytes: new Uint8Array() };
    },
  };
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: toPrivate }), { loadLauncher: async () => fake.launcher });
  await assert.rejects(capture.capture(request()), (error: unknown) => error instanceof PageCaptureError && error.kind === "refused");
  assert.deepEqual(toPrivate.urls, ["https://example.com/", "http://intranet.example/secret"]);

  await capture.close();

  const loop = redirectingClient({ "https://example.com/": "https://example.com/" });
  const looping = createPlaywrightPageCapture(captureDeps({ httpClient: loop }), { loadLauncher: async () => fakeBrowser().launcher });
  // Jini's redirect diagnostic carries an origin; the capture boundary exposes only its safe fallback.
  await assert.rejects(looping.capture(request()), (error: unknown) => error instanceof PageCaptureError && error.kind === "failed" && error.message === "navigation failed");
  await looping.close();
  assert.equal(loop.urls.length, MAX_REDIRECT_HOPS + 1);
});

test("screenshots preserve cookie banners by default and wait for capped load after their wait strategy", async () => {
  const fake = fakeBrowser();
  const originalNewContext = fake.launcher.launch;
  fake.launcher.launch = async options => {
    const browser = await originalNewContext(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async contextOptions => {
      const context = await newContext(contextOptions); const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        const locator = { first: () => locator, count: async () => 1, isVisible: async () => true, click: async () => { fake.events.push("cookie-dismiss"); } };
        return Object.assign(page, { waitForLoadState: async (state: string, options: { timeout: number }) => { assert.equal(state, "load"); assert.ok(options.timeout > 0 && options.timeout <= 5000); fake.events.push("load-wait"); }, locator: () => locator, waitForSelector: async (selector: string) => { fake.events.push(`selector:${selector}`); } });
      };
      return context;
    };
    return browser;
  };
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  await capture.capture(request({ waitFor: "#loaded" }));
  assert.ok(!fake.events.includes("cookie-dismiss"));
  assert.ok(fake.events.indexOf("selector:#loaded") < fake.events.indexOf("load-wait"));
  await capture.capture(request({ waitFor: "#loaded", dismissCookieBanners: true }));
  await capture.close();
  assert.ok(fake.events.includes("cookie-dismiss"));
  assert.equal(fake.screenshots.length, 2);
  assert.equal(fake.events.filter(event => event === "load-wait").length, 2);
  assert.ok(fake.events.includes("context-close"));
});

test("screenshot uses an injected shared browser pool without launching or closing an active sibling", async () => {
  const fake = fakeBrowser(); const launched = await fake.launcher.launch({ headless: true, chromiumSandbox: false, args: [] });
  let leases = 0; let closes = 0;
  const browserPool = {
    acquire: async () => {
      leases++;
      return { browser: { newContext: () => launched.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, serviceWorkers: "block" as const, acceptDownloads: false as const, ignoreHTTPSErrors: false as const, javaScriptEnabled: true as const }), close: () => launched.close() }, release: () => { leases--; } };
    },
    close: async () => { closes++; },
  };
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { browserPool, loadLauncher: async () => { throw new Error("the injected pool owns launching"); } });
  await capture.capture(request());
  assert.equal(leases, 0); assert.equal(fake.launches.length, 1);
  assert.ok(fake.events.includes("context-close")); assert.ok(!fake.events.includes("browser-close"));
  await capture.close(); assert.equal(closes, 1);
});

test("the default launcher resolves the host Playwright module and captures through its structural adapter", async t => {
  const fake = fakeBrowser();
  // Only the external SDK is replaced (the host's injected loader); the default launcher, browser pool and renderer all run.
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok"), importPlaywrightChromium: async () => ({ launch: options => fake.launcher.launch(options as unknown as CaptureLaunchOptions) }) }));
  t.onTestFinished(() => capture.close());
  const result = await capture.capture(request());
  assert.deepEqual(result.png, Buffer.from("png"));
  assert.equal(result.finalUrl, "https://example.com/");
  assert.equal(result.status, 200);
  assert.equal(fake.launches[0]?.chromiumSandbox, true);
  assert.ok(fake.events.includes("context-close"));
});

test("full-page capture rounds a finite height up and falls back to the viewport for invalid measurements", async t => {
  for (const [pageHeight, expected] of [[901.2, 902], ["2400", 800], [NaN, 800], [Infinity, 800], [0, 800], [-1, 800]] as const) {
    const fake = fakeBrowser({ pageHeight });
    const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
    t.onTestFinished(() => capture.close());
    const result = await capture.capture(request({ fullPage: true }));
    assert.deepEqual([result.pageHeight, result.capturedHeight], [expected, expected]);
    assert.deepEqual(fake.screenshots[0]?.clip, { x: 0, y: 0, width: 1280, height: expected });
  }
});

test("a page without a navigation response still produces a capture with null status", async t => {
  const fake = fakeBrowser({ nullResponse: true });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  t.onTestFinished(() => capture.close());
  const result = await capture.capture(request());
  assert.equal(result.status, null);
  assert.deepEqual(result.png, Buffer.from("png"));
});

test("a scroll-reveal script failure is best effort and does not prevent the full-page screenshot", async t => {
  const fake = fakeBrowser({ scrollError: new Error("page script failed") });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  t.onTestFinished(() => capture.close());
  const result = await capture.capture(request({ fullPage: true }));
  assert.deepEqual([result.pageHeight, result.capturedHeight], [2400, 2400]);
  assert.deepEqual(result.png, Buffer.from("png"));
  assert.deepEqual(fake.events.filter(event => ["scroll-through", "measure"].includes(event)), ["scroll-through", "measure"]);
});

test("a scroll-reveal budget timeout aborts capture and closes the context", async t => {
  const fake = fakeBrowser({ scrollError: new PageWorkTimeout({ timeoutMs: 1000 }) });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok"), limits: fixedLimits({ totalMs: 1000, reserveMs: 200 }) }), { loadLauncher: async () => fake.launcher });
  t.onTestFinished(() => capture.close());
  await assert.rejects(capture.capture(request({ fullPage: true })), (error: unknown) => {
    assert.ok(error instanceof PageCaptureError);
    assert.equal(error.kind, "timeout");
    assert.equal(error.message, "exceeded 1000ms");
    return true;
  });
  assert.ok(fake.events.includes("context-close"));
  assert.deepEqual(fake.screenshots, []);
});

test("navigation errors expose only a Chromium code or a generic message", async t => {
  for (const [gotoError, expected] of [
    [new Error("page.goto: net::ERR_CONNECTION_RESET at http://private.example/secret"), "ERR_CONNECTION_RESET"],
    [new Error("private diagnostic details"), "navigation failed"],
    ["private non-Error rejection", "navigation failed"],
  ] as const) {
    const fake = fakeBrowser({ gotoError });
    const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
    t.onTestFinished(() => capture.close());
    await assert.rejects(capture.capture(request()), (error: unknown) => {
      assert.ok(error instanceof PageCaptureError);
      assert.equal(error.kind, "failed");
      assert.equal(error.message, expected);
      return true;
    });
    assert.ok(fake.events.includes("context-close"));
    assert.deepEqual(fake.screenshots, []);
  }
});

test("a caller's already-aborted signal prevents launch and an active abort prevents a screenshot", async t => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const fake = fakeBrowser();
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  t.onTestFinished(() => capture.close());
  await assert.rejects(capture.capture(request(), { signal: alreadyAborted.signal }), (error: unknown) => {
    assert.equal(error, alreadyAborted.signal.reason, "the cancel's own error, not an 'unavailable' capture failure");
    return true;
  });
  assert.deepEqual(fake.launches, []);

  const controller = new AbortController();
  const active = fakeBrowser({ onGoto: () => controller.abort() });
  const running = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => active.launcher });
  t.onTestFinished(() => running.close());
  await assert.rejects(running.capture(request(), { signal: controller.signal }), (error: unknown) => {
    assert.equal(error, controller.signal.reason, "the cancel's own error, not a 'navigation failed' capture failure");
    return true;
  });
  assert.ok(active.events.includes("context-close"));
  assert.deepEqual(active.screenshots, []);
});

test("a shared browser without screenshot support reports a safe failure and releases its lease", async t => {
  const fake = fakeBrowser();
  const launched = await fake.launcher.launch({ headless: true, chromiumSandbox: true, args: [] });
  let released = 0;
  const pool: RenderBrowserPool = {
    acquire: async () => ({
      browser: {
        newContext: async options => {
          const context = await launched.newContext(options as unknown as CaptureContextOptions);
          return { ...context, newPage: async () => {
            const { screenshot: _screenshot, ...page } = await context.newPage();
            return page;
          } };
        },
        close: () => launched.close(),
      },
      release: () => { released++; },
    }),
    close: () => launched.close(),
  };
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { browserPool: pool });
  t.onTestFinished(() => capture.close());
  await assert.rejects(capture.capture(request()), (error: unknown) => {
    assert.ok(error instanceof PageCaptureError);
    assert.equal(error.kind, "failed");
    assert.equal(error.message, "navigation failed");
    return true;
  });
  assert.equal(released, 1);
  assert.ok(fake.events.includes("context-close"));
  assert.deepEqual(fake.screenshots, []);
});

/** Playwright's own per-operation timeout error (`errors.TimeoutError`), structurally. */
function playwrightTimeout(): Error {
  return Object.assign(new Error("page.screenshot: Timeout 16000ms exceeded. waiting for animations to finish"), { name: "TimeoutError" });
}

test("a page still animating spends its stable budget, captures a fallback, and reads metadata inside the remaining budget", async (t) => {
  let now = 0, titles = 0;
  const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  t.onTestFinished(() => nowSpy.mockRestore());
  const fake = fakeBrowser({ screenshotErrors: [playwrightTimeout()], onScreenshot: options => { now += options.animations === "disabled" ? options.timeout : 1_000; }, onTitle: () => { titles++; now += 100; } });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok"), limits: fixedLimits({ totalMs: 20_000, reserveMs: 4_000 }) }), { loadLauncher: async () => fake.launcher });
  const shot = await capture.capture(request());
  await capture.close();
  assert.equal(shot.png.toString(), "png-allow", "the fallback frame is what is returned");
  assert.match(shot.note ?? "", /still animating/);
  assert.equal(shot.status, 200);
  assert.deepEqual(fake.screenshots.map((options) => options.animations), ["disabled", "allow"]);
  assert.ok(fake.screenshots[0]!.timeout <= 20_000 - 4_000, "the stable-frame attempt leaves time for the current-frame fallback");
  assert.equal(fake.screenshots[0]!.timeout, 16_000);
  assert.equal(fake.screenshots[1]!.timeout, 4_000);
  assert.equal(titles, 1);
  assert.equal(now, 17_100);
});

test("a page that settles normally carries no note", async () => {
  const fake = fakeBrowser();
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  const shot = await capture.capture(request());
  await capture.close();
  assert.equal(shot.note, undefined);
  assert.equal(fake.screenshots.length, 1);
});

test("a screenshot error that is not a timeout is still a 'failed' capture (no fallback frame)", async () => {
  const fake = fakeBrowser({ screenshotErrors: [new Error("Target page, context or browser has been closed")] });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  await assert.rejects(capture.capture(request()), (error: unknown) => error instanceof PageCaptureError && error.kind === "failed");
  await capture.close();
  assert.equal(fake.screenshots.length, 1);
});

test("when the current-frame fallback also times out the capture is a 'timeout'", async () => {
  const fake = fakeBrowser({ screenshotErrors: [playwrightTimeout(), playwrightTimeout()] });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  await assert.rejects(capture.capture(request()), (error: unknown) => error instanceof PageCaptureError && error.kind === "timeout");
  await capture.close();
  assert.equal(fake.screenshots.length, 2);
});

test("a non-timeout error from the current-frame fallback is still a 'failed' capture", async () => {
  const fake = fakeBrowser({ screenshotErrors: [playwrightTimeout(), new Error("Target page, context or browser has been closed")] });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok") }), { loadLauncher: async () => fake.launcher });
  await assert.rejects(capture.capture(request()), (error: unknown) => error instanceof PageCaptureError && error.kind === "failed");
  await capture.close();
});

test("fallback exhausting the remaining deadline cannot start the metadata read", async (t) => {
  let now = 0, titles = 0; const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now); t.onTestFinished(() => nowSpy.mockRestore());
  const fake = fakeBrowser({ screenshotErrors: [playwrightTimeout()], onScreenshot: options => { now += options.timeout; }, onTitle: () => { titles++; } });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient: client("ok"), limits: fixedLimits({ totalMs: 20_000, reserveMs: 4_000 }) }), { loadLauncher: async () => fake.launcher });
  t.onTestFinished(() => capture.close());
  await assert.rejects(capture.capture(request()), (err: unknown) => err instanceof PageCaptureError && err.kind === "timeout");
  assert.deepEqual(fake.screenshots.map(s => s.timeout), [16_000, 4_000]); assert.equal(titles, 0); assert.equal(now, 20_000);
});
