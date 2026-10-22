/** request-guard: pure decisions, then one router per test driven through typed route/transport fakes. */
import { test, expect } from "vitest";
import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { createRequestRouter, decideRequest, isMainFrameNavigation, MAX_REDIRECT_HOPS, type FetchedResource, type OwnSiteFetch, type RequestRouterOptions, type RoutedRequest, type RouteLike } from "../request-guard.js";

const NO_ORIGINS: readonly string[] = [];

test.each([
  ["an unparsable URL", "not a url"],
  ["a URL with a username", "https://user@public.example/"],
  ["a URL with a password", "https://:pw@public.example/"],
  ["a non-http scheme", "ftp://public.example/file"],
])("decideRequest refuses %s as a scheme problem", (_name, url) => {
  expect(decideRequest({ url, method: "GET", resourceType: "document", allowedOrigins: NO_ORIGINS })).toEqual({ action: "abort", reason: "scheme" });
});

test("decideRequest refuses a write that is not an opted-in xhr/fetch data request", () => {
  const decide = (method: string, resourceType: string, allowDataRequests: boolean) => decideRequest({ url: "https://public.example/", method, resourceType, allowedOrigins: NO_ORIGINS }, { allowDataRequests });
  expect([decide("DELETE", "fetch", true), decide("POST", "document", true), decide("POST", "fetch", false)]).toEqual(Array(3).fill({ action: "abort", reason: "method" }));
});

test("decideRequest skips streaming and media resource types", () => {
  expect(decideRequest({ url: "https://public.example/a.mp4", method: "GET", resourceType: "media", allowedOrigins: NO_ORIGINS })).toEqual({ action: "abort", reason: "resource-type" });
});

test("decideRequest sends allowlisted reads to the own-site fetch and data writes to the guard", () => {
  const allowedOrigins = ["https://site.example"];
  expect(decideRequest({ url: "https://site.example/a", method: "get", resourceType: "script", allowedOrigins })).toEqual({ action: "fetch", via: "own-site", method: "GET" });
  expect(decideRequest({ url: "https://site.example/api", method: "post", resourceType: "xhr", allowedOrigins }, { allowDataRequests: true })).toEqual({ action: "fetch", via: "guarded", method: "POST" });
  expect(decideRequest({ url: "https://public.example/a", method: "HEAD", resourceType: "image", allowedOrigins })).toEqual({ action: "fetch", via: "guarded", method: "HEAD" });
});

test("only a top-frame navigation counts as the page's own navigation; frameless worker requests do not", () => {
  const base = request({ url: "https://public.example/" });
  expect(isMainFrameNavigation({ request: base })).toBe(true);
  expect(isMainFrameNavigation({ request: { ...base, frame: () => ({ parentFrame: () => ({}) }) } })).toBe(false);
  expect(isMainFrameNavigation({ request: { ...base, frame: () => { throw new Error("no frame for a service worker"); } } })).toBe(false);
});

function request({ url, method = "GET", resourceType = "document", navigation = true, headers = {}, postData }: { url: string; method?: string; resourceType?: string; navigation?: boolean; headers?: Record<string, string>; postData?: string }): RoutedRequest {
  return {
    url: () => url, method: () => method, headers: () => headers, resourceType: () => resourceType,
    isNavigationRequest: () => navigation, frame: () => ({ parentFrame: () => null }),
    ...(postData === undefined ? {} : { postData: () => postData }),
  };
}

/** A route that records what the router did with it; `fulfill`/`abort` can fail like a closed page. */
function route(routed: RoutedRequest, { closed = false }: { closed?: boolean } = {}) {
  const outcome: { fulfilled?: { status: number; headers: Record<string, string>; body: string }; aborted?: string } = {};
  const like: RouteLike = {
    request: () => routed,
    fulfill: async ({ status, headers, body }) => { if (closed) throw new Error("route is gone"); outcome.fulfilled = { status, headers, body: body.toString() }; },
    abort: async code => { if (closed) throw new Error("route is gone"); outcome.aborted = code ?? "default"; },
  };
  return { like, outcome };
}

/** Guarded transport answering by URL; a function answer may throw to simulate refusals/failures. */
function transport(answers: Record<string, Partial<HttpResponse> | (() => never)>) {
  const sent: HttpRequest[] = [];
  const httpClient: HttpClientPort = { send: async ({ request: sentRequest }) => {
    sent.push(sentRequest);
    const answer = answers[sentRequest.url];
    if (typeof answer === "function") answer();
    return { status: 200, headers: {}, bodyText: "ok", ...answer };
  } };
  return { httpClient, sent };
}

const unusedOwnSite: OwnSiteFetch = async () => { throw new Error("own-site fetch not expected"); };

function router(httpClient: HttpClientPort, options: RequestRouterOptions = {}, { ownSiteFetch = unusedOwnSite, allowedOrigins = NO_ORIGINS, signal = new AbortController().signal }: { ownSiteFetch?: OwnSiteFetch; allowedOrigins?: readonly string[]; signal?: AbortSignal } = {}) {
  const blocked: string[] = [];
  const responses: string[] = [];
  const created = createRequestRouter({ httpClient, ownSiteFetch, allowedOrigins, signal }, {
    onBlocked: ({ url, reason }) => { blocked.push(`${reason}:${url}`); },
    onResponse: ({ url, resource }) => { responses.push(`${resource.status}:${url}`); },
    ...options,
  });
  return { router: created, blocked, responses };
}

function egressRefused(): never {
  const error = new Error("refused private peer"); error.name = "EgressRefusedError"; throw error;
}

test("a guarded fetch drops credentials and hop headers going out and state headers coming back", async () => {
  const net = transport({ "https://public.example/": { headers: { "Content-Type": "text/html", "set-cookie": "a=1", "content-encoding": "gzip" }, setCookies: ["a=1"] } });
  const { router: guard, responses } = router(net.httpClient);
  const { like, outcome } = route(request({ url: "https://public.example/", headers: { Cookie: "OWNER", authorization: "OWNER", ":authority": "x", accept: "text/html" } }));
  await guard.handle(like);
  expect(net.sent[0]?.headers).toEqual({ accept: "text/html" });
  expect(outcome.fulfilled).toEqual({ status: 200, headers: { "content-type": "text/html" }, body: "ok" });
  expect(responses).toEqual(["200:https://public.example/"]);
  expect(guard.report()).toEqual({ fulfilled: 1, blocked: 0, navigationRefused: false, bytes: 2 });
});

test("a byte payload is fulfilled as bytes and a clipped one is aborted as over budget", async () => {
  const net = transport({
    "https://public.example/a.png": { bodyBytes: new Uint8Array([1, 2, 3]), bodyText: "lossy" },
    "https://public.example/b.png": { bodyBytes: new Uint8Array([1]), bodyBytesTruncated: true },
  });
  const { router: guard, blocked } = router(net.httpClient);
  const whole = route(request({ url: "https://public.example/a.png", resourceType: "image", navigation: false }));
  const clipped = route(request({ url: "https://public.example/b.png", resourceType: "image", navigation: false }));
  await guard.handle(whole.like); await guard.handle(clipped.like);
  expect(whole.outcome.fulfilled?.body).toBe("\u0001\u0002\u0003");
  expect(clipped.outcome.aborted).toBe("blockedbyclient");
  expect(blocked).toEqual(["budget:https://public.example/b.png"]);
});

test("a clipped text body is aborted as over budget", async () => {
  const net = transport({ "https://public.example/": { bodyTruncated: true } });
  const { router: guard, blocked } = router(net.httpClient);
  const { like, outcome } = route(request({ url: "https://public.example/" }));
  await guard.handle(like);
  expect(outcome.aborted).toBe("blockedbyclient"); expect(blocked).toEqual(["budget:https://public.example/"]);
});

test("a guard refusal of the main-frame navigation marks the navigation refused", async () => {
  const net = transport({ "http://10.0.0.1/": egressRefused });
  const { router: guard, blocked } = router(net.httpClient);
  const { like, outcome } = route(request({ url: "http://10.0.0.1/" }));
  await guard.handle(like);
  expect(outcome.aborted).toBe("blockedbyclient"); expect(blocked).toEqual(["refused:http://10.0.0.1/"]);
  expect(guard.report().navigationRefused).toBe(true);
});

test("a refused subresource is blocked without marking the navigation refused", async () => {
  const net = transport({ "http://10.0.0.1/x.js": egressRefused });
  const { router: guard } = router(net.httpClient);
  await guard.handle(route(request({ url: "http://10.0.0.1/x.js", resourceType: "script", navigation: false })).like);
  expect(guard.report()).toMatchObject({ blocked: 1, navigationRefused: false });
});

test("a transport failure aborts with the failed code, and the host port classifies refusals", async () => {
  const net = transport({ "https://public.example/": () => { throw new Error("socket hang up"); } });
  const plain = router(net.httpClient);
  const failed = route(request({ url: "https://public.example/" }));
  await plain.router.handle(failed.like);
  expect(failed.outcome.aborted).toBe("failed"); expect(plain.blocked).toEqual(["failed:https://public.example/"]);
  const classified = router(net.httpClient, { isEgressRefused: error => error instanceof Error && error.message === "socket hang up" });
  await classified.router.handle(route(request({ url: "https://public.example/" })).like);
  expect(classified.blocked).toEqual(["refused:https://public.example/"]);
});

test("an abort on a route that is already gone is swallowed, and so is a fulfill", async () => {
  const net = transport({});
  const { router: guard } = router(net.httpClient);
  await guard.handle(route(request({ url: "ftp://public.example/" }), { closed: true }).like);
  await guard.handle(route(request({ url: "https://public.example/" }), { closed: true }).like);
  expect(guard.report()).toMatchObject({ blocked: 1, fulfilled: 1 });
});

test("the request budget refuses fetches past maxRequests without contacting the transport", async () => {
  const net = transport({});
  const { router: guard, blocked } = router(net.httpClient, { maxRequests: 1 });
  await guard.handle(route(request({ url: "https://public.example/1" })).like);
  await guard.handle(route(request({ url: "https://public.example/2" })).like);
  expect(net.sent.map(sent => sent.url)).toEqual(["https://public.example/1"]);
  expect(blocked).toEqual(["budget:https://public.example/2"]);
});

test("the byte budget aborts the response that crosses it and refuses every later fetch", async () => {
  const net = transport({ "https://public.example/big": { bodyText: "123456" } });
  const { router: guard, blocked } = router(net.httpClient, { maxTotalBytes: 5 });
  const big = route(request({ url: "https://public.example/big" }));
  await guard.handle(big.like);
  await guard.handle(route(request({ url: "https://public.example/next" })).like);
  expect(big.outcome.aborted).toBe("blockedbyclient");
  expect(blocked).toEqual(["budget:https://public.example/big", "budget:https://public.example/next"]);
  expect(net.sent).toHaveLength(1);
});

test("an aborted capture signal refuses fetches before they start", async () => {
  const net = transport({}); const capture = new AbortController(); capture.abort();
  const { router: guard, blocked } = router(net.httpClient, {}, { signal: capture.signal });
  await guard.handle(route(request({ url: "https://public.example/" })).like);
  expect(net.sent).toEqual([]); expect(blocked).toEqual(["budget:https://public.example/"]);
});

test("fetches beyond maxConcurrent wait for a slot, and a capture that ends while waiting refuses them", async () => {
  let release!: () => void;
  const capture = new AbortController(); const order: string[] = [];
  const httpClient: HttpClientPort = { send: async ({ request: sent }) => {
    order.push(`start:${sent.url}`);
    if (sent.url.endsWith("/1")) await new Promise<void>(resolve => { release = resolve; });
    return { status: 200, headers: {}, bodyText: "ok" };
  } };
  const { router: guard, blocked } = router(httpClient, { maxConcurrent: 1 }, { signal: capture.signal });
  const first = guard.handle(route(request({ url: "https://public.example/1", navigation: false })).like);
  const second = guard.handle(route(request({ url: "https://public.example/2", navigation: false })).like);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(order).toEqual(["start:https://public.example/1"]);
  capture.abort(); release();
  await Promise.all([first, second]);
  expect(order).toEqual(["start:https://public.example/1"]);
  expect(blocked).toEqual(["budget:https://public.example/2"]);
});

test("an allowlisted origin goes through the own-site fetch carrying only its own cookie, keeping Set-Cookie", async () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const ownSiteFetch: OwnSiteFetch = async ({ url, method, headers }) => {
    calls.push({ url, method, headers });
    return { status: 200, headers: { "set-cookie": "visitor=1", "content-length": "2" }, body: Buffer.from("ok"), truncated: false } satisfies FetchedResource;
  };
  const { router: guard } = router(transport({}).httpClient, { preserveOwnSiteCookies: true }, { ownSiteFetch, allowedOrigins: ["https://site.example"] });
  const { like, outcome } = route(request({ url: "https://site.example/", method: "HEAD", headers: { cookie: "visitor=1", authorization: "OWNER" } }));
  await guard.handle(like);
  expect(calls).toEqual([{ url: "https://site.example/", method: "HEAD", headers: { cookie: "visitor=1" } }]);
  expect(outcome.fulfilled?.headers).toEqual({ "set-cookie": "visitor=1" });
});

test("a main-frame redirect is aborted as navigation control and its absolute target handed over once", async () => {
  const net = transport({ "https://public.example/old": { status: 302, headers: { Location: "/new?x=1" } } });
  const { router: guard, blocked } = router(net.httpClient);
  const { like, outcome } = route(request({ url: "https://public.example/old" }));
  await guard.handle(like);
  expect(outcome.aborted).toBe("aborted"); expect(blocked).toEqual([]);
  expect(guard.takeNavigationRedirect()).toBe("https://public.example/new?x=1");
  expect(guard.takeNavigationRedirect()).toBeUndefined();
});

test("a navigation redirect whose route is gone still records the target", async () => {
  const net = transport({ "https://public.example/old": { status: 301, headers: { location: "https://public.example/new" } } });
  const { router: guard } = router(net.httpClient);
  await guard.handle(route(request({ url: "https://public.example/old" }), { closed: true }).like);
  expect(guard.takeNavigationRedirect()).toBe("https://public.example/new");
});

test("a subresource redirect chain is followed hop by hop and the final answer fulfilled", async () => {
  const net = transport({
    "https://public.example/a.js": { status: 308, headers: { location: "https://cdn.example/a.js" } },
    "https://cdn.example/a.js": { status: 200, bodyText: "code" },
  });
  const { router: guard } = router(net.httpClient);
  const { like, outcome } = route(request({ url: "https://public.example/a.js", resourceType: "script", navigation: false }));
  await guard.handle(like);
  expect(net.sent.map(sent => sent.url)).toEqual(["https://public.example/a.js", "https://cdn.example/a.js"]);
  expect(outcome.fulfilled?.body).toBe("code");
});

test("a 3xx without a Location header is fulfilled as an ordinary answer", async () => {
  const net = transport({ "https://public.example/a.js": { status: 304, headers: {} }, "https://public.example/b.js": { status: 302, headers: {} } });
  const { router: guard } = router(net.httpClient);
  const notModified = route(request({ url: "https://public.example/a.js", navigation: false }));
  const bare = route(request({ url: "https://public.example/b.js", navigation: false }));
  await guard.handle(notModified.like); await guard.handle(bare.like);
  expect(notModified.outcome.fulfilled?.status).toBe(304); expect(bare.outcome.fulfilled?.status).toBe(302);
});

test("an unparsable Location is handed to the next hop raw and refused there as a scheme problem", async () => {
  const net = transport({ "https://public.example/a.js": { status: 302, headers: { location: "http://[broken" } } });
  const { router: guard, blocked } = router(net.httpClient);
  await guard.handle(route(request({ url: "https://public.example/a.js", navigation: false })).like);
  expect(blocked).toEqual(["scheme:https://public.example/a.js"]);
});

test("a subresource redirect loop stops after the hop limit with the failed code", async () => {
  const sent: string[] = [];
  const httpClient: HttpClientPort = { send: async ({ request: hop }) => { sent.push(hop.url); return { status: 302, headers: { location: `${hop.url}x` }, bodyText: "" }; } };
  const { router: guard, blocked } = router(httpClient);
  const { like, outcome } = route(request({ url: "https://public.example/r", navigation: false }));
  await guard.handle(like);
  expect(sent).toHaveLength(MAX_REDIRECT_HOPS + 1);
  expect(outcome.aborted).toBe("failed"); expect(blocked).toEqual(["failed:https://public.example/r"]);
});

test.each([
  { status: 302, method: "POST", next: "GET" },
  { status: 301, method: "PUT", next: "PUT" },
])("a $status redirect of a $method data request continues as $next", async ({ status, method, next }) => {
  const net = transport({ "https://public.example/api": { status, headers: { location: "https://public.example/v2" } } });
  const { router: guard } = router(net.httpClient, { allowDataRequests: true });
  await guard.handle(route(request({ url: "https://public.example/api", method, resourceType: "fetch", navigation: false, headers: { "content-type": "application/json" }, postData: "{}" })).like);
  const hop = net.sent[1]!;
  expect([hop.method, hop.body, hop.headers["content-type"]]).toEqual(next === "GET" ? ["GET", undefined, undefined] : [method, "{}", "application/json"]);
});

test("a data write without a body is sent without one", async () => {
  const net = transport({});
  const { router: guard } = router(net.httpClient, { allowDataRequests: true });
  await guard.handle(route(request({ url: "https://public.example/api", method: "POST", resourceType: "xhr", navigation: false })).like);
  expect(net.sent[0]).toMatchObject({ method: "POST" }); expect(net.sent[0]).not.toHaveProperty("body");
});
