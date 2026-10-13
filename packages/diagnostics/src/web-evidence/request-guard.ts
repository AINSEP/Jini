import type { HttpClientPort } from "@jini-ai/core/primitives";

/**
 * @file Every network request the screenshot browser makes, decided and carried here — Chromium
 * itself never opens a socket.
 *
 * The browser context routes `**\/*` to {@link createRequestRouter}. Each request is either aborted
 * or FETCHED BY THIS PROCESS and fulfilled back into the page:
 *
 * - **Public origins** go through the injected guarded client — the same `@jini-ai/platform` guard
 *   `web_fetch_page` and `media_import_from_url` use. It resolves DNS, refuses loopback, RFC1918,
 *   link-local/cloud-metadata and IPv6 ULA/mapped addresses, and PINS the vetted address for the
 *   connection, so a DNS-rebinding answer between "check" and "connect" cannot reach a private host.
 *   That pinning is why requests are fetched here rather than vetted and then `continue()`d: a
 *   continued request is resolved again by Chromium, after the check.
 * - **A redirect is never handed to Chromium.** The guard itself does not follow one
 *   (`maxRedirects: 0`), and a 3xx is not fulfilled either: Playwright does NOT route the next hop of
 *   a fulfilled redirect — Chromium sends it straight to the network (verified against real Chromium,
 *   2026-10-08), where only the launch's dead proxy stops it. So the router follows every redirect
 *   itself, one hop at a time, and each hop is decided and fetched exactly like a new request: a
 *   redirect to a private address is refused at the hop that introduces it. A subresource's hops are
 *   followed here and the final answer fulfilled; the page's own (main-frame) navigation is aborted
 *   with its target recorded ({@link RequestRouter.takeNavigationRedirect}), and the capture navigates
 *   to that target, so the document lives at its real URL and relative links resolve against it.
 * - **The allowlisted origins** (only ever this site's own per-call loopback render, injected by the
 *   host for own-site screenshots) go through `ownSiteFetch`, a plain loopback fetch that is never
 *   handed any other origin.
 * - Public readers may opt into bounded XHR/fetch POST/PUT/PATCH via the guard. Evidence and
 *   screenshots remain GET/HEAD only. Everything else is aborted: non-http(s) schemes (a screenshot needs no
 *   writes, beacons or form posts), streaming/media types that only cost bandwidth in a still
 *   picture, and anything past the per-capture request/byte budget.
 *
 * Public captures drop request `Cookie`/`Authorization` and response `Set-Cookie`, on top of
 * their fresh, storage-less context. Evidence forwards only its own fresh visitor cookies to
 * the own-site origin; first- and third-party response cookies stay in its in-memory context.
 */

/** The slice of a Playwright `Request` the router reads — structural, so tests pass plain objects. */
export interface RoutedRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  /** Transport only: request bodies are never retained as evidence. */
  postData?(): string | null;
  resourceType(): string;
  isNavigationRequest(): boolean;
  frame(): { parentFrame(): unknown };
}

/** The slice of a Playwright `Route` the router drives. */
export interface RouteLike {
  request(): RoutedRequest;
  fulfill(options: { status: number; headers: Record<string, string>; body: Buffer }): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

/** One fetched resource, already bounded. */
export interface FetchedResource {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
  /** A clipped body is corrupt (a half image), so it is aborted rather than fulfilled. */
  truncated: boolean;
}

/** Fetches one allowlisted own-site URL without following redirects. Never given another origin. */
export type OwnSiteFetch = (
  required: { url: string; method: "GET" | "HEAD"; headers: Record<string, string> },
  optional: { signal: AbortSignal; maxBytes: number; fetch?: typeof globalThis.fetch },
) => Promise<FetchedResource>;

export type AbortReason = "scheme" | "method" | "resource-type" | "budget" | "refused" | "failed";

/** Redirect hops followed per request (and per page navigation), each one re-vetted. */
export const MAX_REDIRECT_HOPS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
type RoutedMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH";
export type RequestDecision = { action: "fetch"; via: "guarded" | "own-site"; method: RoutedMethod } | { action: "abort"; reason: AbortReason };

/** Streaming and media types that add nothing to a still picture and could hold a fetch open. */
const SKIPPED_RESOURCE_TYPES: ReadonlySet<string> = new Set(["media", "eventsource", "websocket", "texttrack"]);

/**
 * Pure routing decision for one request. Budget is not considered here (see the router).
 * @complexity O(url length + allowedOrigins).
 */
export function decideRequest(
  { url, method, resourceType, allowedOrigins }: { url: string; method: string; resourceType: string; allowedOrigins: readonly string[] },
  { allowDataRequests = false }: { allowDataRequests?: boolean } = {},
): RequestDecision {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { action: "abort", reason: "scheme" }; }
  if (parsed.username || parsed.password) return { action: "abort", reason: "scheme" };
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { action: "abort", reason: "scheme" };
  const upper = method.toUpperCase();
  const dataWrite = allowDataRequests && ["xhr", "fetch"].includes(resourceType) && ["POST", "PUT", "PATCH"].includes(upper);
  if (upper !== "GET" && upper !== "HEAD" && !dataWrite) return { action: "abort", reason: "method" };
  if (SKIPPED_RESOURCE_TYPES.has(resourceType)) return { action: "abort", reason: "resource-type" };
  return { action: "fetch", via: !dataWrite && allowedOrigins.includes(parsed.origin) ? "own-site" : "guarded", method: upper as RoutedMethod };
}

/** Request headers that must never leave this process, plus hop-by-hop ones the transport owns. */
const DROPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set(["cookie", "authorization", "proxy-authorization", "host", "connection", "content-length", "transfer-encoding", "upgrade"]);
/** Response headers that would lie about the (already decoded) body or try to persist state. */
const DROPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set(["set-cookie", "set-cookie2", "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "alt-svc"]);
const OWN_SITE_RESPONSE_HEADERS: ReadonlySet<string> = new Set([...DROPPED_RESPONSE_HEADERS].filter(name => name !== "set-cookie" && name !== "set-cookie2"));

function filterHeaders(headers: Readonly<Record<string, string>>, dropped: ReadonlySet<string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!lower.startsWith(":") && !dropped.has(lower)) kept[lower] = value;
  }
  return kept;
}

export interface RequestRouterReport {
  fulfilled: number;
  blocked: number;
  /** The page's own (main-frame) navigation, or a redirect hop of it, was refused by the egress guard. */
  navigationRefused: boolean;
  bytes: number;
}

export interface RequestRouter {
  handle(route: RouteLike): Promise<void>;
  report(): RequestRouterReport;
  /** The absolute target of the last main-frame navigation answered with a redirect, then cleared. */
  takeNavigationRedirect(): string | undefined;
}

export interface RequestRouterOptions {
  /** Evidence observes first/third-party response cookies in memory; only own-site request cookies travel. */
  preserveOwnSiteCookies?: boolean;
  /** Public render only: permit bounded XHR/fetch POST/PUT/PATCH through the public guard. */
  allowDataRequests?: boolean;
  maxRequestBodyBytes?: number;
  maxRequests?: number;
  maxTotalBytes?: number;
  maxResourceBytes?: number;
  /** Concurrent fetches in flight; the guard's policy asks untrusted fan-out for a host limiter. */
  maxConcurrent?: number;
  perRequestTimeoutMs?: number;
  /** Host classification port: diagnostics does not depend on the platform transport. */
  isEgressRefused?: (error: unknown) => boolean;
  /** Receives only bounded, credential-free responses from this page's own requests. */
  onBlocked?: (required: { url: string; resourceType: string; reason: AbortReason }) => void;
  onResponse?: (required: { url: string; resourceType: string; resource: FetchedResource }) => void;
}

/** Main-frame origin/refusal policy must not classify iframe or worker requests as page redirects. */
export function isMainFrameNavigation({ request }: { request: RoutedRequest }, _options = {}): boolean {
  try {
    return request.isNavigationRequest() && request.frame().parentFrame() === null;
  } catch {
    // Requests without a frame (workers) are never the page's own navigation.
    return false;
  }
}

/**
 * The absolute URL a redirect response points at, or `undefined` when it is not a redirect. An
 * unparsable `Location` comes back raw, so the next hop's {@link decideRequest} aborts it.
 */
function redirectTarget(resource: FetchedResource, base: string): string | undefined {
  if (!REDIRECT_STATUSES.has(resource.status)) return undefined;
  const location = Object.entries(resource.headers).find(([name]) => name.toLowerCase() === "location")?.[1];
  if (!location) return undefined;
  try { return new URL(location, base).href; } catch { return location; }
}

/** A counting semaphore: at most `limit` holders, FIFO waiters. */
function createSemaphore(limit: number): { acquire(): Promise<() => void> } {
  let active = 0;
  const waiters: Array<() => void> = [];
  const release = () => {
    active -= 1;
    waiters.shift()?.();
  };
  return {
    async acquire() {
      if (active >= limit) await new Promise<void>((resolve) => waiters.push(resolve));
      active += 1;
      return release;
    },
  };
}

/**
 * Builds the router for ONE capture (budgets and counters are per capture).
 * @param required.httpClient - Guarded client built from `platform/http`'s `WEB_SCREENSHOT_EGRESS_POLICY`; never a raw transport.
 * @param required.ownSiteFetch - Loopback fetch for `allowedOrigins` only.
 * @param required.allowedOrigins - Exact origins (scheme://host:port) that bypass the public guard; empty for public pages.
 * @param required.signal - Aborts every in-flight fetch when the capture ends or times out.
 * @complexity O(1) bookkeeping per hop, at most {@link MAX_REDIRECT_HOPS} + 1 hops per request; fetches are bounded by `maxConcurrent` and the budgets.
 */
export function createRequestRouter(
  { httpClient, ownSiteFetch, allowedOrigins, signal }: { httpClient: HttpClientPort; ownSiteFetch: OwnSiteFetch; allowedOrigins: readonly string[]; signal: AbortSignal },
  { maxRequests = 300, maxTotalBytes = 60 * 1024 * 1024, maxResourceBytes = 15 * 1024 * 1024, maxConcurrent = 6, perRequestTimeoutMs = 15_000, preserveOwnSiteCookies = false, allowDataRequests = false, maxRequestBodyBytes = 64 * 1024, isEgressRefused = error => error instanceof Error && error.name === "EgressRefusedError", onResponse, onBlocked }: RequestRouterOptions = {},
): RequestRouter {
  const report: RequestRouterReport = { fulfilled: 0, blocked: 0, navigationRefused: false, bytes: 0 };
  const slots = createSemaphore(maxConcurrent);
  let started = 0;
  let navigationRedirect: string | undefined;

  async function abort(route: RouteLike, reason: AbortReason, isNavigation: boolean): Promise<void> {
    report.blocked += 1;
    onBlocked?.({ url: route.request().url(), resourceType: route.request().resourceType(), reason });
    if (reason === "refused" && isNavigation) report.navigationRefused = true;
    // The context may already be closing; a route that is gone has nothing left to abort.
    await route.abort(reason === "failed" ? "failed" : "blockedbyclient").catch(() => {});
  }

  async function fetchResource(decision: Extract<RequestDecision, { action: "fetch" }>, url: string, headers: Record<string, string>, requestBody?: string): Promise<FetchedResource> {
    if (decision.via === "own-site") {
      return ownSiteFetch({ url, method: decision.method as "GET" | "HEAD", headers }, { signal, maxBytes: maxResourceBytes });
    }
    const response = await httpClient.send({ request: { method: decision.method, url, headers, ...(requestBody === undefined ? {} : { body: requestBody }), signal, timeoutMs: perRequestTimeoutMs, maxResponseBytes: maxResourceBytes } });
    const body = response.bodyBytes ? Buffer.from(response.bodyBytes) : Buffer.from(response.bodyText, "utf8");
    return { status: response.status, headers: { ...response.headers, ...(response.setCookies?.length ? { "set-cookie": response.setCookies.join("\n") } : {}) }, body, truncated: response.bodyBytes ? response.bodyBytesTruncated === true : response.bodyTruncated === true };
  }

  /** One hop: budget, a concurrency slot, the fetch, and the byte accounting — or why it was refused. */
  async function fetchHop(decision: Extract<RequestDecision, { action: "fetch" }>, url: string, headers: Record<string, string>, body?: string): Promise<FetchedResource | AbortReason> {
    if (started >= maxRequests || report.bytes >= maxTotalBytes || signal.aborted) return "budget";
    started += 1;
    const release = await slots.acquire();
    if (signal.aborted) { release(); return "budget"; }
    let resource: FetchedResource;
    try {
      resource = await fetchResource(decision, url, headers, body);
    } catch (error) {
      return isEgressRefused(error) ? "refused" : "failed";
    } finally {
      release();
    }
    if (resource.truncated) return "budget";
    report.bytes += resource.body.length;
    return report.bytes > maxTotalBytes ? "budget" : resource;
  }

  return {
    async handle(route) {
      const request = route.request();
      const isNavigation = isMainFrameNavigation({ request });
      const headers = filterHeaders(request.headers(), DROPPED_REQUEST_HEADERS);
      let url = request.url();
      let method = request.method();
      let body: string | undefined;
      // Reject oversized writes whole; a clipped GraphQL payload would be a different request.
      if (allowDataRequests && ["xhr", "fetch"].includes(request.resourceType()) && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
        body = request.postData?.() ?? undefined;
        if (body !== undefined && Buffer.byteLength(body, "utf8") > maxRequestBodyBytes) return abort(route, "budget", isNavigation);
      }
      for (let hop = 0; ; hop += 1) {
        const decision = decideRequest({ url, method, resourceType: request.resourceType(), allowedOrigins }, { allowDataRequests });
        if (decision.action === "abort") return abort(route, decision.reason, isNavigation);
        const ownCookie = preserveOwnSiteCookies && decision.via === "own-site" ? request.headers().cookie : undefined;
        const resource = await fetchHop(decision, url, ownCookie ? { ...headers, cookie: ownCookie } : headers, body);
        if (typeof resource === "string") return abort(route, resource, isNavigation);
        const next = redirectTarget(resource, url);
        if (next === undefined) {
          report.fulfilled += 1;
          onResponse?.({ url, resourceType: request.resourceType(), resource });
          await route.fulfill({ status: resource.status, headers: filterHeaders(resource.headers, preserveOwnSiteCookies
            ? OWN_SITE_RESPONSE_HEADERS
            : DROPPED_RESPONSE_HEADERS), body: resource.body }).catch(() => {});
          return;
        }
        if (isNavigation) {
          // Not a block: the capture navigates to `next` itself, so that hop is routed like this one.
          // `aborted` (net::ERR_ABORTED) commits no error page; `blockedbyclient` would commit
          // chrome-error://, which interrupts that next navigation (real Chromium, 2026-10-08).
          navigationRedirect = next;
          await route.abort("aborted").catch(() => {});
          return;
        }
        if (hop >= MAX_REDIRECT_HOPS) return abort(route, "failed", isNavigation);
        // Match fetch redirect semantics without letting Chromium follow an unvetted hop.
        if (resource.status === 303 || ([301, 302].includes(resource.status) && method.toUpperCase() === "POST")) {
          method = "GET"; body = undefined; delete headers["content-type"];
        }
        url = next;
      }
    },
    report: () => ({ ...report }),
    takeNavigationRedirect() {
      const target = navigationRedirect;
      navigationRedirect = undefined;
      return target;
    },
  };
}

/**
 * The default {@link OwnSiteFetch}: the global `fetch`, redirects returned rather than followed (so
 * the router re-decides the next hop), body read up to `maxBytes`. Overflow cancels the stream;
 * fetch/read failures propagate, and the reader lock is always released.
 * @complexity O(min(body, maxBytes)).
 */
export const fetchOwnSiteResource: OwnSiteFetch = async ({ url, method, headers }, { signal, maxBytes, fetch: fetchResource = globalThis.fetch }) => {
  const response = await fetchResource(url, { method, headers, redirect: "manual", signal });
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => { responseHeaders[name] = value; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) responseHeaders["set-cookie"] = cookies.join("\n");
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { truncated = true; break; }
        chunks.push(Buffer.from(value));
      }
    } finally {
      // Cleanup must not replace the original read error when the stream is already errored.
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return { status: response.status, headers: responseHeaders, body: Buffer.concat(chunks), truncated };
};
