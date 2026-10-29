import { paymentError, type PaymentProvider, type ProviderCapabilities } from "@jini-ai/commerce/payments/kernel";
import { STRIPE_CURRENCIES } from "./amount.js";
import { createCheckoutSession } from "./checkout-session.js";
import { stripeRequest } from "./http.js";
import { readSession } from "./session-reading.js";
import { verifyStripeSignature } from "./webhook-signature.js";
import { translateStripeEvent } from "./webhook.js";

export const STRIPE_CAPABILITIES: ProviderCapabilities = { refunds: "none", capture: "auto", void: false, disputes: false,
  retrieve: "payment", echoesCorrelation: true, confirmation: ["redirect"], currencies: STRIPE_CURRENCIES };

/** Retrieves one session with its PI; incomplete or mismatched snapshots cannot confirm money.
 * @returns Evidence or a typed HTTP/unknown outcome; never infers failure from missing evidence.
 * @complexity O(n) in reference/response size; one deadline-bounded HTTP request. */
const retrieve: NonNullable<PaymentProvider["retrieve"]> = async ({ providerRef, ctx }, _optional = {}) => {
  const result = await stripeRequest({ ctx, method: "GET", path: `/v1/checkout/sessions/${encodeURIComponent(providerRef)}?expand%5B%5D=payment_intent` });
  if (result.kind !== "ok") return result;
  const reading = readSession({ object: result.value, mode: ctx.account.mode });
  if (reading.kind !== "evidence" || reading.evidence.providerRef !== providerRef) return {
    kind: "unknown", error: paymentError({ code: "PROVIDER_ERROR", message: "checkout session evidence could not be confirmed" }, { retryable: true }),
  };
  return { kind: "ok", value: reading.evidence };
};

/** Verifies exact bytes before JSON parsing and translates only authenticated events.
 * @returns Facts, an empty ignored set, or a typed signature/payload rejection; no HTTP.
 * @complexity O(n) time/space in signed body/header bytes. */
const verifyWebhook: PaymentProvider["verifyWebhook"] = async ({ rawBody, headers, ctx }, _optional = {}) => {
  if (!verifyStripeSignature({ rawBody, header: headers["stripe-signature"], secret: ctx.credentials.webhookSecret ?? "", nowMs: ctx.now() })) return {
    kind: "rejected", error: paymentError({ code: "SIGNATURE_INVALID", message: "invalid webhook signature" }),
  };
  let event: unknown;
  try { event = JSON.parse(Buffer.from(rawBody).toString("utf8")); } catch {
    return { kind: "rejected", error: paymentError({ code: "INVALID_REQUEST", message: "invalid webhook JSON" }) };
  }
  const translated = translateStripeEvent({ event, mode: ctx.account.mode });
  if (translated.kind === "malformed") return { kind: "rejected", error: paymentError({ code: "INVALID_REQUEST", message: translated.reason }) };
  return { kind: "ok", value: translated.kind === "ignored" ? [] : translated.facts };
};

/** Assembles the stateless Phase 1 translator; credentials and I/O remain per-call host ports.
 * @returns A commerce provider with hosted Checkout, signed webhooks and payment retrieval.
 * @complexity O(1) assembly; methods retain no account state.
 * @example createStripePaymentProvider({}) */
export function createStripePaymentProvider(
  _required: Record<string, never>, _optional: Record<string, never> = {}
): PaymentProvider {
  return { id: "stripe", displayName: "Stripe", credentialKeys: ["secretKey", "webhookSecret"], capabilities: STRIPE_CAPABILITIES,
    createIntent: (required, _optional = {}) => createCheckoutSession(required), retrieve, verifyWebhook };
}
