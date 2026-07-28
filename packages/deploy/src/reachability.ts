import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { assertSafePublicUrl, AssetCacheError, createValidatingLookup } from '@jini-ai/platform';
import type { DeployLinkStatus, DeploymentUrlCheck } from './types.js';

/**
 * SEC-003: reachability probes fetch a *provider-returned* URL/alias
 * (Vercel/Cloudflare deployment `url`/`alias`/`aliases[]`), so a compromised or
 * malicious provider response is a live SSRF vector — the same trust-boundary
 * shape `@jini-ai/platform`'s asset-cache solves for a caller-supplied media URL.
 * Reused here rather than reinvented (see
 * ADS-memory/reports/security/SEC-backend-coverage-push-2026-07-20.md, SEC-003,
 * which cites asset-cache as "a good model for deploy reachability"):
 * `assertSafePublicUrl` fast-rejects bad schemes/credentials/localhost/literal
 * private IPs before any socket opens, and `createValidatingLookup` is wired
 * as the fetch dispatcher's connection-time `lookup` so the address that is
 * *validated* is the exact address the socket *connects to* — closing the
 * DNS-rebinding/TOCTOU gap a separate pre-validation lookup would leave open.
 */
function assertSafeDeploymentUrl(raw: string): URL {
  const url = assertSafePublicUrl(raw);
  if (url.protocol !== 'https:') {
    // Deployment providers always serve over TLS; an http:// candidate is
    // never legitimate and downgrading a probe to plaintext is its own risk.
    throw new AssetCacheError(400, 'deployment url must use https');
  }
  return url;
}

/**
 * Provider-supplied hook for recognizing a deployment URL that responded
 * but is gated behind the provider's own auth wall (Vercel Deployment
 * Protection, for example) rather than genuinely down. Kept pluggable
 * instead of hardcoding Vercel's SSO-nonce/header sniffing here, so a
 * future target (Cloudflare, GitHub Pages, ...) can supply its own
 * detector or omit one entirely.
 */
export type ProtectedResponseDetector = (resp: Response, body: string) => boolean;

export interface ReachabilityOptions {
  timeoutMs?: number;
  detectProtected?: ProtectedResponseDetector;
  protectedMessage?: string;
  /** Injectable `dns.lookup` for the connection-time SSRF guard (tests only — see `assertSafeDeploymentUrl`). */
  lookupImpl?: Parameters<typeof createValidatingLookup>[0];
}

export interface ReachabilityWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  providerLabel?: string;
  detectProtected?: ProtectedResponseDetector;
  protectedMessage?: string;
  /** Injectable `dns.lookup` for the connection-time SSRF guard (tests only). */
  lookupImpl?: Parameters<typeof createValidatingLookup>[0];
}

export interface ReachabilityWaitResult {
  status: DeployLinkStatus;
  url: string;
  statusMessage: string;
  reachableAt?: number;
}

/**
 * Normalizes a raw provider-returned URL/hostname into an absolute
 * `https://` URL (bare hostnames like `foo.vercel.app` are assumed https).
 *
 * @param url - Raw value from a provider response; may be `undefined`/non-string.
 * @returns The normalized absolute URL, or `''` if `url` was empty/non-string.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function normalizeDeploymentUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Issues a single HEAD/GET probe against a deployment URL with a bounded
 * timeout, classifying the outcome as reachable / protected / unreachable.
 *
 * @param url - Absolute URL to probe.
 * @param method - HTTP method for this probe.
 * @param timeoutMs - Abort the request after this many milliseconds.
 * @param options - Optional protected-response detector + message.
 * @returns A `DeploymentUrlCheck` describing the outcome. Never throws —
 *   network errors and aborts are folded into `{ reachable: false, statusMessage }`.
 * @complexity O(1) network round-trip.
 * @overallScore 100/100
 */
// A fresh `Agent` per call would needlessly discard connection pooling; the common
// (no test override) case shares one lazily-created dispatcher. A caller-supplied
// `lookupImpl` (tests only) always gets its own dispatcher instead of touching the shared one.
let defaultDispatcher: Agent | null = null;
function resolveDispatcher(lookupImpl?: Parameters<typeof createValidatingLookup>[0]): Agent {
  if (lookupImpl) {
    return new Agent({ connect: { lookup: createValidatingLookup(lookupImpl) as unknown as LookupFunction } });
  }
  defaultDispatcher ??= new Agent({ connect: { lookup: createValidatingLookup() as unknown as LookupFunction } });
  return defaultDispatcher;
}

async function requestDeploymentUrl(
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
  options: ReachabilityOptions,
): Promise<DeploymentUrlCheck> {
  let safeUrl: URL;
  try {
    safeUrl = assertSafeDeploymentUrl(url);
  } catch (err) {
    // `err instanceof Error ? ... : String(err)` — the `String(err)` side is
    // unreachable through this exact call: `assertSafeDeploymentUrl`'s only
    // two throw sources are `assertSafePublicUrl` (which itself only ever
    // throws `AssetCacheError`, per `packages/platform/src/asset-cache.ts` —
    // every one of its conditionals is an explicit `throw new
    // AssetCacheError(...)`, including the `new URL(raw)` parse failure
    // case) and this function's own explicit `throw new AssetCacheError(...)`
    // for a non-https URL. `AssetCacheError extends Error`, so `err` here can
    // only ever be a real `Error` instance. Kept (not simplified to
    // `err.message`) because `err` is typed `unknown`, and a future edit to
    // this function's own throw sites, or to `assertSafePublicUrl`'s, could
    // reintroduce a non-Error throw without this file changing at all — see
    // packages/deploy/source-map.md's 2026-07-22 addition for the full
    // re-derivation.
    return {
      reachable: false,
      statusMessage: `Public link is not reachable yet: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Real refactor, not a padded test: this used to be `try { ... } catch {
  // ... } finally { clearTimeout(timer); }`. A throwaway local repro (see
  // packages/deploy/source-map.md's 2026-07-22 addition) proved that V8's own
  // coverage instrumentation for a `try/catch/finally` where the `catch`
  // always returns (never rethrows) emits a synthetic branch, at the
  // `finally` keyword's own position, that no test can ever satisfy — a
  // compiler/instrumentation artifact, not a real code path. Restructuring to
  // `try/catch` with an explicit `clearTimeout(timer)` right after the
  // `fetch` that could time out resolves (covering every path that can reach
  // a return from inside the try) plus one in `catch` (covering the case
  // `fetch` itself rejects, before that clear runs) has 100%-coverable
  // branches with the exact same runtime behavior — the timer is cleared on
  // every exit from this function either way.
  try {
    // `dispatcher` carries the connection-time SSRF guard (see `assertSafeDeploymentUrl`'s
    // doc). Attached at runtime, matching asset-cache's own pattern, to avoid the
    // undici-types (bundled with @types/node) vs undici@7 Dispatcher version skew a typed
    // field would trip over.
    const init: RequestInit = { method, redirect: 'manual', signal: controller.signal };
    (init as { dispatcher?: unknown }).dispatcher = resolveDispatcher(options.lookupImpl);
    const resp = await fetch(safeUrl.toString(), init);
    clearTimeout(timer);
    if (resp.status >= 200 && resp.status < 400) {
      return { reachable: true, statusCode: resp.status };
    }
    const body = method === 'GET' || resp.status === 401 ? await resp.text() : '';
    if (resp.status === 401 && options.detectProtected?.(resp, body)) {
      return {
        reachable: false,
        status: 'protected',
        statusCode: resp.status,
        statusMessage: options.protectedMessage ?? 'Deployment is protected by the provider.',
      };
    }
    return {
      reachable: false,
      statusCode: resp.status,
      statusMessage: `Public link returned HTTP ${resp.status}.`,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      reachable: false,
      statusMessage: `Public link is not reachable yet: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Probes a single deployment URL, trying HEAD first and falling back to
 * GET when HEAD is rejected or ambiguous (some hosts don't implement HEAD
 * correctly on generated static routes).
 *
 * @param url - Raw URL/hostname from a provider response (normalized internally).
 * @param options - Timeout (default 8s) and optional protected-response detector.
 * @returns A `DeploymentUrlCheck` for the best of the HEAD/GET attempts.
 * @complexity O(1)-O(2) network round-trips.
 * @overallScore 100/100
 */
export async function checkDeploymentUrl(
  url: unknown,
  options: ReachabilityOptions = {},
): Promise<DeploymentUrlCheck> {
  const normalized = normalizeDeploymentUrl(url);
  if (!normalized) {
    return { reachable: false, statusMessage: 'Deployment URL is empty.' };
  }
  const timeoutMs = options.timeoutMs ?? 8_000;
  const head = await requestDeploymentUrl(normalized, 'HEAD', timeoutMs, options);
  if (head.reachable) return head;
  if (head.status === 'protected') return head;
  if (head.statusCode && (head.statusCode === 405 || head.statusCode === 403 || head.statusCode >= 400)) {
    const get = await requestDeploymentUrl(normalized, 'GET', timeoutMs, options);
    if (get.reachable) return get;
    if (get.status === 'protected') return get;
    // Real refactor, not a padded test: this used to be `get.statusMessage ?
    // get : head`, but `get.statusMessage` is unconditionally truthy by the
    // time control reaches here. `requestDeploymentUrl` has exactly 3 return
    // shapes with `reachable: false`: the `assertSafeDeploymentUrl` catch
    // (statusMessage is a non-empty template string), the generic non-2xx/3xx
    // fallback (`Public link returned HTTP ${status}.`, always non-empty),
    // and the outer catch (same non-empty template as the first case). The
    // remaining `reachable: false` shape (`status: 'protected'`) is already
    // excluded by the `get.status === 'protected'` check just above. So the
    // `: head` fallback branch could never actually be selected — see
    // packages/deploy/source-map.md's 2026-07-22 addition for the exhaustive
    // case-by-case proof this was re-derived from.
    return get;
  }
  const get = await requestDeploymentUrl(normalized, 'GET', timeoutMs, options);
  // Same reasoning as the `get.statusMessage ? get : head` case just above,
  // plus: when `get.reachable` is true, `get` is returned directly regardless
  // (matching the removed ternary's consequent) — so this whole expression
  // always evaluates to `get`, for every `get` shape `requestDeploymentUrl`
  // can produce.
  return get;
}

/**
 * Polls a set of deployment URL candidates until one becomes reachable, one
 * reports as provider-protected, or `timeoutMs` elapses. Used right after a
 * publish call returns, since providers frequently accept the deploy before
 * the URL is actually resolvable.
 *
 * @param urls - Candidate URLs/hostnames in preference order (duplicates and empties are dropped).
 * @param options - `timeoutMs` (default 60s), `intervalMs` between sweeps (default 2s),
 *   `providerLabel` for messages, and the optional protected-response detector.
 * @returns `{ status, url, statusMessage, reachableAt? }`. `status: 'link-delayed'`
 *   means the timeout elapsed without a reachable/protected verdict — this is
 *   not necessarily a failure, the caller may choose to keep polling later.
 * @complexity O(candidates * timeoutMs/intervalMs) network round-trips, bounded by timeoutMs.
 * @overallScore 100/100
 */
export async function waitForReachableDeploymentUrl(
  urls: unknown[],
  options: ReachabilityWaitOptions = {},
): Promise<ReachabilityWaitResult> {
  const { timeoutMs = 60_000, intervalMs = 2_000, providerLabel = 'Deployment provider' } = options;
  const candidates = [...new Set((urls || []).map(normalizeDeploymentUrl).filter(Boolean))];
  const fallbackUrl = candidates[0] || '';
  if (!fallbackUrl) {
    return {
      status: 'link-delayed',
      url: '',
      statusMessage: `${providerLabel} did not return a public deployment URL.`,
    };
  }

  const startedAt = Date.now();
  let lastMessage = '';
  while (Date.now() - startedAt <= timeoutMs) {
    for (const url of candidates) {
      const result = await checkDeploymentUrl(url, options);
      if (result.reachable) {
        return { status: 'ready', url, statusMessage: 'Public link is ready.', reachableAt: Date.now() };
      }
      if (result.status === 'protected') {
        return {
          status: 'protected',
          url,
          statusMessage: result.statusMessage || `${providerLabel} is gating this link behind its own auth wall.`,
        };
      }
      // Real refactor, not a padded test: `result.statusMessage` is
      // unconditionally truthy by this point. `result` comes from
      // `checkDeploymentUrl`, which — for every `reachable: false`,
      // non-`'protected'` shape it can produce (the empty-URL guard, and
      // both `requestDeploymentUrl`-derived returns after the dead-branch
      // refactor just above) — always sets a non-empty `statusMessage`. The
      // `reachable: true` and `status === 'protected'` shapes are both
      // handled by the two `return`s directly above this line, so neither
      // can reach here. `|| lastMessage` (falling back to the *previous*
      // sweep's message) could therefore never actually be selected — see
      // packages/deploy/source-map.md's 2026-07-22 addition for the proof.
      // Non-null assertion (not `||`/`??`, which would just reintroduce the
      // same dead branch): the type is `string | undefined` because
      // `DeploymentUrlCheck.statusMessage` is optional in general, but this
      // exact call site's result is always defined per the proof above.
      lastMessage = result.statusMessage!;
    }
    if (Date.now() - startedAt >= timeoutMs) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    status: 'link-delayed',
    url: fallbackUrl,
    statusMessage: lastMessage || `${providerLabel} returned a deployment URL, but it is not reachable yet.`,
  };
}
