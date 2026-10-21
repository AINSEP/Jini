/**
 * Synthetic from docs — needs sandbox recording.
 * Shapes follow Stripe's documented Dispute object (https://docs.stripe.com/api/disputes/object) at
 * API version 2024-06-20. No live data.
 */
export const disputeNeedsResponse = {
  id: "dp_1Nispe2eZvKYlo2CsOAFHNxT",
  object: "dispute",
  amount: 2000,
  balance_transactions: [],
  charge: "ch_3MtwBwLkdIwHu7ix2bKdb3Ft",
  created: 1692942400,
  currency: "usd",
  evidence: {},
  evidence_details: { due_by: 1693612799, has_evidence: false, past_due: false, submission_count: 0 },
  is_charge_refundable: false,
  livemode: false,
  metadata: {},
  payment_intent: "pi_3MtwBwLkdIwHu7ix28a3tqPa",
  reason: "fraudulent",
  status: "needs_response",
} as const;

type Dispute = Record<string, unknown>;
export const dispute = (overrides: Dispute): Dispute => ({ ...disputeNeedsResponse, ...overrides });

export const disputeList = (data: readonly unknown[], hasMore = false) => ({ object: "list", url: "/v1/disputes", has_more: hasMore, data });
