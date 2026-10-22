/**
 * @file Stripe HTTP failures → the kernel's three-way `Outcome` (bug B4).
 *
 * The question every row answers is "can money have moved?". Only a response that PROVES Stripe did
 * not act is `rejected`; anything else is `unknown`, which keeps the money reserved until
 * `retrieve` settles it. Today's code mapped every provider error to terminal `failed` and then
 * ignored the late success webhook — that is the bug this table exists to prevent.
 *
 * Stripe's error envelope is `{ "error": { "type", "code", "message" } }`
 * (https://docs.stripe.com/api/errors), verified by the deprecated capability-providers port.
 */
import { paymentError, type PaymentErrorCode, type Outcome } from "@jini-ai/commerce/payments/kernel";

/** A non-ok `Outcome`: what every Stripe call returns when it did not succeed. */
export type StripeFailure = Exclude<Outcome<never>, { readonly kind: "ok" }>;

/** The fields of Stripe's error envelope this mapping reads. All optional: the body is untrusted. */
export interface StripeErrorFields {
  readonly type?: string;
  readonly code?: string;
  readonly message?: string;
}

interface FailureFacts {
  readonly status: number;
  readonly type: string | undefined;
  readonly code: string | undefined;
}

type Verdict = readonly [kind: StripeFailure["kind"], code: PaymentErrorCode, retryable: boolean];

/**
 * Ordered: the first matching row wins. The idempotency rows come first because Stripe reports a
 * reused key with different parameters as `idempotency_error` (a provable no-op), while a key whose
 * first request is still in flight (`idempotency_key_in_use`, HTTP 409) may yet move money.
 */
const RULES: ReadonlyArray<readonly [(facts: FailureFacts) => boolean, Verdict]> = [
  [(f) => f.code === "idempotency_key_in_use", ["unknown", "PROVIDER_ERROR", true]],
  [(f) => f.type === "idempotency_error", ["rejected", "IDEMPOTENCY_CONFLICT", false]],
  [(f) => f.status === 409, ["unknown", "PROVIDER_ERROR", true]],
  [(f) => f.status >= 500, ["unknown", "PROVIDER_ERROR", true]],
  [(f) => f.status === 402, ["rejected", "DECLINED", false]],
  [(f) => f.status === 400 || f.status === 404, ["rejected", "INVALID_REQUEST", false]],
  [(f) => f.status === 401 || f.status === 403, ["rejected", "PROVIDER_ERROR", false]],
  // Rate limited (and `lock_timeout`): Stripe refused before processing, so the same key may be retried.
  [(f) => f.status === 429, ["rejected", "PROVIDER_ERROR", true]],
];

/** An HTTP status this table does not know proves nothing about the money, so it is `unknown`. */
const UNEXPECTED: Verdict = ["unknown", "PROVIDER_ERROR", true];

/**
 * Classify a non-2xx Stripe response.
 * @param required.status - The HTTP status.
 * @param required.error - The parsed error envelope (empty when the body was not one).
 * @complexity O(1).
 */
export function classifyStripeFailure(
  { status, error }: { status: number; error: StripeErrorFields },
  _optional: Record<string, never> = {}
): StripeFailure {
  const facts: FailureFacts = { status, type: error.type, code: error.code };
  const [kind, code, retryable] = RULES.find(([matches]) => matches(facts))?.[1] ?? UNEXPECTED;
  const detail = [String(status), [error.type, error.code].filter((part) => part !== undefined).join("/")].filter(Boolean).join(" ");
  const message = `stripe: HTTP ${detail}: ${error.message ?? "request failed"}`;
  return { kind, error: paymentError({ code, message }, { retryable, providerStatus: status }) };
}

/** The request may have reached Stripe (connection reset, timeout, abort), so the outcome is `unknown`. */
export function transportFailure({ cause }: { cause: unknown }, _optional: Record<string, never> = {}): StripeFailure {
  return { kind: "unknown", error: paymentError({ code: "TRANSPORT_ERROR", message: `stripe: transport failed: ${String(cause)}` }, { retryable: true }) };
}

/** A 2xx whose body is not the object we asked for: Stripe acted, we cannot tell how. */
export function unparseableSuccess(
  { status, what }: { status: number; what: string },
  _optional: Record<string, never> = {}
): StripeFailure {
  return {
    kind: "unknown",
    error: paymentError({ code: "PROVIDER_ERROR", message: `stripe: HTTP ${status} body is not a valid ${what}` }, { retryable: true, providerStatus: status }),
  };
}

/** A failure decided before any request was sent (missing credential, unsupported option). */
export function localRejection(
  { code, message }: { code: PaymentErrorCode; message: string },
  _optional: Record<string, never> = {}
): StripeFailure {
  return { kind: "rejected", error: paymentError({ code, message: `stripe: ${message}` }) };
}
