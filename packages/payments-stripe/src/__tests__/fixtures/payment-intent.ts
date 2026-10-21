/**
 * Synthetic from docs — needs sandbox recording.
 * Shapes follow Stripe's documented PaymentIntent object (https://docs.stripe.com/api/payment_intents/object)
 * at API version 2024-06-20. No live keys or real account data. Replace with recorded sandbox
 * responses before relying on any field this file does not exercise.
 */

/** A fresh automatic-capture intent, as `POST /v1/payment_intents` returns it. */
export const intentRequiresPaymentMethod = {
  id: "pi_3MtwBwLkdIwHu7ix28a3tqPa",
  object: "payment_intent",
  amount: 2000,
  amount_capturable: 0,
  amount_details: { tip: {} },
  amount_received: 0,
  application: null,
  application_fee_amount: null,
  automatic_payment_methods: { enabled: true },
  canceled_at: null,
  cancellation_reason: null,
  capture_method: "automatic",
  client_secret: "pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH",
  confirmation_method: "automatic",
  created: 1680800504,
  currency: "usd",
  customer: null,
  description: null,
  last_payment_error: null,
  latest_charge: null,
  livemode: false,
  metadata: { jini_payment_id: "pay_1" },
  next_action: null,
  on_behalf_of: null,
  payment_method: null,
  payment_method_options: { card: { installments: null, mandate_options: null, network: null, request_three_d_secure: "automatic" } },
  payment_method_types: ["card"],
  processing: null,
  receipt_email: null,
  review: null,
  setup_future_usage: null,
  shipping: null,
  source: null,
  statement_descriptor: null,
  statement_descriptor_suffix: null,
  status: "requires_payment_method",
  transfer_data: null,
  transfer_group: null,
} as const;

type Intent = Record<string, unknown>;
const intent = (overrides: Intent): Intent => ({ ...intentRequiresPaymentMethod, ...overrides });

/** A declined attempt leaves the intent back at `requires_payment_method` with `last_payment_error`. */
export const intentDeclined = intent({
  last_payment_error: { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: "Your card was declined." },
  latest_charge: "ch_3MtwBwLkdIwHu7ix2bKdb3Ft",
});

export const intentRequiresConfirmation = intent({ status: "requires_confirmation", payment_method: "pm_card_visa" });
export const intentProcessing = intent({ status: "processing", payment_method: "pm_card_visa" });

/** 3-D Secure via redirect (`next_action.type = redirect_to_url`). */
export const intentRequiresActionRedirect = intent({
  status: "requires_action",
  payment_method: "pm_card_threeDSecure2Required",
  next_action: { type: "redirect_to_url", redirect_to_url: { return_url: "https://shop.example/return", url: "https://hooks.stripe.com/3d_secure_2/hosted?merchant=acct_1&payment_intent=pi_3MtwBwLkdIwHu7ix28a3tqPa" } },
});

/** 3-D Secure handled by Stripe.js (`next_action.type = use_stripe_sdk`). */
export const intentRequiresActionSdk = intent({
  status: "requires_action",
  payment_method: "pm_card_threeDSecure2Required",
  next_action: { type: "use_stripe_sdk", use_stripe_sdk: { type: "three_d_secure_redirect", stripe_js: "https://hooks.stripe.com/redirect/authenticate/src_1" } },
});

/** A manual-capture intent after authorization. */
export const intentRequiresCapture = intent({
  status: "requires_capture",
  capture_method: "manual",
  amount_capturable: 2000,
  payment_method: "pm_card_visa",
  latest_charge: "ch_3MtwBwLkdIwHu7ix2bKdb3Ft",
});

export const intentSucceeded = intent({
  status: "succeeded",
  amount_received: 2000,
  payment_method: "pm_card_visa",
  latest_charge: "ch_3MtwBwLkdIwHu7ix2bKdb3Ft",
});

/** Partial capture of a manual intent: 1500 of 2000 received. */
export const intentPartiallyCaptured = intent({
  status: "succeeded",
  capture_method: "manual",
  amount_received: 1500,
  latest_charge: "ch_3MtwBwLkdIwHu7ix2bKdb3Ft",
});

export const intentCanceled = intent({ status: "canceled", canceled_at: 1680800600, cancellation_reason: "requested_by_customer", capture_method: "manual" });
