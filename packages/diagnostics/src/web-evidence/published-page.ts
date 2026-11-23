import { createServer, type RequestListener, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { createNoopObservabilityPort, type ObservabilityPort } from "@jini-ai/core/contracts/observability";
import { readBoundedBody } from "./bounded-body.js";
import { toCookieShapes, type CookieShape } from "./cookie-shapes.js";
import { DEFAULT_MAX_BODY_BYTES, MAX_MAX_BODY_BYTES, shapePageBody, type PageBodyOptions, type ShapedPageBody } from "./page-body.js";
import { resolveSitePath } from "./site-path-policy.js";

/**
 * @file `fetchPublishedPage()` — renders ONE route of this site's own public surface and returns
 * what a visitor would actually receive: status, headers, cookie shapes and (bounded) body.
 *
 * Why this exists as a sibling of `site-profile.ts` rather than a bigger snapshot (2026-08-26
 * swarm-consensus, "config truth vs. render truth", agreed 5/5): a configuration snapshot can
 * truthfully report "cookie-consent widget: installed, enabled" while the published page renders
 * nothing of the sort. This codebase has three render paths that do not agree, and configuration is
 * not one of them. Anything that must know what is LIVE has to fetch the live thing.
 *
 * ---------------------------------------------------------------------------
 * This is an SSRF-shaped surface. Here is why it structurally is not one.
 * ---------------------------------------------------------------------------
 *
 * The tool takes a **path**, never a URL. There is no caller-supplied host, scheme, port or
 * credential anywhere in this module, so there is no allowlist to get wrong and no redirect hop to
 * re-validate against a denylist of private ranges.
 *
 * The origin is one this process CREATES for the duration of a single call: `createSiteApp()`'s own
 * Express app on an ephemeral `127.0.0.1` port, exactly the way the host's static site exporter already
 * renders the site for a static export. Nothing in the input can steer that origin. Even a caller
 * that smuggles an absolute URL past the string checks would fail the explicit
 * `url.origin === base.origin` assertion in `resolveSameOriginPath` (`@jini-ai/diagnostics/web-evidence`), which compares against
 * the origin this module minted rather than against a pattern.
 *
 * On top of that, the path itself is validated allowlist-style before it is used
 * (`resolveSitePath`, which binds that guard to this site's pathname policy): must be root-relative, no protocol-relative `//` prefix, no
 * backslashes, no control characters (CR/LF request splitting), no `..` segments after a single
 * percent-decode, and not under `/api/` — see that function's own doc for why each one is there.
 *
 * `redirect: "manual"` is deliberate: a 30x is EVIDENCE (a compliance consumer wants to know the
 * privacy-policy URL redirects), and following it automatically would be the one place a
 * server-controlled `Location` could walk this fetch off-origin.
 *
 * ---------------------------------------------------------------------------
 * What is and is not returned
 * ---------------------------------------------------------------------------
 * - **All response headers except `set-cookie`.** An allowlist would defeat the point: "does this
 *   site emit an unexpected header" is exactly the kind of question this tool exists to answer.
 *   These are headers this site's own code emits; none of them is a stored credential.
 * - **`set-cookie` is projected to name + attributes, never a value** (`toCookieShapes` in `@jini-ai/diagnostics/web-evidence`).
 *   For the compliance case the cookie NAME and its `Secure`/`HttpOnly`/`SameSite`/`Max-Age`
 *   attributes are the whole signal; the value is the only part that could carry a session token.
 * - **The body, capped** at {@link DEFAULT_MAX_BODY_BYTES} with an explicit `truncated` flag. The
 *   read stops at the cap rather than buffering the whole response and slicing afterwards, so a
 *   pathologically large route cannot be turned into a memory-exhaustion lever.
 */

/** Wall clock for one render+fetch, including booting the ephemeral app. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/** The origin this module mints for every call. Fixed loopback host; only the port varies. */
const LOOPBACK_HOST = "http://127.0.0.1";

export interface PublishedPageMetadata {
  /** The canonical path actually requested, after normalization — not the raw caller string. */
  path: string;
  status: number;
  /** `true` for 2xx only. A 30x/404 is a successful OBSERVATION, so the call does not throw. */
  ok: boolean;
  /** Response headers, lowercased, `set-cookie` excluded (see {@link cookies}). */
  headers: Record<string, string>;
  /** `Set-Cookie` headers with their values stripped — see this file's header. */
  cookies: CookieShape[];
  /** Bytes actually read into {@link body} (not `Content-Length`, which may disagree). */
  bodyBytes: number;
  /** `true` when the cap stopped the read before the response ended. */
  truncated: boolean;
}

export type PublishedPageResult = Omit<PublishedPageMetadata, "bodyBytes" | "truncated"> & ShapedPageBody;

export interface FetchPublishedPageDeps {
  /**
   * The SAME site-app factory the static exporter renders through (`RouteDeps.createSiteApp`).
   *
   * Takes the optional render override (`{ themeId }`, 2026-10-08: `web_screenshot_page` seeing a
   * theme copy without activating it). It used to be handed the deps bag itself, for a historical
   * `(routeDeps: RouteDeps) => Express` shape; both composition roots have long been nullary-closed
   * over their deps, so nothing reads that argument any more.
   *
   * Typed as Node's `RequestListener` rather than Express's `Express` because that is what this
   * module actually consumes — the sole use is `createServer(deps.createSiteApp(...))`, and
   * `http.createServer` takes a request listener. Naming `Express` here made the feature import a
   * web framework to describe a two-argument callback, which is the `features/` boundary violation
   * `src/features/__tests__/features-no-server-imports.boundary.test.ts` fails on. A real Express
   * app still satisfies this: `@types/express-serve-static-core`'s `Application` declares an
   * explicit `(req: http.IncomingMessage, res: http.ServerResponse)` call signature, which is
   * exactly why `createServer(app)` type-checked before this change and still does.
   */
  createSiteApp(optional?: { themeId?: string; consentAudit?: true }): RequestListener;
  /** Native server factory; injected fakes can exercise rendering without opening a socket. */
  readonly createServer?: (listener: RequestListener) => Server;
  /** HTTP transport; omitted, uses the global fetch read at call time. */
  readonly fetch?: typeof globalThis.fetch;
  /** Traces the loopback render as one outbound span (method, host/port, status — never the path).
   *  `RouteDeps.observability` in production; omitted, the render is untraced. */
  readonly observability?: ObservabilityPort;
  /**
   * Wraps the transport so the loopback render is one outbound span. The host binds
   * `trackFetch` from `@jini-ai/diagnostics/observability`; it is injected rather than imported so
   * this evidence module stays out of the observability domain. Called once per request with the
   * per-call `fetch` and `observability` (the no-op port when {@link observability} is omitted).
   */
  readonly trackFetch: PublishedPageFetchTracker;
  /**
   * The host's reserved first path segments (case-folded, e.g. `admin`, `api`) that
   * {@link resolveSitePath} refuses. Injected so the host stays the one owner of its URL-space policy.
   */
  readonly reservedSegments: ReadonlySet<string>;
}

/** The shape of the observability subpath's `trackFetch`, as this module consumes it. */
export type PublishedPageFetchTracker = (
  required: { fetch: typeof globalThis.fetch; observability: ObservabilityPort },
) => typeof globalThis.fetch;

const UNTRACED = createNoopObservabilityPort({});

export interface FetchPublishedPageOptions extends PageBodyOptions {
  /** Body bytes to keep, clamped to `[1, MAX_MAX_BODY_BYTES]`. */
  maxBytes?: number;
  /** Wall clock for the whole call. */
  timeoutMs?: number;
}

/** Clamps `maxBytes` into `[1, MAX_MAX_BODY_BYTES]`, defaulting when absent or nonsensical. */
function resolveMaxBytes({ requested }: { requested: number | undefined }, _optional = {}): number {
  if (requested === undefined || !Number.isInteger(requested) || requested < 1) return DEFAULT_MAX_BODY_BYTES;
  return Math.min(requested, MAX_MAX_BODY_BYTES);
}

/** This site's own app, listening on a per-call loopback origin until `close` is awaited. */
export interface LoopbackSiteServer {
  /** e.g. `http://127.0.0.1:53142` — fixed host, ephemeral port, no trailing slash. */
  readonly origin: string;
  close(required?: {}, optional?: {}): Promise<void>;
}

/**
 * Boots the site's real app on an ephemeral `127.0.0.1` port. Shared by `fetch_published_page` and
 * `web_screenshot_page`'s own-site mode, so both observe the one render path the static exporter uses.
 * The caller owns the lifetime: `close()` in a `finally` (see {@link fetchPublishedPage} for why a
 * per-call server rather than a long-lived one).
 * @param required.deps - Supplies `createSiteApp` and an optional `createServer`.
 * @param optional.themeId - Render this site through that installed theme instead of the active one
 *   (`createSiteApp({ themeId })`); the caller checks it exists. Never reachable from a visitor: it is
 *   an option of this one throwaway app, not anything a request carries.
 * @param optional.consentAudit - Build the app without the cookie consent layer, so a screenshot shows
 *   the page rather than the banner over it. Same reach as `themeId`: this throwaway app only.
 * @complexity O(1) beyond one app construction.
 */
export async function openLoopbackSiteServer(
  { deps }: { deps: Pick<FetchPublishedPageDeps, "createSiteApp" | "createServer"> },
  { themeId, consentAudit }: { themeId?: string; consentAudit?: true } = {},
): Promise<LoopbackSiteServer> {
  const server = (deps.createServer ?? createServer)(deps.createSiteApp({ ...(themeId === undefined ? {} : { themeId }), ...(consentAudit ? { consentAudit } : {}) }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    origin: `${LOOPBACK_HOST}:${address.port}`,
    async close() {
      server.closeAllConnections?.();
      // Resolves once the server is fully closed. Mirrors `Jini packages/devops/src/static-export/node-adapters.ts`'s own teardown.
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Maps transport aborts to the published-page error while leaving body-read failures unchanged. */
async function requestPublishedPage({ deps, baseUrl, path, timeoutMs }: {
  deps: FetchPublishedPageDeps; baseUrl: string; path: string; timeoutMs: number;
}, _options: Record<string, never> = {}): Promise<Response> {
  try {
    // The default global `fetch` is read per call, so a test that swaps it is still honored.
    const { fetch = globalThis.fetch } = deps;
    const send = deps.trackFetch({ fetch, observability: deps.observability ?? UNTRACED });
    return await send(`${baseUrl}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      const timeout = new Error(`rendering '${path}' exceeded ${timeoutMs}ms`, { cause: err });
      timeout.name = "PublishedPageTimeoutError";
      throw timeout;
    }
    throw err;
  }
}

/**
 * Fetches one route of this site's own published surface and reports exactly what came back.
 *
 * Boots the site's real Express app on an ephemeral loopback port for the duration of ONE call,
 * requests the validated path, and tears the server down in a `finally` — the same lifecycle
 * the host's static site exporter uses to render a static export, so this observes the real render path
 * rather than a second, agreeing-today copy of it.
 *
 * A per-call server rather than a memoized one is deliberate: a long-lived listening socket in the
 * agent daemon would be a resource with no owner, and the cost here (route registration plus a
 * loopback round trip) is nothing against the LLM turn that requested it.
 *
 * @param deps - Supplies `createSiteApp` (see {@link FetchPublishedPageDeps} for why the signature
 * is written the way it is).
 * @param input.path - A root-relative path on this site, e.g. `/` or `/blog/hello?page=2`.
 * @param options.maxBytes - Body bytes to keep, clamped to `[1, MAX_MAX_BODY_BYTES]`.
 * @param options.timeoutMs - Wall clock for the whole call, default {@link DEFAULT_FETCH_TIMEOUT_MS}.
 * @returns A {@link PublishedPageResult}. A 404 or 30x is a RESULT, not an error — the caller
 * asked what is live, and "nothing is there" is a true answer.
 * @throws {SameOriginPathError} When `path` fails {@link resolveSitePath}.
 * @throws {Error} Named `PublishedPageTimeoutError` when the render exceeds `timeoutMs`.
 * @complexity O(min(B, maxBytes)) in the rendered response size, plus one Express app construction.
 * @example
 * const live = await fetchPublishedPage({ deps: routeDeps, input: { path: "/privacy" } }, { maxBytes: 50_000 });
 * if (live.status === 404) console.log("no privacy policy is published");
 */
export async function fetchPublishedPage(
  { deps, input }: { deps: FetchPublishedPageDeps; input: { path: string } },
  options: FetchPublishedPageOptions = {},
): Promise<PublishedPageResult> {
  const maxBytes = resolveMaxBytes({ requested: options.maxBytes });
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  const site = await openLoopbackSiteServer({ deps });
  const baseUrl = site.origin;

  try {
    // Validated against the origin this call just minted — see `resolveSitePath`'s doc.
    const path = resolveSitePath({ raw: input.path, base: baseUrl, reservedSegments: deps.reservedSegments });

    const response = await requestPublishedPage({ deps, baseUrl, path, timeoutMs });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      // `set-cookie` is reported separately, with values stripped — see this file's header.
      if (key.toLowerCase() !== "set-cookie") headers[key.toLowerCase()] = value;
    });

    const raw = await readBoundedBody({ response, maxBytes: options.textOnly || options.find !== undefined ? MAX_MAX_BODY_BYTES : maxBytes });
    // Preserve exact byte accounting/decoding for legacy reads, including split UTF-8.
    const legacy = !options.textOnly && options.find === undefined;
    const shaped = legacy ? raw : shapePageBody({ body: raw.body }, { ...options, maxBytes });

    return {
      path,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      headers,
      cookies: toCookieShapes({ headers: response.headers }),
      ...shaped,
      truncated: raw.truncated || shaped.truncated,
    };
  } finally {
    await site.close();
  }
}
