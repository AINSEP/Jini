import { ToolInputError } from "@jini-ai/core";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import {
  OriginNotVerifiedError,
  type OriginRegistryPort,
} from "@jini-ai/core/contracts/server/verified-origin";
import { readPageBodyOptions, shapePageBody, DEFAULT_MAX_BODY_BYTES, MAX_MAX_BODY_BYTES, type PageBodyOptions } from "./page-body.js";
import { SameOriginPathError as PublishedPagePathError } from "./path-guard.js";
import { toCookieShapes } from "./cookie-shapes.js";
import type { PublishedPageResult } from "./published-page.js";
import { resolveSitePath } from "./site-path-policy.js";

/** One publish-peer row as far as live-origin selection reads it; `sealed` is null for an unkeyed row. */
export interface LivePeerRow { readonly baseUrl: string; readonly sealed: unknown }
/** The publish-history slice this file reads: distinct live URLs recorded for one workspace. */
export interface LivePublishHistory { listLiveUrls(input: { workspaceId: string }): Promise<readonly string[]> }
/** The peer-repository slice this file reads. */
export interface LivePeerRepo { listByWorkspace(input: { workspaceId: string }): Promise<readonly LivePeerRow[]> }
/**
 * The host's publish-peer rule: which unkeyed row is the connected destination. The returned row is
 * compared by identity against the rows it was handed, so it must be one of them, never a copy.
 */
export interface LiveOriginPolicy {
  selectConnectedDestination(required: { rows: readonly LivePeerRow[] }, _optional?: Record<string, never>): LivePeerRow | null;
}
/** The guarded HTTP client slice this file calls: one request, one bounded response. */
export interface LiveHttpClient { send(request: HttpRequest): Promise<HttpResponse> }
/** Recognizes the host egress guard's refusal; only its caller-safe text reaches the model. */
export type LiveEgressRefusal = (error: unknown) => error is { callerSafeMessage: string };

/** Read ports only; missing ports on a test/older composition do not invent an address. */
export interface LiveOriginSourceDeps {
  workspaceId: string;
  publishContentPeerRepo?: LivePeerRepo;
  publishHistoryStore?: LivePublishHistory;
  originRegistry?: Pick<OriginRegistryPort, "canonicalOrigin">;
}
export interface FetchLiveUrlDeps {
  /** Fresh workspace-scoped reads, never request Host or a caller-supplied arbitrary URL. */
  listKnownOrigins(): Promise<readonly string[]>;
  /** The shared guarded client with redirects disabled and a raw 1 MB ceiling. */
  httpClient: LiveHttpClient;
  /** The host's reserved first path segments (its routing `RESERVED_SEGMENTS`), never fetched live. */
  reservedSegments: ReadonlySet<string>;
  /** The host egress guard's refusal test; a match is projected as a model-visible input error. */
  isEgressRefusal: LiveEgressRefusal;
  /** Optional host instrumentation; receives no body, headers, credentials or query parameters. */
  observeFetch?: (event: { origin: string; status?: number; durationMs: number; outcome: "response" | "refused" | "failed" }) => void;
}
export interface FetchLiveUrlInput extends PageBodyOptions { path: string; origin?: string }
export type LivePageResult = PublishedPageResult & { url: string; origin: string; redirects: string[]; untrusted: true; location?: string };
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const NO_LIVE_ADDRESS = "fetch_live_url: this site has no known live address yet. Publish it first, or use fetch_published_page to check the local render.";
const DEADLINE_MESSAGE = "fetch_live_url: fetching the live page exceeded 15000ms. Check the hosting service before retrying.";

/** Normalizes saved URLs to origins; embedded credentials never become an allowed origin. */
function liveOrigin({ raw }: { raw: string }, _optional = {}): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ToolInputError({ message: "fetch_live_url: a saved live address is invalid. Correct the publishing address and retry." }); }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) throw new ToolInputError({ message: "fetch_live_url: live origins must use HTTPS on port 443 without credentials." });
  return url.origin;
}

/** Reads connected + keyed peers, full-ledger publish URL projection, and the trusted configured origin. */
export async function listKnownLiveOrigins(deps: LiveOriginSourceDeps & LiveOriginPolicy, _optional = {}): Promise<string[]> {
  const peers = await deps.publishContentPeerRepo?.listByWorkspace({ workspaceId: deps.workspaceId }) ?? [];
  const connected = deps.selectConnectedDestination({ rows: peers });
  const urls = peers.filter(peer => peer.sealed !== null || peer === connected).map(peer => peer.baseUrl);
  const historyUrls = await deps.publishHistoryStore?.listLiveUrls({ workspaceId: deps.workspaceId }) ?? [];
  if (historyUrls.length > 200) throw new ToolInputError({ message: "fetch_live_url: more than 200 distinct live addresses are recorded. Review the publish history before fetching." });
  urls.push(...historyUrls);
  urls.push(...await configuredLiveOrigins(deps));
  return [...new Set(urls.map((raw) => liveOrigin({ raw })))].sort();
}

/** Reads only explicitly configured trust evidence; absent verification supplies no address. */
async function configuredLiveOrigins({ originRegistry, workspaceId }: LiveOriginSourceDeps, _options: Record<string, never> = {}): Promise<string[]> {
  if (!originRegistry) return [];
  try {
    const configured = await originRegistry.canonicalOrigin({ workspaceId });
    if (configured.source !== "workspace-setting") return [];
    const base = `${configured.scheme}://${configured.host}`;
    const port = configured.port ? `:${configured.port}` : "";
    return [`${base}${port}`];
  } catch (error) {
    if (!(error instanceof OriginNotVerifiedError)) throw error;
    return [];
  }
}

/** Only the origin itself is accepted for explicit selection, never a path/userinfo-bearing URL. */
function selectOrigin({ known, requested }: { known: readonly string[]; requested: string | undefined }, _optional = {}): string {
  const origins = [...new Set(known.map((raw) => liveOrigin({ raw })))].sort();
  if (origins.length === 0) throw new ToolInputError({ message: NO_LIVE_ADDRESS });
  if (requested !== undefined) {
    const normalized = liveOrigin({ raw: requested });
    const explicit = new URL(requested);
    if (explicit.pathname !== "/" || explicit.search || explicit.hash) throw new ToolInputError({ message: `fetch_live_url: origin is not a known live address. Pass one of: ${origins.join(", ")}.` });
    if (!origins.includes(normalized)) throw new ToolInputError({ message: `fetch_live_url: origin is not a known live address. Pass one of: ${origins.join(", ")}.` });
    return normalized;
  }
  if (origins.length > 1) throw new ToolInputError({ message: `fetch_live_url: several live origins are known. Pass origin as one of: ${origins.join(", ")}.` });
  const origin = origins[0];
  if (origin === undefined) throw new ToolInputError({ message: NO_LIVE_ADDRESS });
  return origin;
}

/** Reuses the local path boundary while retaining actionable errors at the assistant boundary. */
function resolveLivePath({ path, origin, reservedSegments }: { path: string; origin: string; reservedSegments: ReadonlySet<string> }, _optional = {}): string {
  try { return resolveSitePath({ raw: path, base: origin, reservedSegments }); }
  catch (error) {
    if (error instanceof PublishedPagePathError) throw new ToolInputError({ message: `fetch_live_url: ${error.message}` });
    throw error;
  }
}

/** Validates raw and resolved same-origin paths before URL normalization can erase traversal. */
function redirectTarget({ location, current, origin, reservedSegments }: { location: string; current: string; origin: string; reservedSegments: ReadonlySet<string> }, _optional = {}): string | null {
  let next: URL;
  try { next = new URL(location, current); }
  catch { throw new ToolInputError({ message: "fetch_live_url: the live site returned an invalid redirect address. Check the hosting service before retrying." }); }
  if (next.origin !== origin) return null;
  if (next.username || next.password) throw new ToolInputError({ message: "fetch_live_url: redirects with embedded credentials are refused." });
  const rawPath = location.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*/i, "").split("#")[0]!; // split always returns a first piece
  resolveLivePath({ path: rawPath.startsWith("/") ? rawPath : "/" + rawPath, origin, reservedSegments });
  resolveLivePath({ path: next.pathname + next.search, origin, reservedSegments });
  next.hash = "";
  return next.href;
}

/**
 * GETs this site's own live copy through the existing pinned-public-peer guard. One 15 s deadline
 * covers origin reads, DNS, redirects and body reads. Cross-origin and fourth redirects are results.
 * @returns Visitor response evidence; third-party text is explicitly untrusted, cookie values omitted.
 * @throws ToolInputError for address selection, unsafe input/egress, or timeout.
 */
export async function fetchLiveUrl(deps: FetchLiveUrlDeps, input: FetchLiveUrlInput, _optional = {}): Promise<LivePageResult> {
  const options = readPageBodyOptions({ input: input as unknown as Record<string, unknown> });
  const deadline = AbortSignal.timeout(15_000);
  return awaitWithDeadline({ work: fetchWithinDeadline({ deps, input, options, deadline }), signal: deadline });
}

/** One bounded operation, including slow repositories and time between redirect hops. */
async function fetchWithinDeadline({ deps, input, options, deadline }: { deps: FetchLiveUrlDeps; input: FetchLiveUrlInput; options: PageBodyOptions; deadline: AbortSignal }, _optional = {}): Promise<LivePageResult> {
  const started = Date.now();
  const origin = selectOrigin({ known: await deps.listKnownOrigins(), requested: input.origin });
  const path = resolveLivePath({ path: input.path, origin, reservedSegments: deps.reservedSegments });
  const rawReadCap = options.textOnly || options.find !== undefined ? MAX_MAX_BODY_BYTES : options.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
  let url = origin + path;
  const redirects: string[] = [];
  for (;;) {
    deadline.throwIfAborted();
    const response = await sendPage({ deps, url, signal: deadline, timeoutMs: Math.max(1, 15_000 - (Date.now() - started)), maxResponseBytes: rawReadCap });
    const headers = pageHeaders(response);
    const location = headers.location;
    if (REDIRECTS.has(response.status) && location && redirects.length < 3) {
      const next = redirectTarget({ location, current: url, origin, reservedSegments: deps.reservedSegments });
      if (next !== null) { redirects.push(next); url = next; continue; }
    }
    return livePageResult({ response, headers, options, url, origin, redirects });
  }
}

/** Header names are case-insensitive; cookie values are projected separately. */
function pageHeaders({ headers }: HttpResponse, _options: Record<string, never> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "set-cookie") result[key.toLowerCase()] = value;
  }
  return result;
}

/** Shapes the final hop, retaining both upstream and local truncation evidence. */
function livePageResult({ response, headers, options, url, origin, redirects }: {
  response: HttpResponse; headers: Record<string, string>; options: PageBodyOptions;
  url: string; origin: string; redirects: string[];
}, _options: Record<string, never> = {}): LivePageResult {
  const cookies = new Headers();
  for (const cookie of response.setCookies ?? []) cookies.append("set-cookie", cookie);
  const raw = Buffer.from(response.bodyText).subarray(0, MAX_MAX_BODY_BYTES).toString("utf8");
  const shaped = shapePageBody({ body: raw }, options);
  const location = headers.location;
  return { path: new URL(url).pathname + new URL(url).search, status: response.status, ok: response.status >= 200 && response.status < 300, headers, cookies: toCookieShapes({ headers: cookies }), ...shaped, truncated: shaped.truncated || response.bodyTruncated === true || Buffer.byteLength(response.bodyText) > MAX_MAX_BODY_BYTES, url, origin, redirects, untrusted: true, ...(REDIRECTS.has(response.status) && location ? { location } : {}) };
}

/** Caller-safe egress refusals, following media-import's policy-error projection without leaking IPs. */
async function sendPage({ deps, url, signal, timeoutMs, maxResponseBytes }: { deps: FetchLiveUrlDeps; url: string; signal: AbortSignal; timeoutMs: number; maxResponseBytes: number }, _optional = {}) {
  const started = Date.now();
  try {
    const response = await deps.httpClient.send({ method: "GET", url, headers: {}, timeoutMs, signal, maxResponseBytes });
    deps.observeFetch?.({ origin: new URL(url).origin, status: response.status, durationMs: Date.now() - started, outcome: "response" });
    return response;
  } catch (error) {
    deps.observeFetch?.({ origin: new URL(url).origin, durationMs: Date.now() - started, outcome: deps.isEgressRefusal(error) ? "refused" : "failed" });
    if (deps.isEgressRefusal(error)) throw new ToolInputError({ message: `fetch_live_url: ${error.callerSafeMessage}` });
    if (signal.aborted) throw new ToolInputError({ message: DEADLINE_MESSAGE });
    throw error;
  }
}

/** Bounds the whole operation while releasing its listener on either completion path. */
async function awaitWithDeadline<T>({ work, signal }: { work: Promise<T>; signal: AbortSignal }, _optional = {}): Promise<T> {
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      abort = () => reject(new ToolInputError({ message: DEADLINE_MESSAGE }));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { if (abort) signal.removeEventListener("abort", abort); }
}
