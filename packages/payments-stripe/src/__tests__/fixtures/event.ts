/**
 * Synthetic from docs — needs sandbox recording.
 * Shapes follow Stripe's documented Event object (https://docs.stripe.com/api/events/object) and the
 * Charge object (https://docs.stripe.com/api/charges/object) at API version 2024-06-20. No live data.
 */
export const event = (type: string, object: unknown, overrides: Record<string, unknown> = {}) => ({
  id: "evt_1NG8Du2eZvKYlo2CUI79vXWy",
  object: "event",
  api_version: "2024-06-20",
  created: 1686089970,
  data: { object },
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  type,
  ...overrides,
});

/** A partially refunded charge as `charge.refunded` delivers it, with its refunds list included. */
export const chargeRefunded = (refunds: readonly unknown[] | undefined) => ({
  id: "ch_3MtwBwLkdIwHu7ix2bKdb3Ft",
  object: "charge",
  amount: 2000,
  amount_captured: 2000,
  amount_refunded: 500,
  captured: true,
  created: 1680800505,
  currency: "usd",
  livemode: false,
  metadata: {},
  paid: true,
  payment_intent: "pi_3MtwBwLkdIwHu7ix28a3tqPa",
  refunded: false,
  status: "succeeded",
  ...(refunds === undefined ? {} : { refunds: { object: "list", data: refunds, has_more: false, url: "/v1/charges/ch_3MtwBwLkdIwHu7ix2bKdb3Ft/refunds" } }),
});
