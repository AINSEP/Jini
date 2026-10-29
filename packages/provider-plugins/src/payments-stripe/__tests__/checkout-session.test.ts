import { describe, expect, it, vi } from "vitest";
import type { IntentRequest, ProviderContext } from "@jini-ai/commerce/payments/kernel";
import { checkoutSessionForm, createCheckoutSession } from "../checkout-session.js";

const req: IntentRequest = { amount: { minorUnits: 900, currency: "USD" }, correlationId: "pay_1", idempotencyKey: "order:1", captureMode: "auto" };
const session = { id: "cs_1", url: "https://checkout.stripe.com/c/1", amount_total: 900, currency: "usd" };
const context = (send: ProviderContext["httpClient"]["send"]): ProviderContext => ({
  credentials: { secretKey: "test-secret" }, account: { providerAccountId: "acct_1", mode: "test" }, httpClient: { send },
  now: () => 0, webhookUrl: "https://shop.test/hook", returnUrl: "https://shop.test/return", cancelUrl: "https://shop.test/cancel",
});
const setup = (json: unknown = session, status = 200) => {
  const send = vi.fn<ProviderContext["httpClient"]["send"]>(async () => ({ status, headers: {}, bodyText: JSON.stringify(json) }));
  return { send, ctx: context(send) };
};
const base = { mode: "payment", success_url: "https://shop.test/return", cancel_url: "https://shop.test/cancel",
  client_reference_id: "pay_1", "metadata[jini_payment_id]": "pay_1", "payment_intent_data[metadata][jini_payment_id]": "pay_1" };

describe("Stripe Checkout session", () => {
  it.each([false, true])("encodes quantity three with a unit amount or a provider price (%s)", priceRef => {
    const line = { description: "Tea & cake", quantity: 3, unitAmount: { minorUnits: 300, currency: "USD" }, ...(priceRef ? { providerPriceRef: "price_1" } : {}) };
    const form = checkoutSessionForm({ req: { ...req, line }, ctx: setup().ctx }, {});
    expect(Object.fromEntries(form!)).toEqual({ ...base, "line_items[0][quantity]": "3", ...(priceRef
      ? { "line_items[0][price]": "price_1" }
      : { "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": "300", "line_items[0][price_data][product_data][name]": "Tea & cake" }) });
  });
  it("defaults to one unit with the correlation-based name and returns redirect evidence", async () => {
    const { send, ctx } = setup();
    expect(Object.fromEntries(checkoutSessionForm({ req, ctx })!)).toEqual({ ...base, "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": "900", "line_items[0][price_data][product_data][name]": "Payment pay_1" });
    expect(await createCheckoutSession({ req, ctx }, {})).toEqual({ kind: "ok", value: {
      evidence: { providerRef: "cs_1", correlationId: "pay_1", status: "requires_action", amount: req.amount, refunds: [], disputes: [] },
      next: { kind: "redirect", url: session.url },
    } });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0].request;
    expect(sent).toMatchObject({ method: "POST", url: "https://api.stripe.com/v1/checkout/sessions", headers: { "Idempotency-Key": "order:1" } });
    expect(Object.fromEntries(new URLSearchParams(sent.body as string))).toEqual(Object.fromEntries(checkoutSessionForm({ req, ctx })!));
  });
  it.each([false, true])("refuses unsupported currency before HTTP even with a price ref (%s)", priceRef => {
    const { send, ctx } = setup();
    const unsupported = { ...req, amount: { minorUnits: 900, currency: "KWD" }, ...(priceRef ? { line: { description: "Tea", quantity: 1, unitAmount: { minorUnits: 900, currency: "KWD" }, providerPriceRef: "price_1" } } : {}) };
    expect(checkoutSessionForm({ req: unsupported, ctx })).toBeNull();
    return createCheckoutSession({ req: unsupported, ctx }).then(result => {
      expect(result).toMatchObject({ kind: "rejected", error: { code: "CURRENCY_UNSUPPORTED", retryable: false } });
      expect(send).not.toHaveBeenCalled();
    });
  });
  it("refuses an unsupported line unit before HTTP", async () => {
    const { send, ctx } = setup();
    expect(await createCheckoutSession({ req: { ...req, line: { description: "Tea", quantity: 3, unitAmount: { minorUnits: 300, currency: "KWD" } } }, ctx })).toMatchObject({ kind: "rejected", error: { code: "CURRENCY_UNSUPPORTED" } });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{ amount_total: 899 }, { currency: "eur" }, { amount_total: null }, { currency: "kwd" }])("refuses response amount mismatch without a redirect: %j", patch => {
    const { ctx } = setup({ ...session, ...patch });
    return expect(createCheckoutSession({ req, ctx })).resolves.toEqual({ kind: "rejected", error: { code: "INVALID_REQUEST", message: "checkout session total differs from intent", retryable: false } });
  });
  it.each([{ id: undefined }, { id: "" }, { id: 1 }, { url: undefined }, { url: "" }, { url: 1 }])("keeps missing session identity/redirect unresolved: %j", patch => {
    const { ctx } = setup({ ...session, ...patch });
    return expect(createCheckoutSession({ req, ctx })).resolves.toMatchObject({ kind: "unknown", error: { code: "PROVIDER_ERROR", retryable: true } });
  });
  it.each([[400, "rejected", "INVALID_REQUEST"], [503, "unknown", "PROVIDER_ERROR"]] as const)("preserves HTTP %i outcomes", (status, kind, code) => {
    const { ctx, send } = setup({}, status);
    return createCheckoutSession({ req, ctx }).then(result => {
      expect(result).toMatchObject({ kind, error: { code, providerStatus: status } });
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
