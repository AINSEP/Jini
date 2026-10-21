/**
 * Wire-level contract of every provider operation: the exact request Stripe receives (method, URL,
 * headers, form body) and the evidence built from Stripe's documented response objects.
 */
import { describe, expect, it } from "vitest";
import type { IntentRequest } from "@jini-ai/commerce/payments/kernel";
import defaultProvider, { createStripeProvider, STRIPE_API_VERSION } from "../index.js";
import {
  intentCanceled,
  intentPartiallyCaptured,
  intentRequiresActionRedirect,
  intentRequiresCapture,
  intentRequiresPaymentMethod,
  intentSucceeded,
} from "./fixtures/payment-intent.js";
import { dispute, disputeList, disputeNeedsResponse } from "./fixtures/dispute.js";
import { refund, refundList, refundPending, refundSucceeded } from "./fixtures/refund.js";
import { AUTH, fakeHttp, form, makeContext } from "./support.js";

const PI = "pi_3MtwBwLkdIwHu7ix28a3tqPa";
const usd = (minorUnits: number) => ({ minorUnits, currency: "USD" });
const intentReq = (overrides: Partial<IntentRequest> = {}): IntentRequest => ({
  amount: usd(2000), idempotencyKey: "idem-intent-1", correlationId: "pay_1", captureMode: "auto", ...overrides,
});
const postHeaders = (idempotencyKey: string) => ({
  Authorization: AUTH,
  "Stripe-Version": STRIPE_API_VERSION,
  "Idempotency-Key": idempotencyKey,
  "Content-Type": "application/x-www-form-urlencoded",
});
const getHeaders = { Authorization: AUTH, "Stripe-Version": STRIPE_API_VERSION };

describe("identity", () => {
  it("declares Stripe's capabilities and credential slots; the default export is a ready instance", () => {
    expect(defaultProvider.id).toBe("stripe");
    expect(defaultProvider.displayName).toBe("Stripe");
    expect(defaultProvider.capabilities).toEqual({
      refunds: "partial", capture: "manual", void: true, disputes: true, retrieve: "payment+refunds",
      echoesCorrelation: true, confirmation: ["none", "redirect", "client_action"], currencies: "any",
    });
    expect(defaultProvider.credentialKeys).toEqual(["secretKey", "webhookSecret", "webhookSecretPrevious"]);
  });
});

describe("createIntent", () => {
  it("POSTs a form-encoded PaymentIntent with the idempotency key, our id in metadata and lowercase currency", async () => {
    const http = fakeHttp({ status: 200, body: intentRequiresPaymentMethod });
    const outcome = await createStripeProvider().createIntent({ req: intentReq(), ctx: makeContext(http) });
    expect(http.requests).toEqual([{
      method: "POST", url: "https://api.stripe.com/v1/payment_intents", headers: postHeaders("idem-intent-1"),
      body: "amount=2000&currency=usd&capture_method=automatic&metadata%5Bjini_payment_id%5D=pay_1", idleTimeoutMs: 30_000,
    }]);
    expect(outcome).toEqual({
      kind: "ok",
      value: {
        evidence: {
          providerRef: PI, correlationId: "pay_1", status: "pending", amount: usd(2000),
          next: { kind: "client_action", payload: { client_secret: intentRequiresPaymentMethod.client_secret } }, refunds: [], disputes: [],
        },
        next: { kind: "client_action", payload: { client_secret: intentRequiresPaymentMethod.client_secret } },
      },
    });
  });

  it("manual capture authorizes only, with captured 0", async () => {
    const http = fakeHttp({ status: 200, body: intentRequiresCapture });
    const outcome = await createStripeProvider().createIntent({ req: intentReq({ captureMode: "manual" }), ctx: makeContext(http) });
    expect(form(http.requests[0])).toContainEqual(["capture_method", "manual"]);
    expect(outcome).toMatchObject({ kind: "ok", value: { evidence: { status: "authorized", captured: usd(0) }, next: { kind: "none" } } });
  });

  it("a payment method in providerOptions confirms server-side with the return URL; a redirect comes back as next", async () => {
    const http = fakeHttp({ status: 200, body: intentRequiresActionRedirect });
    const outcome = await createStripeProvider().createIntent({ req: intentReq({ providerOptions: { paymentMethod: "pm_card_visa" } }), ctx: makeContext(http) });
    expect(form(http.requests[0])).toEqual([
      ["amount", "2000"], ["currency", "usd"], ["capture_method", "automatic"], ["metadata[jini_payment_id]", "pay_1"],
      ["payment_method", "pm_card_visa"], ["confirm", "true"], ["return_url", "https://shop.example/checkout/return"],
    ]);
    const url = "https://hooks.stripe.com/3d_secure_2/hosted?merchant=acct_1&payment_intent=pi_3MtwBwLkdIwHu7ix28a3tqPa";
    expect(outcome).toMatchObject({ kind: "ok", value: { evidence: { status: "requires_action", next: { kind: "redirect", url } }, next: { kind: "redirect", url } } });
  });

  it("omits return_url when the host has none, and ignores a non-string payment method", async () => {
    const http = fakeHttp({ status: 200, body: intentSucceeded }, { status: 200, body: intentSucceeded });
    const provider = createStripeProvider();
    await provider.createIntent({ req: intentReq({ providerOptions: { paymentMethod: "pm_x" } }), ctx: makeContext(http, { returnUrl: "" }) });
    await provider.createIntent({ req: intentReq({ providerOptions: { paymentMethod: 42 } }), ctx: makeContext(http) });
    expect(form(http.requests[0]).map(([key]) => key)).toEqual(["amount", "currency", "capture_method", "metadata[jini_payment_id]", "payment_method", "confirm"]);
    expect(form(http.requests[1]).map(([key]) => key)).toEqual(["amount", "currency", "capture_method", "metadata[jini_payment_id]"]);
  });

  it("scales ISK/UGX to Stripe's two-decimal wire amount", async () => {
    const http = fakeHttp({ status: 200, body: { ...intentRequiresPaymentMethod, amount: 50_000, currency: "isk" } });
    const outcome = await createStripeProvider().createIntent({ req: intentReq({ amount: { minorUnits: 500, currency: "ISK" } }), ctx: makeContext(http) });
    expect(form(http.requests[0]).slice(0, 2)).toEqual([["amount", "50000"], ["currency", "isk"]]);
    expect(outcome).toMatchObject({ kind: "ok", value: { evidence: { amount: { minorUnits: 500, currency: "ISK" } } } });
  });

  it("honours apiBase (trailing slash dropped), apiVersion, timeout and the abort signal", async () => {
    const http = fakeHttp({ status: 200, body: intentSucceeded });
    const signal = new AbortController().signal;
    const provider = createStripeProvider({}, { apiBase: "http://stripe-mock.local:12111//", apiVersion: "2025-01-27.acacia", timeoutMs: 5000 });
    await provider.createIntent({ req: intentReq(), ctx: makeContext(http) }, { signal });
    expect(http.requests[0]).toMatchObject({ url: "http://stripe-mock.local:12111/v1/payment_intents", idleTimeoutMs: 5000, signal });
    expect(http.requests[0]?.headers["Stripe-Version"]).toBe("2025-01-27.acacia");
  });

  it("refuses locally, without a request, when the secret key slot is empty", async () => {
    const http = fakeHttp();
    const outcome = await createStripeProvider().createIntent({ req: intentReq(), ctx: makeContext(http, { credentials: { webhookSecret: "x" } }) });
    expect(outcome).toEqual({ kind: "rejected", error: { code: "NO_CREDENTIALS_CONFIGURED", message: "stripe: credential slot 'secretKey' is empty", retryable: false } });
    expect(http.requests).toEqual([]);
  });

  it("a 2xx that is not a readable PaymentIntent is unknown (Stripe acted; we cannot tell how)", async () => {
    for (const body of [{ ...intentRequiresPaymentMethod, status: "bogus" }, { object: "payment_intent" }, [1, 2]]) {
      const outcome = await createStripeProvider().createIntent({ req: intentReq(), ctx: makeContext(fakeHttp({ status: 200, body })) });
      expect(outcome).toMatchObject({ kind: "unknown", error: { code: "PROVIDER_ERROR", retryable: true, providerStatus: 200 } });
    }
    const text = await createStripeProvider().createIntent({ req: intentReq(), ctx: makeContext(fakeHttp({ status: 200, text: "<html>" })) });
    expect(text).toMatchObject({ kind: "unknown", error: { message: "stripe: HTTP 200 body is not a valid JSON object" } });
  });
});

describe("refund", () => {
  it("POSTs payment_intent + amount + our refund id, with the idempotency key", async () => {
    const http = fakeHttp({ status: 200, body: refundSucceeded });
    const outcome = await createStripeProvider().refund!({
      req: { providerRef: PI, amount: usd(500), idempotencyKey: "idem-refund-1", correlationId: "ref_1" }, ctx: makeContext(http),
    });
    expect(http.requests).toEqual([{
      method: "POST", url: "https://api.stripe.com/v1/refunds", headers: postHeaders("idem-refund-1"),
      body: `payment_intent=${PI}&amount=500&metadata%5Bjini_refund_id%5D=ref_1`, idleTimeoutMs: 30_000,
    }]);
    expect(outcome).toEqual({ kind: "ok", value: { providerRefundRef: refundSucceeded.id, correlationId: "ref_1", amount: usd(500), status: "succeeded" } });
  });

  it("sends a Stripe reason as `reason` and any other text as metadata (truncated to 500)", async () => {
    const http = fakeHttp({ status: 200, body: refundPending }, { status: 200, body: refundPending });
    const provider = createStripeProvider();
    const req = { providerRef: PI, amount: usd(500), idempotencyKey: "k", correlationId: "ref_1" };
    await provider.refund!({ req, ctx: makeContext(http) }, { reason: "requested_by_customer" });
    const outcome = await provider.refund!({ req, ctx: makeContext(http) }, { reason: "x".repeat(600) });
    expect(form(http.requests[0]).at(-1)).toEqual(["reason", "requested_by_customer"]);
    expect(form(http.requests[1]).at(-1)).toEqual(["metadata[jini_refund_reason]", "x".repeat(500)]);
    expect(outcome).toMatchObject({ kind: "ok", value: { status: "pending" } });
  });

  it("a 2xx that is not a Refund is unknown", async () => {
    const outcome = await createStripeProvider().refund!({
      req: { providerRef: PI, amount: usd(500), idempotencyKey: "k", correlationId: "r" }, ctx: makeContext(fakeHttp({ status: 200, body: { id: "re_1" } })),
    });
    expect(outcome).toMatchObject({ kind: "unknown", error: { message: "stripe: HTTP 200 body is not a valid Refund" } });
  });
});

describe("capture and void", () => {
  it("capture POSTs amount_to_capture to /capture and returns the captured amount", async () => {
    const http = fakeHttp({ status: 200, body: intentPartiallyCaptured });
    const outcome = await createStripeProvider().capture!({ req: { providerRef: PI, amount: usd(1500), idempotencyKey: "idem-cap" }, ctx: makeContext(http) });
    expect(http.requests).toEqual([{
      method: "POST", url: `https://api.stripe.com/v1/payment_intents/${PI}/capture`, headers: postHeaders("idem-cap"),
      body: "amount_to_capture=1500", idleTimeoutMs: 30_000,
    }]);
    expect(outcome).toMatchObject({ kind: "ok", value: { status: "succeeded", amount: usd(2000), captured: usd(1500) } });
  });

  it("void POSTs an empty form to /cancel and returns canceled", async () => {
    const http = fakeHttp({ status: 200, body: intentCanceled });
    const outcome = await createStripeProvider().void!({ req: { providerRef: "pi/../x", idempotencyKey: "idem-void" }, ctx: makeContext(http) });
    expect(http.requests).toEqual([{
      method: "POST", url: "https://api.stripe.com/v1/payment_intents/pi%2F..%2Fx/cancel", headers: postHeaders("idem-void"), body: "", idleTimeoutMs: 30_000,
    }]);
    expect(outcome).toMatchObject({ kind: "ok", value: { status: "canceled", next: { kind: "none" } } });
  });
});

describe("retrieve", () => {
  it("GETs the intent, its refunds and the latest charge's disputes, and merges them", async () => {
    const http = fakeHttp(
      { status: 200, body: intentSucceeded },
      { status: 200, body: refundList([refundSucceeded, refund({ id: "re_2", amount: 300, metadata: {} })]) },
      { status: 200, body: disputeList([disputeNeedsResponse]) },
    );
    const outcome = await createStripeProvider().retrieve!({ providerRef: PI, ctx: makeContext(http) });
    expect(http.requests.map((r) => [r.method, r.url, r.headers, r.body])).toEqual([
      ["GET", `https://api.stripe.com/v1/payment_intents/${PI}`, getHeaders, undefined],
      ["GET", `https://api.stripe.com/v1/refunds?payment_intent=${PI}&limit=100`, getHeaders, undefined],
      ["GET", "https://api.stripe.com/v1/disputes?charge=ch_3MtwBwLkdIwHu7ix2bKdb3Ft&limit=100", getHeaders, undefined],
    ]);
    expect(outcome).toEqual({
      kind: "ok",
      value: {
        providerRef: PI, correlationId: "pay_1", status: "succeeded", amount: usd(2000), captured: usd(2000), next: { kind: "none" },
        refunds: [
          { providerRefundRef: refundSucceeded.id, correlationId: "ref_1", amount: usd(500), status: "succeeded" },
          { providerRefundRef: "re_2", amount: usd(300), status: "succeeded" },
        ],
        disputes: [{ providerDisputeRef: disputeNeedsResponse.id, amount: usd(2000), status: "open", dueBy: 1693612799_000 }],
      },
    });
  });

  it("follows has_more pages with starting_after, and an expanded latest_charge object", async () => {
    const http = fakeHttp(
      { status: 200, body: { ...intentSucceeded, latest_charge: { id: "ch_exp", object: "charge" } } },
      { status: 200, body: refundList([refund({ id: "re_a" })], true) },
      { status: 200, body: refundList([refund({ id: "re_b" })]) },
      { status: 200, body: disputeList([]) },
    );
    const outcome = await createStripeProvider().retrieve!({ providerRef: PI, ctx: makeContext(http) });
    expect(http.requests.map((r) => r.url.replace("https://api.stripe.com", ""))).toEqual([
      `/v1/payment_intents/${PI}`, `/v1/refunds?payment_intent=${PI}&limit=100`, `/v1/refunds?payment_intent=${PI}&limit=100&starting_after=re_a`,
      "/v1/disputes?charge=ch_exp&limit=100",
    ]);
    expect(outcome).toMatchObject({ kind: "ok", value: { refunds: [{ providerRefundRef: "re_a" }, { providerRefundRef: "re_b" }], disputes: [] } });
  });

  it("an intent without a charge asks for no disputes", async () => {
    const http = fakeHttp({ status: 200, body: intentRequiresPaymentMethod }, { status: 200, body: refundList([]) });
    const outcome = await createStripeProvider().retrieve!({ providerRef: PI, ctx: makeContext(http) });
    expect(http.requests).toHaveLength(2);
    expect(outcome).toMatchObject({ kind: "ok", value: { status: "pending", refunds: [], disputes: [] } });
  });

  it("a list that never ends within maxListPages is unknown rather than a partial snapshot", async () => {
    const http = fakeHttp(
      { status: 200, body: intentRequiresPaymentMethod },
      { status: 200, body: refundList([refund({ id: "re_a" })], true) },
      { status: 200, body: refundList([refund({ id: "re_b" })], true) },
    );
    const outcome = await createStripeProvider({}, { maxListPages: 2 }).retrieve!({ providerRef: PI, ctx: makeContext(http) });
    expect(outcome).toMatchObject({ kind: "unknown", error: { message: "stripe: HTTP 200 body is not a valid list within 2 pages" } });
  });

  it.each([
    ["an unreadable refund", refundList([refund({ status: "weird" })])],
    ["a non-object refund", refundList(["re_1"])],
    ["a page without data", { object: "list", has_more: false }],
    ["a page without has_more", { object: "list", data: [] }],
    ["a has_more page whose last element has no id", refundList([refund({ id: "" })], true)],
  ])("%s makes the whole retrieve unknown", async (_label, page) => {
    const http = fakeHttp({ status: 200, body: intentRequiresPaymentMethod }, { status: 200, body: page });
    const outcome = await createStripeProvider().retrieve!({ providerRef: PI, ctx: makeContext(http) });
    expect(outcome).toMatchObject({ kind: "unknown", error: { code: "PROVIDER_ERROR" } });
  });

  it("an empty has_more page (no last element) is unknown too", async () => {
    const http = fakeHttp({ status: 200, body: intentRequiresPaymentMethod }, { status: 200, body: refundList([], true) });
    expect(await createStripeProvider().retrieve!({ providerRef: PI, ctx: makeContext(http) })).toMatchObject({ kind: "unknown" });
  });

  it("propagates a failure of the intent, refunds or disputes call", async () => {
    const provider = createStripeProvider();
    const notFound = { status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such payment_intent" } } };
    expect(await provider.retrieve!({ providerRef: PI, ctx: makeContext(fakeHttp(notFound)) })).toMatchObject({ kind: "rejected", error: { code: "INVALID_REQUEST", providerStatus: 404 } });
    const refundsDown = fakeHttp({ status: 200, body: intentSucceeded }, { status: 503, text: "" });
    expect(await provider.retrieve!({ providerRef: PI, ctx: makeContext(refundsDown) })).toMatchObject({ kind: "unknown", error: { providerStatus: 503 } });
    const disputesDown = fakeHttp({ status: 200, body: intentSucceeded }, { status: 200, body: refundList([]) }, { throws: new Error("ECONNRESET") });
    expect(await provider.retrieve!({ providerRef: PI, ctx: makeContext(disputesDown) })).toMatchObject({ kind: "unknown", error: { code: "TRANSPORT_ERROR" } });
    const badDispute = fakeHttp({ status: 200, body: intentSucceeded }, { status: 200, body: refundList([]) }, { status: 200, body: disputeList([dispute({ status: "?" })]) });
    expect(await provider.retrieve!({ providerRef: PI, ctx: makeContext(badDispute) })).toMatchObject({ kind: "unknown" });
  });

  it("an unreadable intent is unknown; an empty providerRef is refused without a request", async () => {
    const provider = createStripeProvider();
    expect(await provider.retrieve!({ providerRef: PI, ctx: makeContext(fakeHttp({ status: 200, body: { id: PI } })) })).toMatchObject({ kind: "unknown" });
    const http = fakeHttp();
    expect(await provider.retrieve!({ providerRef: "", ctx: makeContext(http) })).toMatchObject({ kind: "rejected", error: { code: "INVALID_REQUEST" } });
    expect(http.requests).toEqual([]);
  });
});
