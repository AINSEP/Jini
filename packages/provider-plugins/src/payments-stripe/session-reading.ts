import type { PaymentEvidence, PaymentMode, ProviderPaymentStatus } from "@jini-ai/commerce/payments/kernel";
import { fromStripeAmount } from "./amount.js";

export type SessionReading = { kind: "evidence"; evidence: PaymentEvidence } | { kind: "id_only"; sessionId: string }
  | { kind: "foreign" } | { kind: "malformed"; reason: string };
const FAILED_PI_STATUSES: ReadonlySet<unknown> = new Set(["requires_payment_method", "canceled"]);

/** Reads untrusted JSON records without coercing arrays, null or primitives. O(1) time/space. */
function record({ value }: { value: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Pins the owned object's kind and mode to the trusted context. O(1) time/space. */
function invalidIdentity({ session, mode }: { session: Record<string, unknown>; mode: PaymentMode }, _optional: Record<string, never> = {}): boolean {
  return session.object !== "checkout.session" || session.mode !== "payment" || session.livemode !== (mode === "live");
}

/** Maps provider facts without treating delayed payment completion as success. O(1) time/space. */
function sessionStatus(
  { session, eventType }: { session: Record<string, unknown>; eventType: string | undefined }, _optional: Record<string, never> = {}
): ProviderPaymentStatus | null {
  if (eventType === "checkout.session.async_payment_failed") return "failed";
  if (eventType === "checkout.session.async_payment_succeeded") return session.payment_status === "paid" ? "succeeded" : null;
  if (session.status === "open") return "requires_action";
  if (session.status === "expired") return "canceled";
  if (session.status !== "complete") return null;
  if (session.payment_status === "paid") return "succeeded";
  if (session.payment_status !== "unpaid") return null;
  // An id-only PI says nothing about failure; only an expanded retrieval can establish it.
  const pi = record({ value: session.payment_intent });
  return FAILED_PI_STATUSES.has(pi.status) ? "failed" : "pending";
}

/** Translates an owned Checkout session, preserving incomplete facts for worker retrieval.
 * @returns Evidence, id-only, foreign, or a malformed reason; no I/O or thrown JSON errors.
 * @example readSession({ object: event.data.object, mode: ctx.account.mode }, { eventType: event.type })
 * @complexity O(n) in the currency string length; constant fields inspected. */
export function readSession(
  { object, mode }: { object: unknown; mode: PaymentMode }, optional: { eventType?: string } = {}
): SessionReading {
  const session = record({ value: object });
  const correlationId = record({ value: session.metadata }).jini_payment_id;
  if (correlationId === undefined) return { kind: "foreign" };
  if (typeof correlationId !== "string" || correlationId.length === 0) return { kind: "malformed", reason: "invalid payment correlation" };
  if (typeof session.id !== "string" || session.id.length === 0 || invalidIdentity({ session, mode })) return {
    kind: "malformed", reason: "invalid checkout session identity or mode",
  };
  const status = sessionStatus({ session, eventType: optional.eventType });
  const amount = fromStripeAmount({ amount: session.amount_total, currency: session.currency });
  if (status === null || amount === null) return { kind: "id_only", sessionId: session.id };
  return { kind: "evidence", evidence: { providerRef: session.id, correlationId, status, amount, refunds: [], disputes: [] } };
}
