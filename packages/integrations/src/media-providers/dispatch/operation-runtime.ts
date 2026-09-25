/**
 * The submit-then-poll runtime: the piece that turns a `PollingVendorAdapter` plus an
 * `AsyncOperationStore` into an operation that survives a restart.
 *
 * ## Persist first, then race
 *
 * `startOperation` writes the operation row **before** it issues any HTTP call, then races the
 * in-flight submit against a short interactive grace window. If the vendor answers in time the
 * caller gets `{done: true, result}` in the same round trip — indistinguishable from the
 * synchronous tier. If it does not, the caller gets `{done: false, operationId}` and the *same*
 * in-flight request keeps running and writes its own outcome into the row.
 *
 * That ordering is what makes crash safety fall out for free rather than being bolted on: there is
 * no window in which work exists only inside a process. It is also why this is a race and not a
 * fork — there is exactly one submit code path, and `expectedLatencyClass` only decides how long
 * the caller is willing to wait on it, never what happens.
 *
 * Human callers and agents get the identical contract: a result, or an id to come back with.
 *
 * ## What is deliberately NOT here
 *
 * No scheduler. `pollDueOperations` is a single leased tick a host drives from whatever timer or
 * queue it already runs — this package performs no I/O of its own beyond the vendor calls it is
 * handed a `fetchImpl` for, a standing invariant across `@jini-ai/integrations/media-providers`.
 */
import { FETCH_TIMEOUT_MS, fetchWithTimeout } from '@jini-ai/platform';

import type {
  AsyncOperationError,
  AsyncOperationPatch,
  AsyncOperationRecord,
  AsyncOperationStore,
} from './async-operation-store.js';
import type { AnyPollingVendorAdapter, PollingVendorAdapter, RequestSigner, SubmitOutcome, UnsignedVendorRequest } from './polling-adapter.js';
import type { RenderContext, RenderResult } from './types.js';

/** Interactive budget for the inline attempt. Deliberately NOT `FETCH_TIMEOUT_MS.GENERATE` (10min) — that is the backstop for the *request*, this is the ceiling on making a human wait. */
export const DEFAULT_GRACE_MS = 4_000;
export const DEFAULT_MAX_ATTEMPTS = 60;
export const DEFAULT_DEADLINE_MS = 15 * 60_000;
export const DEFAULT_POLL_INTERVAL_MS = 5_000;
/**
 * Backoff between retries of the write that records a vendor job handle after a successful
 * submit. A handle that made it past the vendor round trip must not be dropped just because the
 * very next write is transiently unlucky — see `startOperation`'s post-submit persistence.
 */
export const DEFAULT_PERSIST_RETRY_DELAYS_MS: readonly number[] = [50, 150, 400];

/** The lease identity used by boot recovery's claim-then-release read, distinct from any real worker. */
const RECOVERY_LEASE_OWNER = '__recovery__';

export interface OperationRuntimeDeps {
  readonly store: AsyncOperationStore;
  readonly signer: RequestSigner;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly newId?: () => string;
  /** Overrides `DEFAULT_PERSIST_RETRY_DELAYS_MS`. Tests pass a short/empty array to avoid real delays. */
  readonly persistRetryDelaysMs?: readonly number[];
}

export interface StartOperationParams<Meta> {
  readonly adapter: PollingVendorAdapter<Meta>;
  readonly ctx: RenderContext;
  readonly providerId: string;
  readonly routeKey: string;
  readonly ownerRef: string;
  readonly maxAttempts?: number;
  readonly deadlineMs?: number;
  readonly graceMs?: number;
}

export type StartOperationOutcome =
  | { readonly done: true; readonly operationId: string; readonly result: RenderResult }
  | { readonly done: false; readonly operationId: string };

function resultToPayload(result: RenderResult) {
  return {
    bytesBase64: result.bytes.toString('base64'),
    providerNote: result.providerNote,
    ...(result.suggestedExt !== undefined ? { suggestedExt: result.suggestedExt } : {}),
  };
}

function toOperationError(error: unknown): AsyncOperationError {
  return { message: error instanceof Error ? error.message : String(error) };
}

async function performSigned(
  deps: OperationRuntimeDeps,
  request: UnsignedVendorRequest<unknown>,
  timeoutMs: number,
): Promise<Response> {
  const signed = await deps.signer(request);
  const doFetch = deps.fetchImpl;
  if (doFetch) return doFetch(signed.url, signed.init);
  return fetchWithTimeout(signed.url, signed.init, { timeoutMs });
}

/** Issues the submit call and parses it. Isolated from persistence so callers can tell "nothing was obtained from the vendor" apart from "a handle was obtained but recording it failed" — only the former is safe to treat as terminal. */
async function submitAndParse<Meta>(
  deps: OperationRuntimeDeps,
  params: StartOperationParams<Meta>,
): Promise<{ readonly ok: true; readonly outcome: SubmitOutcome } | { readonly ok: false; readonly error: unknown }> {
  try {
    const request = params.adapter.buildSubmitRequest(params.ctx);
    const resp = await performSigned(deps, request as UnsignedVendorRequest<unknown>, FETCH_TIMEOUT_MS.GENERATE);
    const outcome = await params.adapter.parseSubmitResponse(resp, params.ctx, request);
    return { ok: true, outcome };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Applies a store patch, retrying on failure per `retryDelaysMs`. Never throws — callers past
 * this point already hold a real vendor job handle or a finished result, so the write is retried
 * rather than let a transient failure fall through to a `'failed'` label that would erase it.
 *
 * @returns Whether the write eventually succeeded. On `false`, the row is left exactly as it was
 *   before this call — for the post-submit write, that means `'submitted'`, which
 *   `recoverAfterRestart`'s crash-gap handling already knows how to reconcile safely, rather than
 *   a `'failed'` row that recovery ignores as terminal.
 * @complexity O(retryDelaysMs.length) store round trips in the worst case.
 */
async function persistWithRetry(
  store: AsyncOperationStore,
  operationId: string,
  patch: AsyncOperationPatch,
  retryDelaysMs: readonly number[],
): Promise<boolean> {
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      await store.update(operationId, patch);
      return true;
    } catch {
      if (attempt === retryDelaysMs.length) return false;
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }
  return false;
}

/**
 * Persists the operation row, issues the submit, and races it against the grace window.
 *
 * @returns `{done: true, result}` when the vendor finished inside the grace window, else
 *   `{done: false, operationId}` — the row is already durable in both cases.
 * @complexity O(1) plus one vendor round trip.
 */
export async function startOperation<Meta>(
  deps: OperationRuntimeDeps,
  params: StartOperationParams<Meta>,
): Promise<StartOperationOutcome> {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => `op_${Math.random().toString(36).slice(2, 10)}_${now()}`);
  const startedAt = now();
  const operationId = newId();

  // Before any HTTP call — this ordering IS the crash-safety mechanism.
  await deps.store.create({
    id: operationId,
    providerId: params.providerId,
    routeKey: params.routeKey,
    ownerRef: params.ownerRef,
    maxAttempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    deadlineAt: startedAt + (params.deadlineMs ?? DEFAULT_DEADLINE_MS),
    nextPollAt: startedAt,
  });

  const settle = (async (): Promise<StartOperationOutcome> => {
    const submitted = await submitAndParse(deps, params);

    if (!submitted.ok) {
      // Nothing was obtained from the vendor — no job handle exists to protect, so a single
      // terminal write is safe. Best-effort even here: a write failure at this point must not
      // reject `settle` (see the `finally` below) and leaves the row `'submitted'`, which is at
      // least as safe as `'failed'` would have been.
      await deps.store.update(operationId, { status: 'failed', error: toOperationError(submitted.error) }).catch(() => undefined);
      return { done: false, operationId };
    }

    const { outcome } = submitted;
    // Past this point a vendor job handle exists (or the job already finished) — losing either
    // to a transient store write is strictly worse than the failure it would otherwise record,
    // so the write is retried before anything is allowed to fall back to a `'failed'` label.
    const patch: AsyncOperationPatch =
      outcome.kind === 'complete'
        ? { status: 'succeeded', result: resultToPayload(outcome.result) }
        : { status: 'polling', state: outcome.state, nextPollAt: now() + (outcome.retryAfterMs ?? DEFAULT_POLL_INTERVAL_MS) };

    await persistWithRetry(deps.store, operationId, patch, deps.persistRetryDelaysMs ?? DEFAULT_PERSIST_RETRY_DELAYS_MS);
    // Even on exhausted retries there is nothing safer left to do here: the row stays exactly as
    // `create()` left it (`'submitted'`), and `recoverAfterRestart`'s crash-gap handling exists
    // precisely for a row whose outcome could not be confirmed durable.

    if (outcome.kind === 'complete') return { done: true, operationId, result: outcome.result };
    return { done: false, operationId };
  })();

  const graceMs = params.graceMs ?? DEFAULT_GRACE_MS;
  // A `'slow'` vendor is not worth making anyone wait on: the race is still the same single code
  // path, its window is just zero.
  const effectiveGraceMs = params.adapter.expectedLatencyClass === 'slow' ? 0 : graceMs;

  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<StartOperationOutcome>((resolve) => {
    graceTimer = setTimeout(() => resolve({ done: false, operationId }), effectiveGraceMs);
  });

  try {
    // The losing side is never cancelled — an abandoned submit keeps running and settles the row
    // the caller already holds an id for.
    return await Promise.race([settle, grace]);
  } finally {
    if (graceTimer) clearTimeout(graceTimer);
    // The caller may have walked away; the row still gets written, but an unobserved rejection
    // must not take the process down.
    void settle.catch(() => undefined);
  }
}

export interface PollDueParams {
  /** Resolves the adapter registered for a row's `(providerId, routeKey)`. */
  readonly adapters: (providerId: string, routeKey: string) => AnyPollingVendorAdapter | undefined;
  /** Rehydrates the render context for a row. The row deliberately does not persist the context — it can hold reference-image data URLs, and none of it is needed to identify the vendor-side job. */
  readonly resolveContext: (row: AsyncOperationRecord) => RenderContext;
  readonly leaseOwner: string;
  readonly leaseMs: number;
  readonly limit?: number;
}

export interface PollDueStats {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly pending: number;
  readonly unknown: number;
}

/**
 * One leased worker tick: claims every due operation, advances each by exactly one vendor poll,
 * and releases the lease. Safe to run concurrently on several workers — `claimDue` is the
 * exclusion mechanism.
 *
 * Both bounds are enforced here, and in this order: the absolute deadline is checked *before* any
 * vendor call (a blown deadline must not cost another request), the attempt cap after it.
 *
 * @complexity O(k) vendor round trips for k claimed operations.
 */
export async function pollDueOperations(deps: OperationRuntimeDeps, params: PollDueParams): Promise<PollDueStats> {
  const now = deps.now ?? Date.now;
  const claimed = await deps.store.claimDue({
    now: now(),
    leaseOwner: params.leaseOwner,
    leaseMs: params.leaseMs,
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  });

  let completed = 0;
  let failed = 0;
  let pending = 0;
  let unknown = 0;

  for (const row of claimed) {
    try {
      const at = now();

      if (row.deadlineAt <= at) {
        await deps.store.update(
          row.id,
          {
            status: 'unknown',
            error: {
              message: 'async operation passed its absolute deadline — vendor-side effect is undetermined',
              code: 'DEADLINE_EXPIRED',
            },
          },
          { leaseOwner: params.leaseOwner },
        );
        unknown += 1;
        continue;
      }

      if (row.attempts >= row.maxAttempts) {
        await deps.store.update(
          row.id,
          {
            status: 'failed',
            error: {
              message: `async operation exhausted its ${row.maxAttempts} poll attempts without a terminal answer`,
              code: 'ATTEMPTS_EXHAUSTED',
            },
          },
          { leaseOwner: params.leaseOwner },
        );
        failed += 1;
        continue;
      }

      const adapter = params.adapters(row.providerId, row.routeKey);
      if (!adapter) {
        await deps.store.update(
          row.id,
          {
            status: 'failed',
            error: { message: `no polling adapter registered for "${row.providerId}" / "${row.routeKey}"`, code: 'NO_ADAPTER' },
          },
          { leaseOwner: params.leaseOwner },
        );
        failed += 1;
        continue;
      }

      const ctx = params.resolveContext(row);
      const request = adapter.buildPollRequest(row.state ?? {}, ctx);
      // Credentials are resolved here, on this tick — never read from the row.
      const resp = await performSigned(deps, request as UnsignedVendorRequest<unknown>, FETCH_TIMEOUT_MS.QUICK);
      const outcome = await adapter.parsePollResponse(resp, ctx, row.state ?? {});

      // Every write below is fenced on the lease this tick claimed: if it expired and another
      // worker has since reclaimed (or finished) the row, this write must not clobber that newer
      // outcome — see `AsyncOperationUpdateOptions`.
      if (outcome.kind === 'complete') {
        await deps.store.update(
          row.id,
          {
            status: 'succeeded',
            attempts: row.attempts + 1,
            result: resultToPayload(outcome.result),
          },
          { leaseOwner: params.leaseOwner },
        );
        completed += 1;
      } else if (outcome.kind === 'failed') {
        await deps.store.update(
          row.id,
          {
            status: 'failed',
            attempts: row.attempts + 1,
            error: { message: outcome.message, ...(outcome.code !== undefined ? { code: outcome.code } : {}) },
          },
          { leaseOwner: params.leaseOwner },
        );
        failed += 1;
      } else {
        await deps.store.update(
          row.id,
          {
            status: 'polling',
            attempts: row.attempts + 1,
            nextPollAt: at + (outcome.retryAfterMs ?? DEFAULT_POLL_INTERVAL_MS),
          },
          { leaseOwner: params.leaseOwner },
        );
        pending += 1;
      }
    } catch (error) {
      // A transport failure is not a vendor verdict: keep the row pollable and let the attempt cap
      // or the deadline end it, rather than reporting a definitive failure we cannot support.
      await deps.store.update(
        row.id,
        {
          status: 'polling',
          attempts: row.attempts + 1,
          nextPollAt: now() + DEFAULT_POLL_INTERVAL_MS,
          error: toOperationError(error),
        },
        { leaseOwner: params.leaseOwner },
      );
      pending += 1;
    } finally {
      await deps.store.releaseLease(row.id, params.leaseOwner);
    }
  }

  return { claimed: claimed.length, completed, failed, pending, unknown };
}

export interface RecoverParams {
  readonly adapters: (providerId: string, routeKey: string) => AnyPollingVendorAdapter | undefined;
  readonly now?: number;
}

export interface RecoverResult {
  readonly leasesReleased: number;
  readonly deadlineExpired: number;
  /** Rows whose submit may or may not have reached the vendor and cannot be safely re-issued. */
  readonly unknownCrashGap: number;
  /** Rows whose adapter declares its submit idempotent — left `submitted` for the host to re-issue. */
  readonly resubmittable: readonly string[];
}

/**
 * Boot-time recovery. Releases dead leases and expires blown deadlines via the store, then handles
 * the one case the store cannot decide alone: a row still at `submitted`, meaning the process died
 * between persisting the row and learning whether the vendor accepted the submit.
 *
 * Retry safety is gated on idempotency, not assumed. An adapter that has not declared
 * `submitIsIdempotent` sends that row to `unknown` for reconciliation — media generation is billed
 * per call, so a silent re-issue can double a real charge.
 *
 * @complexity O(n) in stored operations.
 */
export async function recoverAfterRestart(deps: OperationRuntimeDeps, params: RecoverParams): Promise<RecoverResult> {
  const at = params.now ?? (deps.now ?? Date.now)();
  const reconciled = await deps.store.reconcileOnBoot({ now: at });

  const resubmittable: string[] = [];
  let unknownCrashGap = 0;

  for (const row of await collectSubmitted(deps.store)) {
    const adapter = params.adapters(row.providerId, row.routeKey);
    if (adapter?.submitIsIdempotent === true) {
      resubmittable.push(row.id);
      continue;
    }
    await deps.store.update(row.id, {
      status: 'unknown',
      error: {
        message: 'process died before the vendor submit was confirmed, and this adapter does not declare the submit idempotent — reconcile manually rather than risk a duplicate charge',
        code: 'CRASH_GAP_NOT_IDEMPOTENT',
      },
    });
    unknownCrashGap += 1;
  }

  return { ...reconciled, unknownCrashGap, resubmittable };
}

/**
 * The `submitted` rows a restart orphaned. Uses the store's own claim-free read path so recovery
 * never competes with a live worker for a lease.
 */
async function collectSubmitted(store: AsyncOperationStore): Promise<AsyncOperationRecord[]> {
  const seen = new Map<string, AsyncOperationRecord>();
  for (const row of await store.claimDue({ now: Number.MAX_SAFE_INTEGER, leaseOwner: RECOVERY_LEASE_OWNER, leaseMs: 0, limit: Number.MAX_SAFE_INTEGER })) {
    if (row.status === 'submitted') seen.set(row.id, row);
    await store.releaseLease(row.id, RECOVERY_LEASE_OWNER);
  }
  return [...seen.values()];
}
