/**
 * `PlaywrightSiteEvidenceBrowser.observe` edge behaviour against a hand-written fake browser: no
 * Chromium process, no module mocks. Each fixture states only the page/context behaviour a test needs.
 */
import { describe, expect, it } from "vitest";
import type { ObservePageRequest } from "../browser-port.js";
import { openPlaywrightSiteEvidenceBrowser, type RenderBrowser, type RenderCookie, type RenderLocator, type RenderResponse, type RequestRouter, type RouteLike } from "../playwright-browser.js";

const request: ObservePageRequest = {
  url: "https://example.com/", originBaseUrl: "https://example.com", collectAccessibility: false, timeoutMs: 2_000,
  maxTextExcerptChars: 100, maxCookies: 5, maxRequests: 5, maxAccessibilityNodesPerCategory: 2, maxContrastSamples: 2,
};
const structure = { title: "Fixture", lang: "en", textExcerpt: "hello", textTruncated: false, accessibility: { landmarks: [], headings: [], images: [], formControls: [], contrastSamples: [], truncated: [] } };
const cookie = (overrides: Partial<RenderCookie> = {}): RenderCookie => ({ name: "pref", value: "v", domain: ".example.com", path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax", ...overrides });
const ok = (url = request.url, headers?: Record<string, string>): RenderResponse => ({ status: () => 200, url: () => url, ...(headers ? { headers: () => headers } : {}) });

interface FakeOptions {
  response?: RenderResponse | null;
  cookies?: RenderCookie[] | "unsupported";
  locator?: (selector: string) => RenderLocator;
  /** Requests the page issues while loading, in order. */
  pageRequests?: { method: string; url: string }[];
  /** Blocks the event loop this long inside the structure evaluation (a hung page script). */
  stallEvaluateMs?: number;
}

/** Synchronously blocks the event loop, so no timer can fire until it returns. */
function stall(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* busy wait */ }
}

function fakeBrowser(options: FakeOptions = {}): RenderBrowser {
  return {
    close: async () => {},
    newContext: async () => {
      let handler: ((route: RouteLike & { continue?(): Promise<void> }) => Promise<void>) | undefined;
      return {
        route: async (_pattern, routeHandler) => { handler = routeHandler; },
        ...(options.cookies === "unsupported" ? {} : { cookies: async () => (options.cookies === "unsupported" ? [] : options.cookies ?? []) }),
        close: async () => {},
        newPage: async () => ({
          goto: async () => {
            for (const { method, url } of options.pageRequests ?? []) {
              await handler!({
                request: () => ({ method: () => method, url: () => url, resourceType: () => "fetch", headers: () => ({}), isNavigationRequest: () => false, frame: () => ({ parentFrame: () => null }) }),
                abort: async () => {}, fulfill: async () => {}, continue: async () => {},
              });
            }
            return options.response === undefined ? ok() : options.response;
          },
          evaluate: async () => { if (options.stallEvaluateMs) stall(options.stallEvaluateMs); return structure; },
          waitForTimeout: async () => {},
          title: async () => "Fixture",
          ...(options.locator ? { locator: options.locator } : {}),
        }),
      };
    },
  };
}

async function observe(options: FakeOptions, extra: { consentAcceptSelector?: string; request?: Partial<ObservePageRequest>; routerFactory?: () => RequestRouter } = {}) {
  const opened = await openPlaywrightSiteEvidenceBrowser({}, {
    moduleLoader: { load: async () => ({ chromium: { launch: async () => fakeBrowser(options) } }) },
    ...(extra.routerFactory ? { routerFactory: extra.routerFactory } : {}),
  });
  if (!opened.available) throw new Error(opened.reason);
  return opened.browser.observe({ ...request, ...extra.request }, extra.consentAcceptSelector === undefined ? {} : { consentAcceptSelector: extra.consentAcceptSelector });
}

const locatorCounting = (count: () => Promise<number>, click: () => Promise<void> = async () => {}): (() => RenderLocator) => () => {
  const locator: RenderLocator = { first: () => locator, count, click };
  return locator;
};

describe("observe — failures that are evidence, not exceptions", () => {
  it("reports a navigation with no HTTP response", async () => {
    expect(await observe({ response: null })).toEqual({ ok: false, reason: "the browser produced no response for this navigation (no HTTP exchange to observe)" });
  });

  it("reports a context that cannot read cookies as a failed capture", async () => {
    expect(await observe({ cookies: "unsupported" })).toEqual({ ok: false, reason: "page capture failed after load or navigation: Browser cannot observe cookies" });
  });
});

describe("observe — document and cookie evidence", () => {
  it("records no headers when the response exposes none, and reports a trailing-slash difference as no redirect", async () => {
    const result = await observe({ response: ok("https://example.com/pricing/") }, { request: { url: "https://example.com/pricing" } });
    if (!result.ok) throw new Error(result.reason);
    expect(result.observation.document.headers).toEqual([]);
    expect(result.observation.document.redirected).toBe(false);
  });

  it("reports a genuinely different final URL as a redirect and lists response headers", async () => {
    const result = await observe({ response: ok("https://example.com/landing", { "content-type": "text/html" }) });
    if (!result.ok) throw new Error(result.reason);
    expect(result.observation.document.redirected).toBe(true);
    expect(result.observation.document.headers).toEqual([{ name: "content-type", value: "text/html" }]);
  });

  it("caps the cookie list with a note and converts a positive expiry to ISO time", async () => {
    const cookies = [cookie({ name: "a", expires: 1_800_000_000 }), cookie({ name: "b" }), cookie({ name: "c" })];
    const capped = await observe({ cookies }, { request: { maxCookies: 2 } });
    if (!capped.ok) throw new Error(capped.reason);
    expect(capped.observation.cookies.map(c => [c.name, c.expiresAt, c.firstParty])).toEqual([["a", "2027-01-15T08:00:00.000Z", true], ["b", null, true]]);
    expect(capped.observation.notes).toContain("cookie list truncated at the 2-cookie cap (3 were present)");
  });

  // An unparseable origin fails closed at the navigation check, before any request or cookie is
  // recorded — which is what lets the first-party comparison parse the origin without a guard.
  it("refuses an unparseable origin at the navigation check, before any evidence is recorded", async () => {
    const result = await observe({ pageRequests: [{ method: "GET", url: "https://example.com/a.js" }] }, { request: { originBaseUrl: "not a url" } });
    expect(result).toEqual({ ok: false, offOriginUrl: "https://example.com", reason: "page capture failed after load or navigation: Off-origin navigation refused: https://example.com is outside the rendered site's origin" });
  });
});

describe("observe — request evidence", () => {
  it("keeps the earliest requests at the cap and cites unparseable request URLs explicitly", async () => {
    const result = await observe({ pageRequests: [{ method: "get", url: "not a url" }, { method: "GET", url: "https://cdn.example.net/a.js" }, { method: "GET", url: "https://example.com/late" }] }, { request: { maxRequests: 2 } });
    if (!result.ok) throw new Error(result.reason);
    expect(result.observation.requests).toEqual([
      { method: "GET", host: "(unparseable)", pathname: "(unparseable)", resourceType: "fetch", firstParty: false, phase: "before" },
      { method: "GET", host: "cdn.example.net", pathname: "/a.js", resourceType: "fetch", firstParty: false, phase: "before" },
    ]);
  });

  it("records a router refusal against the request it refused, and ignores a refusal of a request dropped at the cap", async () => {
    const routerFactory = (): RequestRouter => ({
      handle: async route => { await route.abort("blockedbyclient"); },
      report: () => ({ fulfilled: 0, blocked: 0, navigationRefused: false, bytes: 0 }),
      takeNavigationRedirect: () => undefined,
    });
    const result = await observe({ pageRequests: [{ method: "GET", url: "https://tracker.example.org/p" }, { method: "GET", url: "https://tracker.example.org/q" }] }, { request: { maxRequests: 1 }, routerFactory });
    if (!result.ok) throw new Error(result.reason);
    expect(result.observation.requests).toEqual([{
      method: "GET", host: "tracker.example.org", pathname: "/p", resourceType: "fetch", firstParty: false, phase: "before",
      blockedReason: "aborted by the guarded browser request router (unsafe target, unsupported request or resource cap)",
    }]);
  });
});

describe("observe — consent click", () => {
  it("clicks the first match, marks later cookies 'after' and says so in the notes", async () => {
    const clicks: string[] = [];
    const result = await observe({ cookies: [cookie()], locator: locatorCounting(async () => 2, async () => { clicks.push("click"); }) }, { consentAcceptSelector: "#accept" });
    if (!result.ok) throw new Error(result.reason);
    expect(clicks).toEqual(["click"]);
    expect(result.observation.cookies[0]?.phase).toBe("after");
    expect(result.observation.notes).toEqual(["consent selector '#accept' matched 2 element(s); the first was clicked. Cookies and requests observed after that point are marked phase 'after'."]);
  });

  it("notes a selector that matches nothing and keeps the observation pre-consent", async () => {
    const result = await observe({ cookies: [cookie()], locator: locatorCounting(async () => 0) }, { consentAcceptSelector: "#accept" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.observation.cookies[0]?.phase).toBe("before");
    expect(result.observation.notes[0]).toMatch(/^consent selector '#accept' matched no element on this page — no consent interaction was performed/);
  });

  it("notes a click that fails with a non-Error value, marking the post-consent evidence incomplete", async () => {
    const result = await observe({ locator: locatorCounting(async () => 1, async () => { throw "element detached"; }) }, { consentAcceptSelector: "#accept" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.observation.notes[0]).toMatch(/matched 1 element\(s\) but the click did not complete: element detached\. Post-consent evidence below is incomplete/);
  });

  // A synchronous stall past the deadline leaves the budget expired before the next step starts, so
  // the consent step's own budget check (not the page-level timer) is what ends the capture.
  it("ends the capture with a timeout when the budget is already spent as the consent count starts", async () => {
    const clicks: string[] = [];
    const result = await observe({ stallEvaluateMs: 80, locator: locatorCounting(async () => 1, async () => { clicks.push("click"); }) }, { consentAcceptSelector: "#accept", request: { timeoutMs: 40 } });
    expect(result).toEqual({ ok: false, reason: "page capture failed after load or navigation: page work timed out after 40ms" });
    expect(clicks).toEqual([]);
  });

  it("ends the capture with a timeout when the budget is spent between counting and clicking", async () => {
    const clicks: string[] = [];
    const result = await observe({ locator: locatorCounting(async () => { stall(80); return 1; }, async () => { clicks.push("click"); }) }, { consentAcceptSelector: "#accept", request: { timeoutMs: 40 } });
    expect(result).toEqual({ ok: false, reason: "page capture failed after load or navigation: page work timed out after 40ms" });
    expect(clicks).toEqual([]);
  });

  it("ends the capture when counting matches exhausts the page budget, instead of noting a bad selector", async () => {
    const result = await observe({ locator: locatorCounting(() => new Promise<number>(() => {})) }, { consentAcceptSelector: "#accept", request: { timeoutMs: 150 } });
    expect(result).toEqual({ ok: false, reason: "page capture failed after load or navigation: page work timed out after 150ms" });
  });

  it("ends the capture when the click exhausts the page budget", async () => {
    const result = await observe({ locator: locatorCounting(async () => 1, () => new Promise<void>(() => {})) }, { consentAcceptSelector: "#accept", request: { timeoutMs: 150 } });
    expect(result).toEqual({ ok: false, reason: "page capture failed after load or navigation: page work timed out after 150ms" });
  });
});
