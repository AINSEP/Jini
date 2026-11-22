import type { IntentRequest, NextAction, Outcome, PaymentEvidence, ProviderContext, StripeProviderContext } from "./contract.js";
import { fromStripeAmount, toStripeAmount } from "./amount.js";
import { stripeRequest } from "./http.js";

/** Encodes one validated intent line; null refuses unsupported money before dispatch.
 * The kernel guarantees unit × quantity equals the requested total. O(n) in display text.
 * @example checkoutSessionForm({ req, ctx, errors }) */
export function checkoutSessionForm(
  { req, ctx, errors }: { req: IntentRequest; ctx: ProviderContext; errors: Pick<StripeProviderContext, "moneyProblem"> }, _optional: Record<string, never> = {}
): Array<[string, string]> | null {
  if (toStripeAmount({ money: req.amount, errors }) === null) return null;
  const line = req.line ?? { description: `Payment ${req.correlationId}`, quantity: 1, unitAmount: req.amount };
  const unit = toStripeAmount({ money: line.unitAmount, errors });
  if (unit === null) return null;
  const form: Array<[string, string]> = [
    ["mode", "payment"], ["success_url", ctx.returnUrl], ["cancel_url", ctx.cancelUrl],
    ["client_reference_id", req.correlationId], ["metadata[jini_payment_id]", req.correlationId],
    ["payment_intent_data[metadata][jini_payment_id]", req.correlationId], ["line_items[0][quantity]", String(line.quantity)],
  ];
  if (line.providerPriceRef !== undefined) form.push(["line_items[0][price]", line.providerPriceRef]);
  else form.push(
    ["line_items[0][price_data][currency]", unit.currency], ["line_items[0][price_data][unit_amount]", String(unit.amount)],
    ["line_items[0][price_data][product_data][name]", line.description],
  );
  return form;
}

/** Dispatches exactly once; ambiguous responses stay unknown, mismatched totals give no redirect.
 * @returns Requires-action evidence and redirect, or a typed refusal/unknown outcome.
 * @example await createCheckoutSession({ req, ctx, errors })
 * @complexity O(n) in form/response size, one bounded HTTP call through the supplied port. */
export async function createCheckoutSession(
  { req, ctx, errors }: { req: IntentRequest; ctx: ProviderContext; errors: StripeProviderContext }, _optional: Record<string, never> = {}
): Promise<Outcome<{ evidence: PaymentEvidence; next: NextAction }>> {
  const form = checkoutSessionForm({ req, ctx, errors });
  if (form === null) return { kind: "rejected", error: errors.paymentError({ code: "CURRENCY_UNSUPPORTED", message: "unsupported checkout currency or amount" }) };
  const result = await stripeRequest({ ctx, method: "POST", path: "/v1/checkout/sessions", errors }, { form, idempotencyKey: req.idempotencyKey });
  if (result.kind !== "ok") return result;
  return checkoutSessionOutcome({ req, result, errors });
}

/** Validates the response before exposing a redirect; incomplete fields remain unknown.
 * O(n) time/space in response currency length, with no I/O. */
function checkoutSessionOutcome(
  { req, result, errors }: { req: IntentRequest; result: Extract<Outcome<Readonly<Record<string, unknown>>>, { kind: "ok" }>; errors: StripeProviderContext },
  _optional: Record<string, never> = {}
): Outcome<{ evidence: PaymentEvidence; next: NextAction }> {
  const { id, url, amount_total, currency } = result.value;
  // A session may already exist: never report a missing response field as proof no money moved.
  if (typeof id !== "string" || id.length === 0 || typeof url !== "string" || url.length === 0) return {
    kind: "unknown", error: errors.paymentError({ code: "PROVIDER_ERROR", message: "checkout session response incomplete" }, { retryable: true }),
  };
  const amount = fromStripeAmount({ amount: amount_total, currency, errors });
  if (amount === null || amount.minorUnits !== req.amount.minorUnits || amount.currency !== req.amount.currency) return {
    kind: "rejected", error: errors.paymentError({ code: "INVALID_REQUEST", message: "checkout session total differs from intent" }),
  };
  return { kind: "ok", value: {
    evidence: { providerRef: id, correlationId: req.correlationId, status: "requires_action", amount, refunds: [], disputes: [] },
    next: { kind: "redirect", url },
  } };
}
