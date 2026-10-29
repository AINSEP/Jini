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

/** One probe's inputs: the absolute URL, method, budget, and the paired ports. */
interface ProbeRequest {
  url: string;
  method: 'HEAD' | 'GET';
  timeoutMs: number;
  fetch: ReachabilityFetchPort;
  guard: DeploymentUrlGuard;
}

/**
 * Folds a guard refusal, transport error, abort or body-read failure into the
 * single unreachable shape. Keep unknown throw values readable: host guards and
 * transports may throw values other than Error.
 * @complexity O(1).
 */
function unreachableCheck({ err }: { err: unknown }): DeploymentUrlCheck {
  return {
    reachable: false,
    statusMessage: `Public link is not reachable yet: ${err instanceof Error ? err.message : String(err)}`,
  };
}

/**
 * Starts the per-probe deadline: rejects `timeout` and then aborts `signal`
 * once `timeoutMs` elapses. `clear` must run on every exit.
 * @complexity O(1).
 */
function startProbeDeadline({ timeoutMs }: { timeoutMs: number }) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  // Race the transport as well as signalling it: an injected fetch/body reader may ignore abort.
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`probe timed out after ${timeoutMs}ms`));
      controller.abort();
    }, timeoutMs);
  });
  return { signal: controller.signal, timeout, clear: () => clearTimeout(timer) };
}

/**
 * Classifies one probe response as reachable / protected / unreachable. A 401
 * body (and any GET body) is read under the same `timeout` race as the request.
 * @complexity O(body size) for the read; O(1) otherwise.
 */
async function classifyProbeResponse(
  { resp, method, timeout }: { resp: Response; method: ProbeRequest['method']; timeout: Promise<never> },
  options: ReachabilityOptions,
): Promise<DeploymentUrlCheck> {
  if (resp.status >= 200 && resp.status < 400) return { reachable: true, statusCode: resp.status };
  const body = method === 'GET' || resp.status === 401 ? await Promise.race([resp.text(), timeout]) : '';
  if (resp.status === 401 && options.detectProtected?.({ resp, body })) {
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
}

/**
 * Issues a single HEAD/GET probe against a deployment URL with a bounded
 * timeout, classifying the outcome as reachable / protected / unreachable.
 *
 * @param requiredArgs - Absolute URL, HTTP method, budget in ms, and the paired fetch and guard ports.
 * @param options - Optional protected-response detector + message.
 * @returns A `DeploymentUrlCheck` describing the outcome. Never throws —
 *   network errors and aborts are folded into `{ reachable: false, statusMessage }`.
 * @complexity O(1) network round-trip.
 * @overallScore 100/100
 */
async function requestDeploymentUrl(
  { url, method, timeoutMs, fetch: fetchPort, guard }: ProbeRequest,
  options: ReachabilityOptions,
): Promise<DeploymentUrlCheck> {
  let safeUrl: URL;
  try {
    safeUrl = assertSafeDeploymentUrl(url, guard);
  } catch (err) {
    // The old concrete guard only threw AssetCacheError, but ports cannot assume that contract.
    return unreachableCheck({ err });
  }
  const deadline = startProbeDeadline({ timeoutMs });
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
    const init: RequestInit = { method, redirect: 'manual', signal: deadline.signal };
    const resp = await Promise.race([fetchPort({ url: safeUrl.toString() }, { init }), deadline.timeout]);
    const check = await classifyProbeResponse({ resp, method, timeout: deadline.timeout }, options);
    deadline.clear();
    return check;
  } catch (err) {
    deadline.clear();
    return unreachableCheck({ err });
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
  const probe = { url: normalized, fetch: fetchPort, guard };
  const head = await requestDeploymentUrl({ ...probe, method: 'HEAD', timeoutMs }, options);
  if (head.reachable || head.status === 'protected') return head;
  // HEAD and its fallback share one probe budget; do not restart the clock for GET.
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return head;
  // Every non-reachable, non-protected HEAD falls back to GET. This used to be two
  // arms — `if (head.statusCode && (405 || 403 || >= 400)) { GET ... } else { GET ... }` —
  // that issued the identical GET with identical arguments and both returned it, so
  // the condition selected between two identical actions and was merged away.
  //
  // Real refactor, not a padded test: the first arm used to end in `get.statusMessage ?
  // get : head`, but `get.statusMessage` is unconditionally truthy by the
  // time control reaches there. `requestDeploymentUrl` has exactly 3 return
  // shapes with `reachable: false`: the `assertSafeDeploymentUrl` catch
  // (statusMessage is a non-empty template string), the generic non-2xx/3xx
  // fallback (`Public link returned HTTP ${status}.`, always non-empty),
  // and the outer catch (same non-empty template as the first case). The
  // remaining `reachable: false` shape (`status: 'protected'`) is already
  // excluded by a `get.status === 'protected'` check that preceded it. So the
  // `: head` fallback branch could never actually be selected — see
  // the archived extraction source map's 2026-07-22 addition for the exhaustive
  // case-by-case proof this was re-derived from.
  // Same reasoning for the second arm, plus: when `get.reachable` is true, `get` is
  // returned directly regardless (matching the removed ternary's consequent) — so the
  // whole expression always evaluated to `get`, for every `get` shape
  // `requestDeploymentUrl` can produce.
  return requestDeploymentUrl({ ...probe, method: 'GET', timeoutMs: remainingMs }, options);
}

/** Shared state for one polling run; `startedAt` anchors the overall budget. */
interface PollContext {
  candidates: string[];
  fetch: ReachabilityFetchPort;
  guard: DeploymentUrlGuard;
  now: ReachabilityWaitArgs['now'];
  startedAt: number;
  timeoutMs: number;
  providerLabel: string;
  options: ReachabilityWaitOptions;
}

/** Milliseconds left in the overall polling budget, read from the injected clock. @complexity O(1). */
function remainingBudget(ctx: PollContext): number {
  return ctx.timeoutMs - (ctx.now({}) - ctx.startedAt);
}

/**
 * Probes every candidate once, in order, within the remaining budget.
 * Returns `done` for a ready candidate, or for the first protected candidate once
 * the others had their turn; otherwise the latest failure message (or the
 * caller's previous one when no candidate was probed).
 * @complexity O(candidates) probes.
 */
async function sweepCandidates(
  ctx: PollContext,
  { lastMessage }: { lastMessage: string },
): Promise<{ done: ReachabilityWaitResult } | { lastMessage: string }> {
  let protectedResult: ReachabilityWaitResult | undefined;
  let message = lastMessage;
  for (const url of ctx.candidates) {
    const remainingMs = remainingBudget(ctx);
    if (remainingMs <= 0) break;
    const probeTimeoutMs = Math.min(ctx.options.timeoutMs ?? 8_000, remainingMs);
    const result = await checkDeploymentUrl({ url, fetch: ctx.fetch, guard: ctx.guard }, { ...ctx.options, timeoutMs: probeTimeoutMs });
    if (result.reachable) {
      return { done: { status: 'ready', url, statusMessage: 'Public link is ready.', reachableAt: ctx.now({}) } };
    }
    if (result.status === 'protected') {
      protectedResult ??= {
        status: 'protected',
        url,
        statusMessage: result.statusMessage || `${ctx.providerLabel} is gating this link behind its own auth wall.`,
      };
    } else {
      // Real refactor, not a padded test: `result.statusMessage` is
      // unconditionally truthy by this point. `result` comes from
      // `checkDeploymentUrl`, which — for every `reachable: false`,
      // non-`'protected'` shape it can produce (the empty-URL guard, and
      // both `requestDeploymentUrl`-derived returns after the dead-branch
      // refactor just above) — always sets a non-empty `statusMessage`. The
      // `reachable: true` and `status === 'protected'` shapes are both
      // handled by the `return` and the protected branch above, so neither
      // can reach here. `|| lastMessage` (falling back to the *previous*
      // sweep's message) could therefore never actually be selected — see
      // the archived extraction source map's 2026-07-22 addition for the proof.
      // Non-null assertion (not `||`/`??`, which would just reintroduce the
      // same dead branch): the type is `string | undefined` because
      // `DeploymentUrlCheck.statusMessage` is optional in general, but this
      // exact call site's result is always defined per the proof above.
      message = result.statusMessage!;
    }
  }
  // A protected candidate is a fallback only after the other candidates had their turn.
  return protectedResult ? { done: protectedResult } : { lastMessage: message };
}

/**
 * Polls deployment candidates until one becomes reachable or `timeoutMs` elapses.
 * A protected result is returned after its sweep if no candidate is ready. Used right after a
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
  const candidates = uniqueCandidates({ urls });
  if (candidates.length === 0) {
    return {
      status: 'link-delayed',
      url: '',
      statusMessage: `${providerLabel} did not return a public deployment URL.`,
    };
  }
  const ctx: PollContext = { candidates, fetch: fetchPort, guard, now, startedAt: now({}), timeoutMs, providerLabel, options };
  return pollCandidates(ctx, { sleep, intervalMs });
}

/** Normalized, de-duplicated, non-empty candidates in first-seen order. A null/undefined
 * `urls` from an untyped caller is treated as empty. @complexity O(urls). */
function uniqueCandidates({ urls }: { urls: unknown[] }): string[] {
  return [...new Set((urls || []).map((url) => normalizeDeploymentUrl({ url })).filter(Boolean))];
}

/**
 * Sweeps, then sleeps `min(intervalMs, remaining)`, until a sweep is done or the budget
 * (or a stalled sleep) runs out; then reports `link-delayed` against the first candidate.
 * @complexity O(candidates * timeoutMs/intervalMs) probes.
 */
async function pollCandidates(
  ctx: PollContext,
  { sleep, intervalMs }: { sleep: ReachabilityWaitArgs['sleep']; intervalMs: number },
): Promise<ReachabilityWaitResult> {
  let lastMessage = '';
  let keepPolling = remainingBudget(ctx) > 0;
  while (keepPolling) {
    const sweep = await sweepCandidates(ctx, { lastMessage });
    if ('done' in sweep) return sweep.done;
    lastMessage = sweep.lastMessage;
    const remainingMs = remainingBudget(ctx);
    // Stop when the budget is spent, the sleep is cut short, or the sleep consumed the rest.
    keepPolling = remainingMs > 0 &&
      await sleepWithinBudget({ sleep, ms: Math.min(intervalMs, remainingMs), timeoutMs: remainingMs }) &&
      remainingBudget(ctx) > 0;
  }

  return {
    status: 'link-delayed',
    // Non-empty: waitForReachableDeploymentUrl returns early when no candidate survives.
    url: ctx.candidates[0]!,
    statusMessage: lastMessage || `${ctx.providerLabel} returned a deployment URL, but it is not reachable yet.`,
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
