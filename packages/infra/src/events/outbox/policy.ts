import type { OutboxRetryPolicyResolver, OutboxWorkerOptions } from './ports.js';

/** Capped delivery attempts before an outbox row is permanently excluded from retry (`"failed"`). */
export const MAX_OUTBOX_ATTEMPTS = 6;

/**
 * How long a claim holds a row before another drain may claim it again.
 *
 * A claimer that dies between `claimPending` and `markDelivered`/`markFailed` (a crash, a dev-watch
 * reload) must not strand its rows as `"processing"`. Adapters store the lease expiry in the
 * row's `nextAttemptAt` and treat an expired `"processing"` row as claimable, so delivery is
 * at-least-once. The lease must outlast the slowest full batch a live claimer can take; otherwise a
 * second drain takes over a row that is still being delivered, and it is delivered twice.
 */
export const DEFAULT_OUTBOX_CLAIM_LEASE_MS = 30 * 60 * 1000;

/**
 * How long one row's delivery (its `bus.publish`) may run before the worker gives up on it
 * before the drain moves on. A timed-out delivery is
 * recorded at once as a retryable failure (`lastError` is visible immediately), but the row is not
 * due again until `DEFAULT_OUTBOX_CLAIM_LEASE_MS` later, not at the ordinary backoff — the handler
 * cannot be cancelled and keeps running, and redelivering it in 15-30s would start a second copy
 * while the first is still live, exactly what the claim lease exists to prevent. The handler's real
 * outcome, once it settles, replaces that record (see `recordOverrun`). A full default batch of 20
 * deliveries that each time out takes 20 minutes, inside `DEFAULT_OUTBOX_CLAIM_LEASE_MS`.
 */
export const DEFAULT_OUTBOX_DELIVERY_TIMEOUT_MS = 60 * 1000;
export const DEFAULT_OUTBOX_DRAIN_INTERVAL_MS = 1000;

/**
 * Exponential backoff with "equal jitter": `half = min(cap, base * 2^(attempts-1)) / 2`, then
 * `half + random() * half` — always at least `half`, at most the full exponential step, so retries
 * never collapse to zero delay (thundering herd) or drift outside the exponential envelope.
 * `attempts` is 1-based (the count *after* the failing attempt that just happened — `claimPending`
 * increments it before the attempt runs). At `attempts = 1..6` with the constants above, the
 * un-jittered midpoints are roughly 15s, 30s, 1m, 2m, 4m, 8m — an internal in-process event-bus
 * failure is expected to be a real bug or a short-lived dependency outage, not a slow external
 * endpoint, so this window is far shorter than a webhook worker's ~1-day one.
 *
 * Source equal-jitter retry formula. Randomness is always supplied by the host.
 * Injectable for deterministic tests.
 *
 * @throws RangeError for invalid attempts or randomness.
 */
export function computeOutboxBackoffMs(required: { attempts: number; random: () => number }): number {
  if (!Number.isSafeInteger(required.attempts) || required.attempts < 1) throw new RangeError('outbox attempts must be a positive integer');
  const random = required.random();
  if (!Number.isFinite(random) || random < 0 || random > 1) throw new RangeError('outbox random must be between zero and one');
  const half = Math.min(30 * 60 * 1000, 30 * 1000 * 2 ** (required.attempts - 1)) / 2;
  return Math.round(half + random * half);
}

export interface ResolvedPolicy { batchSize: number; deliveryTimeoutMs: number; claimLeaseMs: number; retryPolicyForEvent: OutboxRetryPolicyResolver | undefined }
export function resolvePolicy(required: { options: OutboxWorkerOptions }, _optional: Record<string, never> = {}): ResolvedPolicy {
  const bounds = {
    batchSize: required.options.batchSize ?? 20,
    deliveryTimeoutMs: required.options.deliveryTimeoutMs ?? DEFAULT_OUTBOX_DELIVERY_TIMEOUT_MS,
    claimLeaseMs: required.options.claimLeaseMs ?? DEFAULT_OUTBOX_CLAIM_LEASE_MS,
  };
  for (const [name, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`outbox ${name} must be a positive integer`);
  }
  if (bounds.claimLeaseMs <= bounds.batchSize * bounds.deliveryTimeoutMs) {
    throw new RangeError('outbox claim lease must outlast a full batch of delivery timeouts');
  }
  // The drainer passes this resolved policy back in as processOutbox options, so the resolver must survive it.
  return { ...bounds, retryPolicyForEvent: required.options.retryPolicyForEvent };
}
