/**
 * @file Stripe API objects (PaymentIntent, Refund, Dispute) → kernel evidence.
 *
 * Shapes are Stripe's documented objects (https://docs.stripe.com/api/payment_intents/object,
 * /api/refunds/object, /api/disputes/object) at the pinned `Stripe-Version`. A reader returns
 * `undefined` for an object it cannot read in full: a guessed status or amount would go into the
 * append-only evidence log, where it can never be corrected.
 */
import type {
  DisputeEvidence,
  NextAction,
  PaymentEvidence,
  ProviderDisputeStatus,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  RefundEvidence,
} from "@jini-ai/commerce/payments/kernel";
import { moneyFromStripe } from "./amounts.js";
import { isRecord, optionalCount, optionalString, type JsonObject } from "./json.js";

/** Metadata keys carrying OUR ids, so Stripe echoes them on every object and webhook. */
export const PAYMENT_ID_METADATA = "jini_payment_id";
export const REFUND_ID_METADATA = "jini_refund_id";

/** `requires_payment_method` is pending on a fresh intent and failed once a payment attempt was declined. */
const INTENT_STATUS: Readonly<Record<string, (intent: JsonObject) => ProviderPaymentStatus>> = {
  requires_payment_method: (intent) => (isRecord(intent.last_payment_error) ? "failed" : "pending"),
  requires_confirmation: () => "pending",
  processing: () => "pending",
  requires_action: () => "requires_action",
  requires_capture: () => "authorized",
  succeeded: () => "succeeded",
  canceled: () => "canceled",
};

const REFUND_STATUS: Readonly<Record<string, ProviderRefundStatus>> = {
  pending: "pending",
  requires_action: "pending",
  succeeded: "succeeded",
  failed: "failed",
  canceled: "failed",
};

const DISPUTE_STATUS: Readonly<Record<string, ProviderDisputeStatus>> = {
  warning_needs_response: "open",
  warning_under_review: "open",
  needs_response: "open",
  under_review: "open",
  warning_closed: "won",
  won: "won",
  lost: "lost",
};

const lookup = <T>(table: Readonly<Record<string, T>>, key: unknown): T | undefined =>
  typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;

const metadataValue = (object: JsonObject, key: string): string | undefined =>
  isRecord(object.metadata) ? optionalString(object.metadata[key]) : undefined;

const withCorrelation = (correlationId: string | undefined) => (correlationId === undefined ? {} : { correlationId });

/**
 * What the shopper must do next. `requires_action` names it (a 3-D Secure redirect, or a step for
 * Stripe.js). A fresh intent awaiting a payment method or confirmation is completed by Stripe.js
 * with the `client_secret`, so it is a `client_action` too — otherwise the host has nothing to
 * hand its checkout page.
 */
function nextActionOf(intent: JsonObject, status: ProviderPaymentStatus): NextAction {
  const redirect = redirectUrlOf(intent);
  if (status === "requires_action" && redirect !== undefined) return { kind: "redirect", url: redirect };
  // `pending` also covers `processing`, where the shopper has nothing left to do.
  const awaitsClient = status === "requires_action" || (status === "pending" && intent.status !== "processing");
  const clientSecret = optionalString(intent.client_secret);
  return awaitsClient && clientSecret !== undefined ? { kind: "client_action", payload: { client_secret: clientSecret } } : { kind: "none" };
}

function redirectUrlOf(intent: JsonObject): string | undefined {
  const next = isRecord(intent.next_action) ? intent.next_action : {};
  return isRecord(next.redirect_to_url) ? optionalString(next.redirect_to_url.url) : undefined;
}

/** Captured so far: nothing while authorized, `amount_received` once succeeded, unstated otherwise. */
function capturedOf(intent: JsonObject, status: ProviderPaymentStatus, currency: unknown): PaymentEvidence["captured"] | undefined {
  if (status === "authorized") return moneyFromStripe({ amount: 0, currency });
  return status === "succeeded" ? moneyFromStripe({ amount: intent.amount_received, currency }) : undefined;
}

/**
 * A PaymentIntent as evidence (refunds and disputes empty: the intent object does not carry them).
 * @complexity O(1).
 */
export function intentEvidence(
  { intent }: { intent: JsonObject },
  _optional: Record<string, never> = {}
): (PaymentEvidence & { readonly next: NextAction }) | undefined {
  const providerRef = optionalString(intent.id);
  const status = lookup(INTENT_STATUS, intent.status)?.(intent);
  const amount = moneyFromStripe({ amount: intent.amount, currency: intent.currency });
  if (providerRef === undefined || status === undefined || amount === undefined) return undefined;
  const captured = capturedOf(intent, status, intent.currency);
  if (status === "succeeded" && captured === undefined) return undefined;
  return {
    providerRef,
    ...withCorrelation(metadataValue(intent, PAYMENT_ID_METADATA)),
    status,
    amount,
    ...(captured === undefined ? {} : { captured }),
    next: nextActionOf(intent, status),
    refunds: [],
    disputes: [],
  };
}

/** A Refund as evidence, echoing our refund id from its metadata. */
export function refundEvidence({ refund }: { refund: JsonObject }, _optional: Record<string, never> = {}): RefundEvidence | undefined {
  const providerRefundRef = optionalString(refund.id);
  const status = lookup(REFUND_STATUS, refund.status);
  const amount = moneyFromStripe({ amount: refund.amount, currency: refund.currency });
  if (providerRefundRef === undefined || status === undefined || amount === undefined) return undefined;
  return { providerRefundRef, ...withCorrelation(metadataValue(refund, REFUND_ID_METADATA)), amount, status };
}

/** A Dispute as evidence; `evidence_details.due_by` (Unix seconds) becomes `dueBy` in epoch ms. */
export function disputeEvidence({ dispute }: { dispute: JsonObject }, _optional: Record<string, never> = {}): DisputeEvidence | undefined {
  const providerDisputeRef = optionalString(dispute.id);
  const status = lookup(DISPUTE_STATUS, dispute.status);
  const amount = moneyFromStripe({ amount: dispute.amount, currency: dispute.currency });
  if (providerDisputeRef === undefined || status === undefined || amount === undefined) return undefined;
  const dueBy = optionalCount(isRecord(dispute.evidence_details) ? dispute.evidence_details.due_by : undefined);
  return { providerDisputeRef, amount, status, ...(dueBy === undefined ? {} : { dueBy: dueBy * 1000 }) };
}

/**
 * Reads every element of a list with `read`; `undefined` if any element is unreadable, because a
 * snapshot that silently drops a refund would let reconcile conclude the refund never happened.
 */
export function readAll<T>(
  { items, read }: { items: readonly unknown[]; read: (item: JsonObject) => T | undefined },
  _optional: Record<string, never> = {}
): T[] | undefined {
  const out: T[] = [];
  for (const item of items) {
    const value = isRecord(item) ? read(item) : undefined;
    if (value === undefined) return undefined;
    out.push(value);
  }
  return out;
}
