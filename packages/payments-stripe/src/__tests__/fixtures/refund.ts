/**
 * Synthetic from docs — needs sandbox recording.
 * Shapes follow Stripe's documented Refund object (https://docs.stripe.com/api/refunds/object) and
 * list envelope (https://docs.stripe.com/api/pagination) at API version 2024-06-20. No live data.
 */
export const refundSucceeded = {
  id: "re_1Nispe2eZvKYlo2Cd31jOCgZ",
  object: "refund",
  amount: 500,
  balance_transaction: "txn_1Nispe2eZvKYlo2CYezqFhEx",
  charge: "ch_3MtwBwLkdIwHu7ix2bKdb3Ft",
  created: 1692942318,
  currency: "usd",
  destination_details: { card: { reference_status: "pending", reference_type: "acquirer_reference_number", type: "refund" }, type: "card" },
  metadata: { jini_refund_id: "ref_1" },
  payment_intent: "pi_3MtwBwLkdIwHu7ix28a3tqPa",
  reason: null,
  receipt_number: null,
  source_transfer_reversal: null,
  status: "succeeded",
  transfer_reversal: null,
} as const;

type Refund = Record<string, unknown>;
export const refund = (overrides: Refund): Refund => ({ ...refundSucceeded, ...overrides });

export const refundPending = refund({ id: "re_pending", status: "pending" });
export const refundFailed = refund({ id: "re_failed", status: "failed", failure_reason: "expired_or_canceled_card" });

/** `GET /v1/refunds?payment_intent=…` — one page. */
export const refundList = (data: readonly unknown[], hasMore = false) => ({ object: "list", url: "/v1/refunds", has_more: hasMore, data });
