/**
 * @file Retry policy for delivery jobs, in the shape the outbox worker's per-event resolver
 * accepts. The backoff curve is injected: the host chooses it (typically its outgoing-webhook
 * schedule, which is longer than the in-process default), and this package stays independent of
 * whichever package owns that curve.
 */
import { FormDeliveryError } from "./errors.js";

/** Structurally compatible with the outbox `OutboxRetryPolicy`, declared locally so forms does
 * not depend on the infra package. */
export interface FormDeliveryRetryPolicy {
  readonly maxAttempts: number;
  backoffMs(required: { attempts: number; random: () => number; error: unknown }): number;
  retryable(required: { error: unknown }): boolean;
}

/**
 * Builds the delivery retry policy: an explicit non-retryable {@link FormDeliveryError} goes
 * terminal at once; an adapter's `retryAfterMs` (already capped at
 * `FORM_DELIVERY_MAX_RETRY_AFTER_MS` by the error itself) can lengthen the wait but never shorten
 * the host backoff. Any other error, such as a worker timeout, retries on the host backoff.
 * @example formDeliveryRetryPolicy({ backoffMs: ({ attempts, random }) => backoff({ attempts }, { random }), maxAttempts: 8 })
 */
export function formDeliveryRetryPolicy(
  required: { backoffMs: (required: { attempts: number; random: () => number }) => number; maxAttempts: number },
  _optional: Record<string, never> = {},
): FormDeliveryRetryPolicy {
  return {
    maxAttempts: required.maxAttempts,
    retryable: ({ error }) => !(error instanceof FormDeliveryError) || error.retryable,
    backoffMs: ({ attempts, random, error }) => {
      const backoff = required.backoffMs({ attempts, random });
      const retryAfterMs = error instanceof FormDeliveryError ? error.retryAfterMs : undefined;
      return retryAfterMs === undefined ? backoff : Math.max(backoff, retryAfterMs);
    },
  };
}
