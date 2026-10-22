/** rendr: shared browser lifecycle with injected browser/transport fakes; no module mocks. */
import { test, expect } from "vitest";
import type { HttpClientPort, HttpRequest } from "@jini-ai/core/primitives";
import { renderPage, COOKIE_DISMISS_SELECTORS, type RenderBrowser, type RenderPage } from "../render-page.js";
import { createRequestRouter, fetchOwnSiteResource, type RouteLike } from "../request-guard.js";
import { renderPublicPage, createJsonCapture, publicPageExpression } from "../public-page.js";
import { openPlaywrightSiteEvidenceBrowser } from "../playwright-browser.js";
import { collectPageEvidence } from "../collect-page-evidence.js";
import { PageWorkBudget } from "../page-work-budget.js";

function browserFixture({ targets = ["https://public.example/"], hangSelector = false, offsite = false, dataMethod = "GET", documentMethod = "GET", childFrame = false } = {}) {
  const events: string[] = [];
  const contexts: Array<Record<string, unknown> | undefined> = [];
  const requests: Array<{ url: string; fulfilled: boolean; aborted: boolean }> = [];
  let handler: ((route: RouteLike & { continue?(): Promise<void> }) => Promise<void>) | undefined;
  let current = "https://public.example/";
  let availableBanner = true;
  const page: RenderPage = {
    goto: async (url, options) => {
      events.push(`goto:${options.waitUntil}`); current = url;
      for (const target of offsite ? ["https://other.example/landing?token=secret"] : targets) {
        const state = { url: target, fulfilled: false, aborted: false };
        requests.push(state);
        await handler!({ request: () => ({
          url: () => target, method: () => target.includes("data") ? dataMethod : documentMethod,
          headers: () => ({ cookie: "OWNER", authorization: "OWNER", "content-type": "application/json" }),
          postData: () => { events.push("request-body-read"); return '{"query":"rows"}'; },
          resourceType: () => target.includes("data") ? "fetch" : "document", isNavigationRequest: () => !target.includes("data"), frame: () => ({ parentFrame: () => childFrame ? {} : null }),
        }), abort: async () => { state.aborted = true; }, fulfill: async () => { state.fulfilled = true; }, continue: async () => { state.fulfilled = true; } });
        if (offsite && state.aborted) throw new Error("blocked navigation");
      }
      return { status: () => 200, url: () => current, headers: () => ({}) };
    },
    url: () => current, title: async () => "Rendered",
    locator: selector => {
      const locator = { first: () => locator, count: async () => selector === COOKIE_DISMISS_SELECTORS[0] && availableBanner ? 1 : 0,
        isVisible: async () => true, click: async () => { availableBanner = false; events.push("dismiss"); } };
      return locator;
    },
    waitForTimeout: async ms => { events.push(`settle:${ms}`); },
    waitForSelector: async selector => { events.push(`selector:${selector}`); if (hangSelector) await new Promise(() => {}); },
    evaluate: async () => { events.push("extract"); return { title: "Rendered", html: "<h1>Rendered</h1>", text: "Rendered", images: [], imagesTruncated: false, truncated: false }; },
    screenshot: async options => { events.push(`screenshot:${options.type}`); return Buffer.from(options.type); },
  };
  const browser: RenderBrowser = {
    newContext: async options => { contexts.push(options); return {
      newPage: async () => page,
      route: async (_pattern, routeHandler) => { handler = routeHandler; },
      routeWebSocket: async () => { events.push("websockets-blocked"); },
      cookies: async () => [], close: async () => { events.push("context-close"); },
    }; },
    close: async () => { events.push("browser-close"); },
  };
  return { browser, page, events, contexts, requests };
}

function guardedFixture() {
  const sent: string[] = [];
  const httpClient: HttpClientPort = { send: async ({ request }) => {
    sent.push(request.url);
    expect(request.headers.cookie).toBeUndefined(); expect(request.headers.authorization).toBeUndefined();
    if (/127\.0\.0\.1|10\.0\.0\.1|169\.254\.169\.254|\[::1\]/.test(request.url)) {
      const error = new Error("private DNS peer details"); error.name = "EgressRefusedError"; throw error;
    }
    return { status: 200, headers: { "content-type": request.url.includes("data") ? "application/json" : "text/html" }, bodyText: request.url.includes("data") ? '{"rows":[1,2]}' : "<p>Rendered</p>" };
  } };
  return { httpClient, sent };
}

test("shared render defaults to same-origin, DOM content loaded and short settle with a fresh context", async () => {
  const fake = browserFixture();
  for (let n = 0; n < 2; n++) await renderPage({ browser: fake.browser, url: "https://public.example/", consume: async ({ finalUrl }) => finalUrl });
  expect(fake.contexts).toHaveLength(2);
  expect(fake.contexts[0]).toMatchObject({ serviceWorkers: "block", acceptDownloads: false, ignoreHTTPSErrors: false });
  expect(fake.contexts[0]).not.toHaveProperty("storageState");
  expect(fake.events.filter(e => e.startsWith("goto:"))).toEqual(["goto:domcontentloaded", "goto:domcontentloaded"]);
  expect(fake.events.filter(e => e.startsWith("settle:"))).toEqual(["settle:1200", "settle:1200"]);
  expect(fake.events.filter(e => e === "context-close")).toHaveLength(2);
});

test("cookie dismissal precedes selector waiting and extraction; opt-out preserves the banner", async () => {
  const fake = browserFixture();
  await renderPage({ browser: fake.browser, url: "https://public.example/", consume: async ({ page }) => page.evaluate("capture") }, { waitFor: "#loaded", dismissCookieBanners: true });
  expect(fake.events.filter(e => ["dismiss", "selector:#loaded", "extract"].includes(e))).toEqual(["dismiss", "selector:#loaded", "extract"]);
  const untouched = browserFixture();
  await renderPage({ browser: untouched.browser, url: "https://public.example/", consume: async () => "ok" }, { waitFor: 0.5, dismissCookieBanners: false });
  expect(untouched.events).not.toContain("dismiss"); expect(untouched.events).toContain("settle:500");
});

test("the public browser route aborts literal private and metadata targets via the guarded transport", async () => {
  const targets = ["https://public.example/", "http://127.0.0.1/data", "http://10.0.0.1/data", "http://169.254.169.254/data", "http://[::1]/data"];
  const fake = browserFixture({ targets }); const guard = guardedFixture();
  const observations: Array<{ url: string; blocked: boolean }> = [];
  const router = createRequestRouter({ httpClient: guard.httpClient, ownSiteFetch: fetchOwnSiteResource, allowedOrigins: [], signal: new AbortController().signal });
  await renderPage({ browser: fake.browser, url: targets[0]!, consume: async () => "safe" }, { originPolicy: "public", router, waitFor: 0,
    onRequest: ({ route, blocked }) => {
      const observed = { url: route.request().url(), blocked }; observations.push(observed);
      return () => { observed.blocked = true; };
    },
  });
  expect(observations.map(o => o.blocked)).toEqual([false, true, true, true, true]);
  expect(guard.sent).toEqual(targets);
  expect(fake.requests.map(r => [r.fulfilled, r.aborted])).toEqual([[true, false], ...targets.slice(1).map(() => [false, true])]);
  expect(router.report().blocked).toBe(4);
  expect(fake.events).toContain("context-close");
});

test("public rendering requires a pinned guard and selector timeout closes the context", async () => {
  const fake = browserFixture({ hangSelector: true });
  await expect(renderPage({ browser: fake.browser, url: "https://public.example/", consume: async () => "no" }, { originPolicy: "public" })).rejects.toThrow("guarded request router");
  expect(fake.contexts).toHaveLength(0);
  await expect(renderPage({ browser: fake.browser, url: "https://public.example/", consume: async () => "no" }, { waitFor: "#never", timeoutMs: 10 })).rejects.toThrow("timed out");
  expect(fake.events).toContain("context-close");
});

test("public-page adapter captures JSON and a screenshot then releases context AND browser", async () => {
  const fake = browserFixture({ targets: ["https://public.example/", "https://data-provider.example/data"] });
  const guard = guardedFixture(); const launches: unknown[] = [];
  const result = await renderPublicPage({ input: { url: "https://public.example/", maxChars: 100, screenshot: true, waitFor: "#loaded" }, httpClient: guard.httpClient }, {
    moduleLoader: { load: async () => ({ chromium: { launch: async options => { launches.push(options); return fake.browser; } } }) },
  });
  expect(result.text).toBe("Rendered"); expect(result.finalUrl).toBe("https://public.example/");
  expect(result.data).toEqual([{ url: "https://data-provider.example/data", status: 200, body: '{"rows":[1,2]}', truncated: false }]);
  expect(result.screenshot).toEqual({ mimeType: "image/jpeg", data: Buffer.from("jpeg").toString("base64") });
  expect(fake.events).toContain("screenshot:jpeg");
  expect(launches[0]).toMatchObject({ chromiumSandbox: true, args: expect.arrayContaining(["--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>"]) });
  expect(fake.events.slice(-2)).toEqual(["context-close", "browser-close"]);
});

test("JSON capture reports per-body, aggregate, count and transport truncation; ignores unrelated resources", () => {
  const capture = createJsonCapture({}, { maxResponses: 2, perBodyChars: 5, totalChars: 7 });
  const record = (url: string, body: string, resourceType = "fetch", contentType = "application/json", truncated = false) => capture.record({ url, resourceType, resource: { status: 200, headers: { "Content-Type": contentType }, body: Buffer.from(body), truncated } });
  record("script", "ignored", "script"); record("html", "ignored", "xhr", "text/html");
  record("a", "123456", "xhr"); record("b", "abcd"); record("c", "omitted");
  expect(capture.result()).toEqual({ data: [{ url: "a", status: 200, body: "12345", truncated: true }], dataTruncated: true });
  const transport = createJsonCapture({}); transport.record({ url: "https://a.example/data", resourceType: "fetch", resource: { status: 206, headers: { "content-type": "application/problem+json" }, body: Buffer.from("{}"), truncated: true } });
  expect(transport.result().data[0]?.truncated).toBe(true);
  const count = createJsonCapture({}, { maxResponses: 1 });
  for (const url of ["first", "second"]) count.record({ url, resourceType: "fetch", resource: { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}"), truncated: false } });
  expect(count.result().data).toHaveLength(1); expect(count.result().dataTruncated).toBe(true);
});

test("site evidence retains same-origin default and off-origin-redirect skip classification", async () => {
  const fake = browserFixture({ offsite: true });
  const result = await collectPageEvidence({ workspaceId: "ws", paths: ["/"],
    originRegistry: { canonicalOrigin: async () => ({ scheme: "https", host: "public.example", source: "config", verifiedAt: "2026-10-09" }) },
    observationPolicy: { redactObservation: ({ observation }) => observation, redactMessage: ({ message }) => message },
    openBrowser: () => openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) } }),
  });
  expect(result.pages).toEqual([]); expect(result.skipped[0]?.reason).toBe("off-origin-redirect");
  expect(JSON.stringify(result)).not.toContain("token=secret");
  expect(fake.requests[0]?.aborted).toBe(true); expect(fake.events).not.toContain("extract"); expect(fake.events).not.toContain("dismiss");
  expect(fake.events.slice(-2)).toEqual(["context-close", "browser-close"]);
});

test("cancellation interrupts a budgeted operation that ignores AbortSignal", async () => {
  const abort = new AbortController(); const budget = new PageWorkBudget({ timeoutMs: 1000 }, { signal: abort.signal });
  const pending = budget.run({ work: () => new Promise(() => {}) });
  abort.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
});

test("captureData and screenshot opt-outs omit data and images while a failed extraction still closes both resources", async () => {
  const fake = browserFixture({ targets: ["https://public.example/", "https://provider.example/data"] });
  const load = { load: async () => ({ chromium: { launch: async () => fake.browser } }) };
  const input = { url: "https://public.example/", maxChars: 100, waitFor: 0, captureData: false, dismissCookieBanners: false };
  const result = await renderPublicPage({ input, httpClient: guardedFixture().httpClient }, { moduleLoader: load });
  expect(result.data).toEqual([]); expect(result.dataTruncated).toBe(false); expect(result.screenshot).toBeUndefined();
  expect(fake.events).not.toContain("dismiss");
  const failing = browserFixture(); failing.page.evaluate = async () => { throw new Error("renderer crashed"); };
  await expect(renderPublicPage({ input, httpClient: guardedFixture().httpClient }, { moduleLoader: { load: async () => ({ chromium: { launch: async () => failing.browser } }) } })).rejects.toThrow("renderer crashed");
  expect(failing.events.slice(-2)).toEqual(["context-close", "browser-close"]);
});

test("evidence retains third-party response cookies in its fresh context without sending owner credentials", async () => {
  const forwarded: Array<{ url: string; cookie: string | undefined }> = []; const fulfilled: Record<string, string>[] = [];
  const router = createRequestRouter({
    httpClient: { send: async ({ request }) => { forwarded.push({ url: request.url, cookie: request.headers.cookie }); return { status: 200, headers: { "set-cookie": "public-secret=blocked" }, bodyText: "ok" }; } },
    ownSiteFetch: async ({ url, headers }) => { forwarded.push({ url, cookie: headers.cookie }); return { status: 200, headers: { "set-cookie": "visitor=ephemeral" }, body: Buffer.from("ok"), truncated: false }; },
    allowedOrigins: ["https://site.example"], signal: new AbortController().signal,
  }, { preserveOwnSiteCookies: true });
  for (const url of ["https://site.example/", "https://public.example/"]) await router.handle({
    request: () => ({ url: () => url, method: () => "GET", headers: () => ({ cookie: "visitor=ephemeral", authorization: "never-forward" }), resourceType: () => "fetch", isNavigationRequest: () => false, frame: () => ({ parentFrame: () => null }) }),
    fulfill: async ({ headers }) => { fulfilled.push(headers); }, abort: async () => { throw new Error("not expected"); },
  });
  expect(forwarded).toEqual([{ url: "https://site.example/", cookie: "visitor=ephemeral" }, { url: "https://public.example/", cookie: undefined }]);
  expect(fulfilled[0]?.["set-cookie"]).toBe("visitor=ephemeral"); expect(fulfilled[1]?.["set-cookie"]).toBe("public-secret=blocked");
});

test("shared context never imports saved owner storage or credentials and rejects non-http navigation", async () => {
  const fake = browserFixture();
  await renderPage({ browser: fake.browser, url: "https://public.example/", consume: async () => "ok" }, {
    waitFor: 0, contextOptions: { storageState: "/owner/profile.json", httpCredentials: { username: "owner", password: "secret" }, viewport: { width: 400, height: 300 } },
  });
  expect(fake.contexts[0]).toEqual({ viewport: { width: 400, height: 300 }, serviceWorkers: "block", acceptDownloads: false, ignoreHTTPSErrors: false });
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "https://owner:secret@public.example/"]) {
    await expect(renderPage({ browser: fake.browser, url, consume: async () => "never" })).rejects.toThrow("anonymous http(s)");
  }
  expect(fake.contexts).toHaveLength(1);
});

test("small render windows bound captured JSON too, and oversized screenshots are omitted with a truncation flag", async () => {
  const fake = browserFixture({ targets: ["https://public.example/", "https://provider.example/data"] });
  fake.page.screenshot = async () => Buffer.alloc(2 * 1024 * 1024 + 1);
  const result = await renderPublicPage({ input: { url: "https://public.example/", maxChars: 4, waitFor: 0, screenshot: true }, httpClient: guardedFixture().httpClient }, { moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) } });
  expect(result.data).toEqual([]); expect(result.dataTruncated).toBe(true);
  expect(result.screenshot).toBeUndefined(); expect(result.truncated).toBe(true);
  expect(fake.events.slice(-2)).toEqual(["context-close", "browser-close"]);
});

test("a final URL beyond the returned URL cap is bounded and marked truncated", async () => {
  const fake = browserFixture(); fake.page.url = () => `https://public.example/${'p'.repeat(2200)}`;
  const result = await renderPublicPage({ input: { url: "https://public.example/", maxChars: 100, waitFor: 0 }, httpClient: guardedFixture().httpClient }, { moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) } });
  expect(result.finalUrl).toHaveLength(2048); expect(result.truncated).toBe(true);
});

test("cancellation never skips close and stops waiting for a stalled release", async () => {
  const abort = new AbortController(); const budget = new PageWorkBudget({ timeoutMs: 1000 }, { signal: abort.signal });
  let closed = 0;
  const releasing = budget.release({ close: () => { closed++; return new Promise<void>(() => {}); } });
  abort.abort(new Error("cancelled"));
  await expect(releasing).resolves.toBeUndefined(); expect(closed).toBe(1);
});

test("public rendering reports an absent browser as a stable capability failure", async () => {
  await expect(renderPublicPage({ input: { url: "https://public.example/", maxChars: 100 }, httpClient: guardedFixture().httpClient }, {
    moduleLoader: { load: async () => { throw new Error("module path with private environment details"); } },
  })).rejects.toMatchObject({ code: "WEB_RENDER_UNAVAILABLE", message: "Headless browser is unavailable in this deployment" });
});

test("a cookie banner that hydrates during the settle is dismissed before extracting text", async () => {
  const fake = browserFixture(); let hydrated = false;
  fake.page.locator = () => {
    const locator = { first: () => locator, count: async () => hydrated ? 1 : 0, isVisible: async () => true,
      click: async () => { hydrated = false; fake.events.push("late-dismiss"); } };
    return locator;
  };
  fake.page.waitForTimeout = async ms => { fake.events.push(`settle:${ms}`); if (ms === 1200) hydrated = true; };
  await renderPage({ browser: fake.browser, url: "https://public.example/", consume: async ({ page }) => page.evaluate("capture") }, { dismissCookieBanners: true });
  expect(fake.events.filter(e => e.startsWith("settle:") || e === "late-dismiss" || e === "extract")).toEqual(["settle:1200", "late-dismiss", "settle:200", "extract"]);
});

test("the public deadline includes launching and closes a browser that appears after timeout", async () => {
  const fake = browserFixture(); let finishLaunch!: (browser: RenderBrowser) => void;
  const launch = new Promise<RenderBrowser>(resolve => { finishLaunch = resolve; });
  const pending = renderPublicPage({ input: { url: "https://public.example/", maxChars: 100, waitFor: 0 }, httpClient: guardedFixture().httpClient }, { timeoutMs: 10, moduleLoader: { load: async () => ({ chromium: { launch: () => launch } }) } });
  const failure = await pending.then(() => { throw new Error("unexpected render"); }, error => error);
  expect(failure).toBeInstanceOf(Error); expect(fake.contexts).toHaveLength(0);
  finishLaunch(fake.browser);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(fake.events).toEqual(["browser-close"]);
});


test.each(["POST", "PUT", "PATCH"])("public render forwards a bounded %s data body through the guarded client and captures its answer", async dataMethod => {
  const fake = browserFixture({ targets: ["https://public.example/", "https://provider.example/data"], dataMethod });
  const guard = guardedFixture(); const requests: HttpRequest[] = [];
  const result = await renderPublicPage({ input: { url: "https://public.example/", maxChars: 1000, waitFor: 0 }, httpClient: {
    send: async required => { requests.push(required.request); return guard.httpClient.send(required); },
  } }, { moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) } });
  expect(requests[1]).toMatchObject({ method: dataMethod, body: '{"query":"rows"}', headers: { "content-type": "application/json" } });
  expect(result.data).toEqual([{ url: "https://provider.example/data", status: 200, body: '{"rows":[1,2]}', truncated: false }]);
  expect(result.blockedDataRequests).toEqual({}); expect(result.dataTruncated).toBe(false);
  expect(JSON.stringify(result)).not.toContain('"query"');
});

test("a refused POST data target is counted by reason and marks data incomplete even when captureData is off", async () => {
  for (const captureData of [true, false]) {
    const fake = browserFixture({ targets: ["https://public.example/", "http://10.0.0.1/data"], dataMethod: "POST" });
    const guard = guardedFixture();
    const result = await renderPublicPage({ input: { url: "https://public.example/", maxChars: 1000, waitFor: 0, captureData }, httpClient: guard.httpClient }, {
      moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) },
    });
    expect(guard.sent).toContain("http://10.0.0.1/data");
    expect(fake.requests[1]).toMatchObject({ fulfilled: false, aborted: true });
    expect(result.data).toEqual([]); expect(result.dataTruncated).toBe(true); expect(result.blockedDataRequests).toEqual({ refused: 1 });
  }
});

test("document/form POSTs and beacons stay blocked; evidence and screenshot routers stay GET/HEAD only", async () => {
  for (const allowDataRequests of [false, true]) {
    const guard = guardedFixture(); const blocked: string[] = [];
    const router = createRequestRouter({ httpClient: guard.httpClient, ownSiteFetch: fetchOwnSiteResource, allowedOrigins: [], signal: new AbortController().signal }, {
      allowDataRequests, onBlocked: ({ reason }) => { blocked.push(reason); },
    });
    for (const resourceType of ["document", "ping", ...(allowDataRequests ? [] : ["xhr", "fetch"])]) {
      let aborted = false;
      await router.handle({ request: () => ({ url: () => "https://public.example/data", method: () => "POST", headers: () => ({}), resourceType: () => resourceType,
        isNavigationRequest: () => resourceType === "document", frame: () => ({ parentFrame: () => null }),
        postData: () => { throw new Error("a forbidden request body must never be read"); },
      }), abort: async () => { aborted = true; }, fulfill: async () => { throw new Error("a forbidden request must not be fulfilled"); } });
      expect(aborted).toBe(true);
    }
    expect(guard.sent).toEqual([]); expect(blocked.every(reason => reason === "method")).toBe(true);
  }
});

test("oversized data POSTs are refused whole and counted against the data output", async () => {
  const guard = guardedFixture(); const capture = createJsonCapture({}); const blocked: string[] = [];
  const router = createRequestRouter({ httpClient: guard.httpClient, ownSiteFetch: fetchOwnSiteResource, allowedOrigins: [], signal: new AbortController().signal }, {
    allowDataRequests: true, maxRequestBodyBytes: 3, onBlocked: input => { blocked.push(input.reason); capture.markTruncated(input); },
  });
  await router.handle({ request: () => ({ url: () => "https://public.example/data", method: () => "POST", headers: () => ({}), resourceType: () => "xhr",
    postData: () => "éé", isNavigationRequest: () => false, frame: () => ({ parentFrame: () => null }),
  }), abort: async () => {}, fulfill: async () => { throw new Error("oversized body sent"); } });
  expect(guard.sent).toEqual([]); expect(blocked).toEqual(["budget"]); expect(capture.result().dataTruncated).toBe(true);
});

test("own-site fetch preserves every Set-Cookie including Expires commas as separate lines", async () => {
  const cookies = ["one=1; Expires=Wed, 01 Oct 2030 00:00:00 GMT", "two=2; HttpOnly"];
  const headers = new Headers(); cookies.forEach(value => headers.append("set-cookie", value));
  const result = await fetchOwnSiteResource({ url: "https://site.example/", method: "GET", headers: {} }, {
    signal: new AbortController().signal, maxBytes: 100,
    fetch: async (_url, options) => { expect(options?.redirect).toBe("manual"); return new Response("ok", { headers }); },
  });
  expect(result.headers["set-cookie"]).toBe(cookies.join("\n")); expect(result.body.toString()).toBe("ok");
});

test.each([
  { maxBytes: 0, expected: "", pulls: 1, truncated: true },
  { maxBytes: 4, expected: "ab", pulls: 2, truncated: true },
  { maxBytes: 5, expected: "abcde", pulls: 3, truncated: true },
  { maxBytes: 6, expected: "abcdef", pulls: 4, truncated: false },
])("own-site fetch reads only whole chunks within $maxBytes bytes and releases its reader", async ({ maxBytes, expected, pulls, truncated }) => {
  const chunks = ["ab", "cde", "f"];
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulled++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  // Reader-based streams do not need async iteration.
  Object.defineProperty(body, Symbol.asyncIterator, { value: undefined });
  const result = await fetchOwnSiteResource({ url: "https://site.example/", method: "GET", headers: {} }, {
    signal: new AbortController().signal, maxBytes, fetch: async () => new Response(body),
  });
  expect(result.body.toString()).toBe(expected);
  expect(result.truncated).toBe(truncated);
  expect(pulled).toBe(pulls);
  expect(cancelled).toBe(truncated);
  expect(body.locked).toBe(false);
});

test("own-site fetch propagates a body read failure and releases its reader", async () => {
  const failure = new Error("body read failed");
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(failure); } }, { highWaterMark: 0 });
  await expect(fetchOwnSiteResource({ url: "https://site.example/", method: "GET", headers: {} }, {
    signal: new AbortController().signal, maxBytes: 100, fetch: async () => new Response(body),
  })).rejects.toBe(failure);
  expect(body.locked).toBe(false);
});

test("own-site fetch returns an empty untruncated body when there is no response stream", async () => {
  const result = await fetchOwnSiteResource({ url: "https://site.example/", method: "HEAD", headers: {} }, {
    signal: new AbortController().signal, maxBytes: 0, fetch: async () => new Response(null),
  });
  expect(result.body.length).toBe(0); expect(result.truncated).toBe(false);
});

test("guarded evidence cookies preserve separate transport cookie lines; public render strips them", async () => {
  for (const preserveOwnSiteCookies of [true, false]) {
    let fulfilled: Record<string, string> = {};
    const router = createRequestRouter({ httpClient: { send: async () => ({ status: 200, headers: { "set-cookie": "wrongly-combined" },
      setCookies: ["tracker=1; Expires=Wed, 01 Oct 2030 00:00:00 GMT", "second=2"], bodyText: "ok" }) },
      ownSiteFetch: fetchOwnSiteResource, allowedOrigins: [], signal: new AbortController().signal,
    }, { preserveOwnSiteCookies });
    await router.handle({ request: () => ({ url: () => "https://tracker.example/", method: () => "GET", headers: () => ({}), resourceType: () => "script", isNavigationRequest: () => false, frame: () => ({ parentFrame: () => null }) }),
      abort: async () => { throw new Error("not expected"); }, fulfill: async ({ headers }) => { fulfilled = headers; },
    });
    expect(fulfilled["set-cookie"]).toBe(preserveOwnSiteCookies ? "tracker=1; Expires=Wed, 01 Oct 2030 00:00:00 GMT\nsecond=2" : undefined);
  }
});

const evidenceRequest = { url: "https://public.example/", originBaseUrl: "https://public.example", timeoutMs: 10000,
  maxTextExcerptChars: 100, maxCookies: 10, maxRequests: 10, maxAccessibilityNodesPerCategory: 10, maxContrastSamples: 10, collectAccessibility: false };

test("evidence waits for capped best-effort load before observing tracker cookies", async () => {
  const fake = browserFixture(); let loaded = false;
  fake.page.waitForLoadState = async (state, options) => { expect(state).toBe("load"); expect(options.timeout).toBeLessThanOrEqual(5000); loaded = true; fake.events.push("load"); };
  const newContext = fake.browser.newContext;
  fake.browser.newContext = async options => ({ ...await newContext(options), cookies: async () => loaded ? [{ name: "after-load", value: "never-output", domain: "tracker.example", path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "None" }] : [] });
  const opened = await openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) } });
  if (!opened.available) throw new Error(opened.reason);
  const result = await opened.browser.observe(evidenceRequest); await opened.browser.close({});
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.observation.cookies).toMatchObject([{ name: "after-load", firstParty: false, phase: "before" }]);
  expect(JSON.stringify(result)).not.toContain("never-output");
  expect(fake.events.indexOf("load")).toBeLessThan(fake.events.indexOf("extract"));
});

test("evidence allows off-origin GET iframes and does not confuse their failure with main-frame redirect refusal", async () => {
  const fake = browserFixture({ targets: ["https://iframe.example/embed"], childFrame: true });
  const originalGoto = fake.page.goto;
  fake.page.goto = async (url, options) => { await originalGoto(url, options); throw new Error("navigation timeout"); };
  const opened = await openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) } });
  if (!opened.available) throw new Error(opened.reason);
  const result = await opened.browser.observe(evidenceRequest); await opened.browser.close({});
  expect(fake.requests[0]).toMatchObject({ fulfilled: true, aborted: false });
  expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("navigation timeout") });
  expect(result).not.toHaveProperty("offOriginUrl");
});

test("load wait is best effort and bounded within the shared render deadline", async () => {
  const fake = browserFixture();
  fake.page.waitForLoadState = async (_state, options) => { expect(options.timeout).toBeLessThanOrEqual(100); throw new Error("load timeout"); };
  await expect(renderPage({ browser: fake.browser, url: "https://public.example/", consume: async () => "captured" }, { waitFor: 0, timeoutMs: 100, loadWaitMs: 5000 })).resolves.toBe("captured");
  fake.page.waitForLoadState = async () => new Promise(() => {});
  await expect(renderPage({ browser: fake.browser, url: "https://public.example/", consume: async () => "must not escape deadline" }, { waitFor: 0, timeoutMs: 10, loadWaitMs: 5000 })).rejects.toThrow("timed out");
});

test("the JSON aggregate cap includes all captured URLs", () => {
  const capture = createJsonCapture({}, { perBodyChars: 8000, totalChars: 60000 });
  for (let n = 0; n < 20; n++) capture.record({ url: "https://provider.example/" + "u".repeat(2050), resourceType: "fetch", resource: { status: 200, headers: { "content-type": "application/json" }, body: Buffer.alloc(8000, "x"), truncated: false } });
  const result = capture.result();
  expect(result.data.reduce((count, entry) => count + entry.url.length + entry.body.length, 0)).toBeLessThanOrEqual(60000);
  expect(result.data).toHaveLength(6); expect(result.data[5]?.truncated).toBe(true); expect(result.dataTruncated).toBe(true);
});

test("the evidence adapter stays GET-only even with a public-data-capable injected router", async () => {
  const fake = browserFixture({ targets: ["https://public.example/", "https://public.example/data"], dataMethod: "POST" });
  const guard = guardedFixture();
  const opened = await openPlaywrightSiteEvidenceBrowser({}, {
    moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) },
    routerFactory: ({ signal }) => createRequestRouter({ httpClient: guard.httpClient, ownSiteFetch: fetchOwnSiteResource, allowedOrigins: [], signal }, { allowDataRequests: true }),
  });
  if (!opened.available) throw new Error(opened.reason);
  const result = await opened.browser.observe(evidenceRequest); await opened.browser.close({});
  expect(guard.sent).toEqual(["https://public.example/"]);
  expect(fake.requests[1]).toMatchObject({ aborted: true, fulfilled: false });
  expect(fake.events).not.toContain("request-body-read");
  if (!result.ok) throw new Error(result.reason);
  expect(result.observation.requests[1]).toMatchObject({ method: "POST", blockedReason: expect.stringContaining("never sends a non-GET") });
});

test.each([303, 307])("data redirect %s is routed again with HTTP method/body semantics", async status => {
  const sent: HttpRequest[] = []; let fulfilled = false;
  const router = createRequestRouter({ httpClient: { send: async ({ request }) => {
    sent.push(request);
    return sent.length === 1 ? { status, headers: { location: "https://other.example/data" }, bodyText: "" } : { status: 200, headers: {}, bodyText: "ok" };
  } }, ownSiteFetch: fetchOwnSiteResource, allowedOrigins: [], signal: new AbortController().signal }, { allowDataRequests: true, maxRequestBodyBytes: 3 });
  await router.handle({ request: () => ({ url: () => "https://public.example/data", method: () => "POST", headers: () => ({ "content-type": "application/json" }),
    postData: () => "éx", resourceType: () => "fetch", isNavigationRequest: () => false, frame: () => ({ parentFrame: () => null }),
  }), fulfill: async () => { fulfilled = true; }, abort: async () => { throw new Error("not expected"); } });
  expect(sent.map(request => [request.url, request.method, request.body])).toEqual([
    ["https://public.example/data", "POST", "éx"], ["https://other.example/data", status === 303 ? "GET" : "POST", status === 303 ? undefined : "éx"],
  ]);
  expect(fulfilled).toBe(true);
});

test("browser availability explains sandbox failures without claiming the binary is definitely absent", async () => {
  const result = await openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => ({ chromium: { launch: async () => { throw new Error("sandbox denied"); } } }) } });
  expect(result.available).toBe(false);
  if (result.available) throw new Error("unexpected browser");
  expect(result.reason).toContain("host may not support the configured sandbox");
  expect(result.reason).not.toContain("browser binary is not installed");
});

test("public render forwards the endpoint filter and textMode through its guarded capture path", async () => {
  const fake = browserFixture({ targets: ["https://public.example/", "https://noise.example/data", "https://cms.example/data/rows"] });
  let expression = "";
  fake.page.evaluate = async script => { expression = script; return { title: "Rendered", html: "<p>Live</p>", text: "", images: [], imagesTruncated: false, truncated: false }; };
  const result = await renderPublicPage({ input: { url: "https://public.example/", maxChars: 1000, waitFor: 0, captureDataMatch: "/data/rows", textMode: "none" }, httpClient: guardedFixture().httpClient }, {
    moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) },
  });
  expect(expression).toBe(publicPageExpression({ maxChars: 1000, textMode: "none" }));
  expect(result.text).toBe("");
  expect(result.data).toEqual([{ url: "https://cms.example/data/rows", status: 200, body: '{"rows":[1,2]}', truncated: false }]);
  expect(result.dataUnmatched).toEqual([{ url: "https://noise.example/data", status: 200, size: 14 }]);
  expect(result.dataTruncated).toBe(false); expect(fake.events.slice(-2)).toEqual(["context-close", "browser-close"]);
});

test("captureData false suppresses bodies and the unmatched inventory even with a filter", async () => {
  const fake = browserFixture({ targets: ["https://public.example/", "https://noise.example/data"] });
  const result = await renderPublicPage({ input: { url: "https://public.example/", maxChars: 1000, waitFor: 0, captureData: false, captureDataMatch: "/rows" }, httpClient: guardedFixture().httpClient }, {
    moduleLoader: { load: async () => ({ chromium: { launch: async () => fake.browser } }) },
  });
  expect(result.data).toEqual([]); expect(result.dataUnmatched).toEqual([]); expect(result.dataTruncated).toBe(false);
});
