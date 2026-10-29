import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ProviderContext } from "@jini-ai/commerce/payments/kernel";
import { providerConformanceCases } from "@jini-ai/commerce/payments/testkit";
import { createStripePaymentProvider } from "../provider.js";

const provider = createStripePaymentProvider({}, {});
const session = { object: "checkout.session", id: "cs_1", mode: "payment", livemode: false, metadata: { jini_payment_id: "pay_1" },
  amount_total: 900, currency: "usd", status: "complete", payment_status: "paid", url: "https://checkout.stripe.com/c/1" };
const evidence = { providerRef: "cs_1", correlationId: "pay_1", status: "succeeded", amount: { minorUnits: 900, currency: "USD" }, refunds: [], disputes: [] };
const context = (json: unknown = session, status = 200) => {
  const send = vi.fn<ProviderContext["httpClient"]["send"]>(async () => ({ status, headers: {}, bodyText: JSON.stringify(json) }));
  const ctx: ProviderContext = { credentials: { secretKey: "sk_test_only", webhookSecret: "whsec_test_only" },
    account: { providerAccountId: "acct_1", mode: "test" }, httpClient: { send }, now: () => 1730000123000,
    returnUrl: "https://shop.test/return", cancelUrl: "https://shop.test/cancel", webhookUrl: "https://shop.test/hook" };
  return { send, ctx };
};
const webhook = (body: unknown) => {
  const rawBody = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const signature = createHmac("sha256", "whsec_test_only").update(Buffer.concat([Buffer.from("1730000123."), rawBody])).digest("hex");
  return { rawBody, headers: { "stripe-signature": `t=1730000123,v1=${signature}` } };
};
const event = (object: unknown = session, type = "checkout.session.completed") => ({ id: "evt_1", type, created: 1730000123, livemode: false, data: { object } });

describe("Stripe commerce provider", () => {
  it.each(providerConformanceCases({ provider, makeContext: () => context().ctx }))("conforms: $name", async entry => entry.run());
  it("declares only Phase 1 capabilities and the credential slots", () => {
    expect(createStripePaymentProvider({})).toMatchObject({ id: "stripe", displayName: "Stripe", credentialKeys: ["secretKey", "webhookSecret"],
      capabilities: { refunds: "none", capture: "auto", void: false, disputes: false, retrieve: "payment", echoesCorrelation: true, confirmation: ["redirect"],
        currencies: ["AUD", "BRL", "CAD", "CHF", "CZK", "DKK", "EUR", "GBP", "HKD", "JPY", "KRW", "MXN", "NOK", "NZD", "PLN", "SEK", "SGD", "USD"] } });
    expect([provider.refund, provider.capture, provider.void]).toEqual([undefined, undefined, undefined]);
  });
  it("wires createIntent through the real session adapter", async () => {
    const { ctx, send } = context();
    const req = { correlationId: "pay_1", idempotencyKey: "order:1", captureMode: "auto" as const, amount: evidence.amount };
    expect(await provider.createIntent({ req, ctx }, {})).toEqual({ kind: "ok", value: { evidence: { ...evidence, status: "requires_action" }, next: { kind: "redirect", url: session.url } } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].request).toMatchObject({ method: "POST", headers: { "Idempotency-Key": "order:1" } });
  });
  it.each([[{ status: "canceled" }, "failed"], ["pi_1", "pending"]])("retrieves with expanded PI and honors its evidence: %j", async (payment_intent, status) => {
    const { ctx, send } = context({ ...session, payment_status: "unpaid", payment_intent, id: "cs_1/?#" });
    expect(await provider.retrieve!({ providerRef: "cs_1/?#", ctx }, {})).toEqual({ kind: "ok", value: { ...evidence, providerRef: "cs_1/?#", status } });
    expect(send).toHaveBeenCalledExactlyOnceWith({ request: { method: "GET", url: "https://api.stripe.com/v1/checkout/sessions/cs_1%2F%3F%23?expand%5B%5D=payment_intent",
      headers: { Authorization: "Bearer sk_test_only" }, timeoutMs: 30000, totalDeadlineMs: 30000 } });
  });
  it.each([[404, "rejected", "INVALID_REQUEST"], [503, "unknown", "PROVIDER_ERROR"]])("preserves retrieval HTTP outcome %s", async (status, kind, code) => {
    const { ctx } = context({}, status as number);
    expect(await provider.retrieve!({ providerRef: "cs_1", ctx })).toMatchObject({ kind, error: { code } });
  });
  it.each([{ metadata: {} }, { mode: "subscription" }, { amount_total: undefined }, { id: "cs_other" }, { livemode: true }])("keeps inconclusive/mismatched retrieval unknown: %j", async patch => {
    const { ctx } = context({ ...session, ...patch });
    expect(await provider.retrieve!({ providerRef: "cs_1", ctx })).toMatchObject({ kind: "unknown", error: { code: "PROVIDER_ERROR", retryable: true } });
  });
  it.each([false, true])("rejects bad signatures before parsing or HTTP; missing secret=%s", async missingSecret => {
    const { ctx, send } = context();
    const input = missingSecret ? webhook(event()) : { rawBody: Buffer.from("{"), headers: { "stripe-signature": "bad" } };
    expect(await provider.verifyWebhook({ ...input, ctx: { ...ctx, credentials: missingSecret ? {} : ctx.credentials } }))
      .toMatchObject({ kind: "rejected", error: { code: "SIGNATURE_INVALID", retryable: false } });
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["{", {}, { ...event(), livemode: true }, event({ ...session, object: "payment_intent" })])("rejects signed malformed input: %j", async body => {
    expect(await provider.verifyWebhook({ ...webhook(body), ctx: context().ctx }, {})).toMatchObject({ kind: "rejected", error: { code: "INVALID_REQUEST", retryable: false } });
  });
  it.each([event({}, "payment_intent.succeeded"), event({})])("acknowledges ignored verified events: %j", async body => {
    expect(await provider.verifyWebhook({ ...webhook(body), ctx: context().ctx })).toEqual({ kind: "ok", value: [] });
  });
  it.each([false, true])("returns stable facts from independently signed bytes; incomplete=%s", async incomplete => {
    const body = event(incomplete ? { ...session, amount_total: undefined } : session);
    const expected = { kind: "ok", value: [{ providerEventId: "evt_1", providerRef: "cs_1", occurredAt: 1730000123000, ...(incomplete ? {} : { evidence }) }] };
    const { ctx, send } = context();
    expect(await provider.verifyWebhook({ ...webhook(` ${JSON.stringify(body)}\n`), ctx })).toEqual(expected);
    expect(await provider.verifyWebhook({ ...webhook(body), ctx })).toEqual(expected);
    expect(send).not.toHaveBeenCalled();
  });
});
