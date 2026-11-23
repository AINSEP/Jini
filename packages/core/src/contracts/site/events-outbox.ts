/**
 * @file The outbox drainer handle and the per-event retry-policy seam a host supplies.
 *
 * Additive verbatim copy of the declarations in `@jini-ai/infra/events/outbox` (`drainer.ts`,
 * `ports.ts`) with their structural closure; infra keeps its identical declarations and exports
 * until the paired cutover. Distinct from `contracts/events`'s change-set outbox port: this is the
 * generic event-envelope worker's vocabulary.
 */

/** The complete application envelope passes through unchanged; only name is read by the worker. */
export interface EventEnvelope { readonly name: string }

export interface OutboxDrainer {
  /** Stops scheduling drains, then resolves once a drain already running has settled. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Retry policy for one event, chosen by the host per event name. Events with no policy keep the
 * default six attempts and 15s..30min equal-jitter backoff. `error` is whatever failed the attempt
 * (a publish failure, or a storage failure recording a delivery). A policy that throws, or returns an
 * invalid cap or delay, is reported and the row falls back to the default policy (see worker.ts).
 */
export interface OutboxRetryPolicy {
  /** Positive integer cap; a failed attempt at or past it is terminal. */
  readonly maxAttempts: number;
  /** Finite, nonnegative delay before the next attempt. */
  backoffMs(required: { attempts: number; random: () => number; error: unknown }): number;
  /** `false` makes this failure terminal at once; absent means every failure is retryable. */
  retryable?(required: { error: unknown }): boolean;
  /** The values this event's failures may store in `lastError`; absent means the class label only. */
  readonly failureCodes?: OutboxFailureCodes;
}
/**
 * A closed list of failure codes for one event. `lastError` is a persisted field a status view
 * reads back, so the worker stores `codeOf(...)` only when the result is in `codes`: a code is
 * approved by listing, never by shape, because a thrown value's own `code` is caller text and could
 * be a secret. Anything else (no result, a result not on the list, a throw, which is reported) stores
 * the class label, exactly as an event with no list does.
 */
export interface OutboxFailureCodes {
  readonly codes: readonly string[];
  codeOf(required: { error: unknown }): string | undefined;
}
/** The only per-event retry seam: return a policy for events that need one, `undefined` otherwise. */
export type OutboxRetryPolicyResolver = (required: { event: EventEnvelope }) => OutboxRetryPolicy | undefined;
