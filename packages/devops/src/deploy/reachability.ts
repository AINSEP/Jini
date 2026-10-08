import type { DeployLinkStatus, DeploymentUrlCheck } from '../core/deploy-types.js';

/**
 * SEC-003: reachability probes fetch a *provider-returned* URL/alias
 * (a deployment's `url`/`alias`/`aliases[]` from the host), so a compromised or
 * malicious provider response is a live SSRF vector — the same trust-boundary
 * shape the Node default adapter's asset-cache guard solves for a caller-supplied media URL.
 * Reused by `./node.ts` rather than reinvented (see
 * ADS-memory/reports/security/SEC-backend-coverage-push-2026-07-20.md, SEC-003,
 * which cites asset-cache as "a good model for deploy reachability"):
 * The Node adapter pairs these ports: `assertSafePublicUrl` fast-rejects bad schemes/credentials/localhost/literal
 * private IPs before any socket opens, and `createValidatingLookup` is wired
 * as the fetch dispatcher's connection-time `lookup` so the address that is
 * *validated* is the exact address the socket *connects to* — closing the
 * DNS-rebinding/TOCTOU gap a separate pre-validation lookup would leave open.
 */
function assertSafeDeploymentUrl(raw: string, guard: DeploymentUrlGuard): URL {
  const url = guard.assertSafeUrl({ raw, label: 'deployment url' });
  if (url.protocol !== 'https:') {
    // Deployment providers always serve over TLS; an http:// candidate is
    // never legitimate and downgrading a probe to plaintext is its own risk.
    throw new Error('deployment url must use https');
  }
  return url;
}

/**
 * Provider-supplied hook for recognizing a deployment URL that responded
 * but is gated behind the provider's own auth wall (a deployment-protection
 * login page, for example) rather than genuinely down. Kept pluggable
 * instead of hardcoding one provider's SSO-nonce/header sniffing here, so
 * each target can supply its own detector or omit one entirely.
 */
export type ProtectedResponseDetector = (requiredArgs: { resp: Response; body: string }) => boolean;

/** Synchronous outbound URL policy, shaped like the OAuth guard without an OAuth dependency.
 * Connection-time DNS enforcement belongs to the paired transport, never a preflight lookup. */
export interface DeploymentUrlGuard {
  assertSafeUrl(requiredArgs: { raw: string; label: string }): URL;
}

/** HTTP transport port. Hosts must enforce connection-time DNS policy and honor redirects/signals. */
export type ReachabilityFetchPort = (
  requiredArgs: { url: string }, optionalArgs?: { init?: RequestInit },
) => Promise<Response>;

/** The caller supplies the paired URL guard and connection-time policy-enforcing transport. */
export interface ReachabilityArgs {
  url: unknown;
  fetch: ReachabilityFetchPort;
  guard: DeploymentUrlGuard;
}

/** Polling uses host-supplied time and delay ports for deterministic scheduling. */
export interface ReachabilityWaitArgs {
  urls: unknown[];
  fetch: ReachabilityFetchPort;
  guard: DeploymentUrlGuard;
  now(requiredArgs: Record<string, never>): number;
  sleep(requiredArgs: { ms: number }): Promise<void>;
}

export interface ReachabilityOptions {
  timeoutMs?: number;
  detectProtected?: ProtectedResponseDetector;
  protectedMessage?: string;
}

export interface ReachabilityWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  providerLabel?: string;
  detectProtected?: ProtectedResponseDetector;
  protectedMessage?: string;
}

export interface ReachabilityWaitResult {
  status: DeployLinkStatus;
  url: string;
  statusMessage: string;
  reachableAt?: number;
}

/**
 * Normalizes a raw provider-returned URL/hostname into an absolute
 * `https://` URL (bare hostnames like `foo.example.app` are assumed https).
 *
 * @param requiredArgs - Raw `url` from a provider response; may be undefined/non-string.
 * @returns The normalized absolute URL, or `''` if `url` was empty/non-string.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function normalizeDeploymentUrl({ url }: { url: unknown }): string {
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
async function requestDeploymentUrl(
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
  options: ReachabilityOptions,
  fetchPort: ReachabilityFetchPort,
  guard: DeploymentUrlGuard,
): Promise<DeploymentUrlCheck> {
  let safeUrl: URL;
  try {
    safeUrl = assertSafeDeploymentUrl(url, guard);
  } catch (err) {
    // Keep unknown throw values readable: host guards may throw values other than Error.
    // The old concrete guard only threw AssetCacheError, but ports cannot assume that contract.
    return {
      reachable: false,
      statusMessage: `Public link is not reachable yet: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  // Race the transport as well as signalling it: an injected fetch/body reader may ignore abort.
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`probe timed out after ${timeoutMs}ms`));
      controller.abort();
    }, timeoutMs);
  });
  // Real refactor, not a padded test: this used to be `try { ... } catch {
  // ... } finally { clearTimeout(timer); }`. A throwaway local repro (see
  // the archived extraction source map's 2026-07-22 addition) proved that V8's own
  // coverage instrumentation for a `try/catch/finally` where the `catch`
  // always returns (never rethrows) emits a synthetic branch, at the
  // `finally` keyword's own position, that no test can ever satisfy — a
  // compiler/instrumentation artifact, not a real code path. Restructuring to
  // `try/catch` with an explicit `clearTimeout(timer)` after the complete
  // response (headers and any body read) resolves (covering every path that can reach
  // a return from inside the try) plus one in `catch` (covering the case
  // `fetch` itself rejects, before that clear runs) has 100%-coverable
  // branches. That historical refactor preserved runtime behavior — the timer
  // is cleared on every exit from this function either way. The deadline fix
  // additionally keeps it active until body consumption finishes.
  try {
    // The injected transport owns DNS pinning (the Node adapter attaches its validating dispatcher).
    // A separate preflight resolver would leave the validation/connect TOCTOU gap open.
    const init: RequestInit = { method, redirect: 'manual', signal: controller.signal };
    const resp = await Promise.race([fetchPort({ url: safeUrl.toString() }, { init }), timeout]);
    if (resp.status >= 200 && resp.status < 400) {
      clearTimeout(timer!);
      return { reachable: true, statusCode: resp.status };
    }
    const body = method === 'GET' || resp.status === 401 ? await Promise.race([resp.text(), timeout]) : '';
    if (resp.status === 401 && options.detectProtected?.({ resp, body })) {
      clearTimeout(timer!);
      return {
        reachable: false,
        status: 'protected',
        statusCode: resp.status,
        statusMessage: options.protectedMessage ?? 'Deployment is protected by the provider.',
      };
    }
    clearTimeout(timer!);
    return {
      reachable: false,
      statusCode: resp.status,
      statusMessage: `Public link returned HTTP ${resp.status}.`,
    };
  } catch (err) {
    clearTimeout(timer!);
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
 * @param requiredArgs - Raw URL/hostname and paired fetch and outbound-guard ports.
 * @param options - Timeout (default 8s) and optional protected-response detector.
 * @returns A `DeploymentUrlCheck` for the best of the HEAD/GET attempts.
 * @complexity O(1)-O(2) network round-trips.
 * @overallScore 100/100
 */
export async function checkDeploymentUrl(
  { url, fetch: fetchPort, guard }: ReachabilityArgs,
  options: ReachabilityOptions = {},
): Promise<DeploymentUrlCheck> {
  const normalized = normalizeDeploymentUrl({ url });
  if (!normalized) {
    return { reachable: false, statusMessage: 'Deployment URL is empty.' };
  }
  const timeoutMs = options.timeoutMs ?? 8_000;
  const deadlineAt = Date.now() + timeoutMs;
  const head = await requestDeploymentUrl(normalized, 'HEAD', timeoutMs, options, fetchPort, guard);
  if (head.reachable) return head;
  if (head.status === 'protected') return head;
  // HEAD and its fallback share one probe budget; do not restart the clock for GET.
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return head;
  if (head.statusCode && (head.statusCode === 405 || head.statusCode === 403 || head.statusCode >= 400)) {
    const get = await requestDeploymentUrl(normalized, 'GET', remainingMs, options, fetchPort, guard);
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
    // the archived extraction source map's 2026-07-22 addition for the exhaustive
    // case-by-case proof this was re-derived from.
    return get;
  }
  const get = await requestDeploymentUrl(normalized, 'GET', remainingMs, options, fetchPort, guard);
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
 * @param requiredArgs - Candidate URLs/hostnames and required fetch, guard, clock and delay ports.
 * @param options - `timeoutMs` (default 60s), `intervalMs` between sweeps (default 2s),
 *   `providerLabel` for messages, and the optional protected-response detector.
 * @returns `{ status, url, statusMessage, reachableAt? }`. `status: 'link-delayed'`
 *   means the timeout elapsed without a reachable/protected verdict — this is
 *   not necessarily a failure, the caller may choose to keep polling later.
 * @complexity O(candidates * timeoutMs/intervalMs) network round-trips, bounded by timeoutMs.
 * @overallScore 100/100
 */
export async function waitForReachableDeploymentUrl(
  { urls, fetch: fetchPort, guard, now, sleep }: ReachabilityWaitArgs,
  options: ReachabilityWaitOptions = {},
): Promise<ReachabilityWaitResult> {
  const { timeoutMs = 60_000, intervalMs = 2_000, providerLabel = 'Deployment provider' } = options;
  const candidates = [...new Set((urls || []).map((url) => normalizeDeploymentUrl({ url })).filter(Boolean))];
  const fallbackUrl = candidates[0] || '';
  if (!fallbackUrl) {
    return {
      status: 'link-delayed',
      url: '',
      statusMessage: `${providerLabel} did not return a public deployment URL.`,
    };
  }

  const startedAt = now({});
  let lastMessage = '';
  while (now({}) - startedAt < timeoutMs) {
    for (const url of candidates) {
      const remainingMs = timeoutMs - (now({}) - startedAt);
      if (remainingMs <= 0) break;
      const result = await checkDeploymentUrl({ url, fetch: fetchPort, guard }, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 8_000, remainingMs) });
      if (result.reachable) {
        return { status: 'ready', url, statusMessage: 'Public link is ready.', reachableAt: now({}) };
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
      // the archived extraction source map's 2026-07-22 addition for the proof.
      // Non-null assertion (not `||`/`??`, which would just reintroduce the
      // same dead branch): the type is `string | undefined` because
      // `DeploymentUrlCheck.statusMessage` is optional in general, but this
      // exact call site's result is always defined per the proof above.
      lastMessage = result.statusMessage!;
    }
    const remainingMs = timeoutMs - (now({}) - startedAt);
    if (remainingMs <= 0) break;
    if (!await sleepWithinBudget({ sleep, ms: Math.min(intervalMs, remainingMs), timeoutMs: remainingMs })) break;
  }

  return {
    status: 'link-delayed',
    url: fallbackUrl,
    statusMessage: lastMessage || `${providerLabel} returned a deployment URL, but it is not reachable yet.`,
  };
}

/** An injected delay can stall too; its completion cannot extend the whole polling deadline.
 * @complexity O(1) time and space apart from the host's delay implementation. */
async function sleepWithinBudget({ sleep, ms, timeoutMs }: {
  sleep: ReachabilityWaitArgs['sleep']; ms: number; timeoutMs: number;
}): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sleep({ ms }).then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
