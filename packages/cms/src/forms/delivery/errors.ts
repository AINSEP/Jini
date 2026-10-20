/**
 * @file The one place a delivery failure becomes ledger-safe. Adapter and provider messages can
 * contain tokens, URLs or answers, and the outbox persists `error.message` verbatim, so the only
 * text a {@link FormDeliveryError} ever carries is an allowlisted code.
 */
import type { FormDeliveryErrorCode } from "./types.js";

const FORM_DELIVERY_ERROR_CODES: ReadonlySet<string> = new Set<FormDeliveryErrorCode>([
  "authorization-required", "rate-limited", "configuration-invalid", "mapping-invalid", "resource-not-granted",
  "destination-limit", "outcome-unknown", "adapter-unavailable", "delivery-failed",
]);

/** Upper bound on an adapter's `retryAfterMs`. One hour covers per-minute and per-hour provider
 * quotas, while a buggy or hostile adapter cannot park a job for days and silently exhaust the
 * delivery window; the host's own backoff still applies when it is longer. */
export const FORM_DELIVERY_MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

/** Maps any value to an allowlisted code; everything unknown becomes `delivery-failed`. */
export function safeFormDeliveryErrorCode(required: { code: unknown }, _optional: Record<string, never> = {}): FormDeliveryErrorCode {
  const { code } = required;
  return typeof code === "string" && FORM_DELIVERY_ERROR_CODES.has(code) ? (code as FormDeliveryErrorCode) : "delivery-failed";
}

function boundedRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(value, FORM_DELIVERY_MAX_RETRY_AFTER_MS);
}

/** Delivery failure the outbox worker records and the retry policy reads. Inputs may come from
 * untyped plugin code despite the declared types, so every field is re-validated: an unknown code is forced to retryable
 * `delivery-failed` (the contract for anything unrecognised), and hints outside their range are dropped. */
export class FormDeliveryError extends Error {
  readonly code: FormDeliveryErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly outcome?: "not-applied" | "unknown";

  constructor(
    required: { code: string; retryable: boolean; retryAfterMs?: number; outcome?: "not-applied" | "unknown" },
    _optional: Record<string, never> = {},
  ) {
    const code = safeFormDeliveryErrorCode({ code: required.code });
    super(code);
    this.name = "FormDeliveryError";
    this.code = code;
    // Only an explicit, recognised `retryable: false` stops retries; the attempt cap still bounds the rest.
    this.retryable = code !== required.code || required.retryable !== false;
    const retryAfterMs = boundedRetryAfterMs(required.retryAfterMs);
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
    if (required.outcome === "not-applied" || required.outcome === "unknown") this.outcome = required.outcome;
  }
}
