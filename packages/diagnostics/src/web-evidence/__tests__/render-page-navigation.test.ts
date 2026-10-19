/** renderPage boundaries: explicit hops, refusals, waits and release, through typed browser/router fakes. */
import { test, expect } from "vitest";
import { renderPage, OffOriginNavigationError, RenderRequestRefused, COOKIE_DISMISS_SELECTORS, type RenderBrowser, type RenderContext, type RenderLocator, type RenderPage } from "../render-page.js";
import { MAX_REDIRECT_HOPS, type RequestRouter, type RouteLike, type RoutedRequest } from "../request-guard.js";
import { PageWorkTimeout } from "../page-work-budget.js";

type RouteHandler = Parameters<RenderContext["route"]>[1];

/** One page in one context; `page` overrides any port method, and every visible effect is logged. */
function fakeBrowser(page: Partial<RenderPage> = {}, { newContext, onClose }: { newContext?: () => Promise<RenderContext>; onClose?: () => void } = {}) {
  const events: string[] = [];
  let handler: RouteHandler | undefined;
  const fullPage: RenderPage = {
    goto: async url => { events.push(`goto:${url}`); return null; },
    evaluate: async () => null, title: async () => "",
    waitForTimeout: async ms => { events.push(`wait:${ms}`); },
    ...page,
  };
  const context: RenderContext = {
    newPage: async () => fullPage,
    route: async (_pattern, routeHandler) => { handler = routeHandler; },
    close: async () => { events.push("context-close"); onClose?.(); },
  };
  const browser: RenderBrowser = { newContext: newContext ?? (async () => context), close: async () => {} };
  return { browser, events, route: (route: RouteLike & { continue?(): Promise<void> }) => handler!(route) };
}

function scriptedRouter({ redirects = [], refused = false }: { redirects?: string[]; refused?: boolean }): RequestRouter {
  return {
    handle: async () => {},
    report: () => ({ fulfilled: 0, blocked: 0, navigationRefused: refused, bytes: 0 }),
    takeNavigationRedirect: () => redirects.shift(),
  };
}

function request({ url, method = "GET" }: { url: string; method?: string }): RoutedRequest {
  return { url: () => url, method: () => method, headers: () => ({}), resourceType: () => "document", isNavigationRequest: () => true, frame: () => ({ parentFrame: () => null }) };
}

function locatorFor({ count, visible }: { count: () => Promise<number>; visible?: boolean }, events: string[]): RenderLocator {
  const locator: RenderLocator = {
    first: () => locator, count,
    click: async () => { events.push("dismiss"); },
    ...(visible === undefined ? {} : { isVisible: async () => visible }),
  };
  return locator;
}

const failingGoto = (events: string[]): RenderPage["goto"] => async url => { events.push(`goto:${url}`); throw new Error(`net::ERR_ABORTED at ${url}`); };

test("an explicit target outside the base origin is refused before any navigation", async () => {
  const fake = fakeBrowser();
  const failure = await renderPage({ browser: fake.browser, url: "https://other.example/path", consume: async () => "never" }, { originBaseUrl: "https://site.example/" }).catch(error => error);
  expect(failure).toBeInstanceOf(OffOriginNavigationError);
  expect(failure.origin).toBe("https://other.example");
  expect(fake.events).toEqual(["context-close"]);
});

test("a failed navigation without a router surfaces the browser's own error and still closes the context", async () => {
  const fake = fakeBrowser({ goto: async () => { throw new Error("net::ERR_NAME_NOT_RESOLVED"); } });
  await expect(renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "never" })).rejects.toThrow("net::ERR_NAME_NOT_RESOLVED");
  expect(fake.events).toEqual(["context-close"]);
});

test("a recorded main-frame redirect becomes the next explicit navigation and the final URL", async () => {
  const events: string[] = [];
  let calls = 0;
  const fake = fakeBrowser({ goto: async url => { events.push(url); calls += 1; if (calls === 1) throw new Error("net::ERR_ABORTED"); return { status: () => 200, url: () => url }; } });
  const finalUrl = await renderPage({ browser: fake.browser, url: "https://site.example/", consume: async session => session.finalUrl },
    { originPolicy: "public", router: scriptedRouter({ redirects: ["https://cdn.example/landing"] }), waitFor: 0 });
  expect(events).toEqual(["https://site.example/", "https://cdn.example/landing"]);
  expect(finalUrl).toBe("https://cdn.example/landing");
});

test("a redirect chain longer than the hop limit stops with a too-many-redirects error", async () => {
  const events: string[] = [];
  const redirects = Array.from({ length: MAX_REDIRECT_HOPS + 1 }, (_, n) => `https://site.example/hop-${n + 1}`);
  const fake = fakeBrowser({ goto: failingGoto(events) });
  await expect(renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "never" }, { originPolicy: "public", router: scriptedRouter({ redirects }) }))
    .rejects.toThrow(`Rendering stopped: https://site.example kept redirecting past the ${MAX_REDIRECT_HOPS}-hop limit`);
  expect(events).toHaveLength(MAX_REDIRECT_HOPS + 1);
  expect(fake.events).toEqual(["context-close"]);
});

test("a navigation the egress guard refused reports the stable WEB_RENDER_REFUSED code", async () => {
  const fake = fakeBrowser({ goto: failingGoto([]) });
  const failure = await renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "never" }, { originPolicy: "public", router: scriptedRouter({ refused: true }) }).catch(error => error);
  expect(failure).toBeInstanceOf(RenderRequestRefused);
  expect(failure.code).toBe("WEB_RENDER_REFUSED");
  expect(failure.message).toBe("Navigation refused by the egress guard");
});

test("a selector wait on a browser port without selector support is refused by name", async () => {
  const fake = fakeBrowser();
  await expect(renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "never" }, { waitFor: "#ready" }))
    .rejects.toThrow('Rendering cannot wait for selector "#ready": this browser port has no waitForSelector');
  expect(fake.events).toEqual(["goto:https://site.example/", "context-close"]);
});

test("a final page URL on another origin is refused before the consumer runs", async () => {
  const fake = fakeBrowser({ url: () => "https://other.example/after-script" });
  let consumed = false;
  const failure = await renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => { consumed = true; } }, { waitFor: 0 }).catch(error => error);
  expect(failure).toBeInstanceOf(OffOriginNavigationError);
  expect(failure.message).toBe("Off-origin navigation refused: https://other.example is outside the rendered site's origin");
  expect(consumed).toBe(false);
  expect(fake.events).toContain("context-close");
});

test("the final URL falls back to the response URL, then to the navigated target", async () => {
  const withResponse = fakeBrowser({ goto: async () => ({ status: () => 200, url: () => "https://site.example/from-response" }) });
  expect(await renderPage({ browser: withResponse.browser, url: "https://site.example/", consume: async session => session.finalUrl }, { waitFor: 0 })).toBe("https://site.example/from-response");
  const bare = fakeBrowser();
  expect(await renderPage({ browser: bare.browser, url: "https://site.example/", consume: async session => session.finalUrl }, { waitFor: 0 })).toBe("https://site.example/");
});

test("a browser that cannot open a context surfaces its error and has nothing to close", async () => {
  const fake = fakeBrowser({}, { newContext: async () => { throw new Error("browser has been closed"); } });
  await expect(renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "never" })).rejects.toThrow("browser has been closed");
  expect(fake.events).toEqual([]);
});

test("a caller that cancels while the deadline closes the page keeps the raw abort reason", async () => {
  const caller = new AbortController();
  const fake = fakeBrowser({ goto: () => new Promise(() => {}) }, { onClose: () => caller.abort(new Error("caller stop")) });
  const failure = await renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "never" }, { timeoutMs: 20, signal: caller.signal }).catch(error => error);
  expect(failure).not.toBeInstanceOf(PageWorkTimeout);
  expect(failure.name).toBe("TimeoutError");
});

test("an own-origin route without continue support is refused with the reason", async () => {
  const fake = fakeBrowser({ goto: async url => {
    await expect(fake.route({ request: () => request({ url }), fulfill: async () => {}, abort: async () => {} })).rejects.toThrow("Own-origin browser route cannot continue: the route port has no continue()");
    return null;
  } });
  await renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "ok" }, { waitFor: 0 });
});

test("an own-origin GET continues while a write is aborted without reaching the browser network", async () => {
  const outcomes: string[] = [];
  const fake = fakeBrowser({ goto: async url => {
    for (const method of ["GET", "POST"]) {
      await fake.route({ request: () => request({ url, method }), fulfill: async () => {}, abort: async code => { outcomes.push(`${method}:abort:${code}`); }, continue: async () => { outcomes.push(`${method}:continue`); } });
    }
    return null;
  } });
  await renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "ok" }, { waitFor: 0 });
  expect(outcomes).toEqual(["GET:continue", "POST:abort:blockedbyclient"]);
});

test("cookie dismissal skips a hidden banner and a selector whose lookup throws, then clicks the next", async () => {
  const events: string[] = [];
  const fake = fakeBrowser({ locator: selector => {
    if (selector === COOKIE_DISMISS_SELECTORS[0]) return locatorFor({ count: async () => 1, visible: false }, events);
    if (selector === COOKIE_DISMISS_SELECTORS[1]) return locatorFor({ count: async () => { throw new Error("detached frame"); } }, events);
    return locatorFor({ count: async () => selector === COOKIE_DISMISS_SELECTORS[2] ? 1 : 0 }, events);
  } });
  await renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "ok" }, { waitFor: 0, dismissCookieBanners: true });
  expect(events).toEqual(["dismiss"]);
});

test("a page budget timeout during cookie dismissal ends the render as a timeout", async () => {
  const fake = fakeBrowser({ locator: () => locatorFor({ count: async () => { throw new PageWorkTimeout({ timeoutMs: 7 }); } }, []) });
  await expect(renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "never" }, { waitFor: 0, dismissCookieBanners: true }))
    .rejects.toThrow("page work timed out after 7ms");
  expect(fake.events).toContain("context-close");
});

test("a browser port without locators dismisses nothing and still renders", async () => {
  const fake = fakeBrowser();
  expect(await renderPage({ browser: fake.browser, url: "https://site.example/", consume: async () => "ok" }, { waitFor: 0, dismissCookieBanners: true })).toBe("ok");
});
