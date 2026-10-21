/**
 * Webhooks: Stripe-Signature verification over the exact bytes (rotation, several v1, tamper,
 * replay window, malformed header, no secret) and event → WebhookFact translation.
 */
import { describe, expect, it } from "vitest";
import { createStripeProvider, parseStripeSignatureHeader, signStripePayload, verifyStripeSignature } from "../index.js";
import { parseStripeEvent } from "../events.js";
import { dispute, disputeNeedsResponse } from "./fixtures/dispute.js";
import { chargeRefunded, event } from "./fixtures/event.js";
import { intentDeclined, intentSucceeded } from "./fixtures/payment-intent.js";
import { refund, refundSucceeded } from "./fixtures/refund.js";
import { fakeHttp, makeContext, NOW_MS, WEBHOOK_SECRET, WEBHOOK_SECRET_PREVIOUS } from "./support.js";

const PI = "pi_3MtwBwLkdIwHu7ix28a3tqPa";
const T = NOW_MS / 1000;
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const sign = (rawBody: Uint8Array, secret = WEBHOOK_SECRET, timestamp = T) => signStripePayload({ secret, timestamp, rawBody });
const header = (rawBody: Uint8Array, ...signatures: string[]) => ({ "Stripe-Signature": `t=${T},${(signatures.length ? signatures : [sign(rawBody)]).map((s) => `v1=${s}`).join(",")}` });

const provider = createStripeProvider();
const verify = (rawBody: Uint8Array, headers: Record<string, string>, ctxOverrides: Parameters<typeof makeContext>[1] = {}) =>
  provider.verifyWebhook({ rawBody, headers, ctx: makeContext(fakeHttp(), ctxOverrides) });

describe("signature verification", () => {
  const body = bytes(event("payment_intent.succeeded", intentSucceeded));

  it("accepts a valid signature over the exact bytes", async () => {
    expect(await verify(body, header(body))).toMatchObject({ kind: "ok" });
  });

  it("matches Stripe's documented HMAC-SHA256 of `${t}.${body}`", () => {
    // Independent vector: HMAC-SHA256(key="whsec_test", "1600000000.{}") computed with openssl.
    // `printf '1600000000.{}' | openssl dgst -sha256 -hmac whsec_test`
    expect(signStripePayload({ secret: "whsec_test", timestamp: 1600000000, rawBody: bytes("{}") })).toBe(
      "0a6188eb14ea9e46795a5a3941d81e88ec1805dc5e474147ee2386660589a795",
    );
  });

  it("accepts a body signed with the previous secret during rotation", async () => {
    const ctx = { credentials: { secretKey: "sk", webhookSecret: WEBHOOK_SECRET, webhookSecretPrevious: WEBHOOK_SECRET_PREVIOUS } };
    expect(await verify(body, header(body, sign(body, WEBHOOK_SECRET_PREVIOUS)), ctx)).toMatchObject({ kind: "ok" });
  });

  it("ignores an empty previous slot, so it can never match an empty-key signature", async () => {
    const ctx = { credentials: { secretKey: "sk", webhookSecret: WEBHOOK_SECRET, webhookSecretPrevious: "" } };
    expect(await verify(body, header(body, sign(body, "")), ctx)).toMatchObject({ kind: "rejected", error: { code: "SIGNATURE_INVALID" } });
  });

  it("accepts when any of several v1 signatures matches (Stripe rolling its secret)", async () => {
    expect(await verify(body, header(body, "0".repeat(64), sign(body)))).toMatchObject({ kind: "ok" });
  });

  it("reads the header case-insensitively and ignores other schemes", async () => {
    const headers = { "stripe-signature": `t=${T},v0=${"f".repeat(64)},v1=${sign(body)}` };
    expect(await verify(body, headers)).toMatchObject({ kind: "ok" });
  });

  it.each([
    ["a tampered body", (b: Uint8Array) => ({ rawBody: bytes(new TextDecoder().decode(b).replace("2000", "2001")), headers: header(b) })],
    ["a stale timestamp", (b: Uint8Array) => ({ rawBody: b, headers: { "Stripe-Signature": `t=${T - 301},v1=${sign(b, WEBHOOK_SECRET, T - 301)}` } })],
    ["a far-future timestamp", (b: Uint8Array) => ({ rawBody: b, headers: { "Stripe-Signature": `t=${T + 301},v1=${sign(b, WEBHOOK_SECRET, T + 301)}` } })],
    ["a wrong secret", (b: Uint8Array) => ({ rawBody: b, headers: header(b, sign(b, "whsec_other")) })],
    ["no header", (b: Uint8Array) => ({ rawBody: b, headers: {} })],
    ["a header without t", (b: Uint8Array) => ({ rawBody: b, headers: { "Stripe-Signature": `v1=${sign(b)}` } })],
    ["a header without v1", (b: Uint8Array) => ({ rawBody: b, headers: { "Stripe-Signature": `t=${T}` } })],
    ["a non-hex v1", (b: Uint8Array) => ({ rawBody: b, headers: { "Stripe-Signature": `t=${T},v1=${"z".repeat(64)}` } })],
    ["a bare key", (b: Uint8Array) => ({ rawBody: b, headers: { "Stripe-Signature": `t,v1` } })],
  ])("rejects %s with SIGNATURE_INVALID", async (_label, make) => {
    const { rawBody, headers } = make(body);
    expect(await verify(rawBody, headers)).toMatchObject({ kind: "rejected", error: { code: "SIGNATURE_INVALID", retryable: false } });
  });

  it("accepts a timestamp exactly at the tolerance edge, and honours a custom tolerance", async () => {
    const edge = { "Stripe-Signature": `t=${T - 300},v1=${sign(body, WEBHOOK_SECRET, T - 300)}` };
    expect(await verify(body, edge)).toMatchObject({ kind: "ok" });
    const strict = createStripeProvider({}, { toleranceSec: 10 });
    expect(await strict.verifyWebhook({ rawBody: body, headers: edge, ctx: makeContext(fakeHttp()) })).toMatchObject({ kind: "rejected" });
  });

  it("rejects when no webhook secret is configured", async () => {
    const outcome = await verify(body, header(body), { credentials: { secretKey: "sk" } });
    expect(outcome).toEqual({ kind: "rejected", error: { code: "SIGNATURE_INVALID", message: "stripe: no webhook secret is configured", retryable: false } });
  });

  it("parseStripeSignatureHeader / verifyStripeSignature are usable directly", () => {
    expect(parseStripeSignatureHeader({ header: `t=12, v1=${"a".repeat(64)} ,v1=${"b".repeat(64)}` })).toEqual({ timestamp: 12, signatures: ["a".repeat(64), "b".repeat(64)] });
    expect(verifyStripeSignature({ rawBody: body, header: undefined, secrets: [undefined], nowMs: NOW_MS, toleranceSec: 300 })).toEqual({ ok: false, reason: "no webhook secret is configured" });
  });
});

describe("envelope checks after a valid signature", () => {
  it.each([
    ["not JSON", "{not json"],
    ["invalid UTF-8", new Uint8Array([0x7b, 0xff, 0x7d])],
    ["no data.object", { id: "evt_1", type: "x", created: 1, livemode: false, data: {} }],
    ["no id", { type: "x", created: 1, livemode: false, data: { object: {} } }],
    ["a non-boolean livemode", { id: "evt_1", type: "x", created: 1, livemode: "no", data: { object: {} } }],
    ["no created", { id: "evt_1", type: "x", livemode: false, data: { object: {} } }],
    ["no type", { id: "evt_1", created: 1, livemode: false, data: { object: {} } }],
    ["a JSON array", [1]],
  ])("rejects a signed body that is %s", async (_label, value) => {
    const rawBody = value instanceof Uint8Array ? value : bytes(value);
    expect(await verify(rawBody, header(rawBody))).toMatchObject({ kind: "rejected", error: { code: "INVALID_REQUEST" } });
  });

  it("rejects a test-mode event on a live account and a live event on a test account", async () => {
    const testBody = bytes(event("payment_intent.succeeded", intentSucceeded));
    expect(await verify(testBody, header(testBody), { mode: "live" })).toMatchObject({ kind: "rejected", error: { code: "INVALID_REQUEST", message: expect.stringContaining("livemode=false") } });
    const liveBody = bytes(event("payment_intent.succeeded", intentSucceeded, { livemode: true }));
    expect(await verify(liveBody, header(liveBody))).toMatchObject({ kind: "rejected" });
    expect(await verify(liveBody, header(liveBody), { mode: "live" })).toMatchObject({ kind: "ok" });
  });

  it("parseStripeEvent refuses a non-object body", () => {
    expect(parseStripeEvent({ body: null })).toBeUndefined();
  });
});

describe("event → facts", () => {
  const facts = async (type: string, object: unknown) => {
    const rawBody = bytes(event(type, object));
    const outcome = await verify(rawBody, header(rawBody));
    if (outcome.kind !== "ok") throw new Error(`expected ok, got ${outcome.kind}`);
    return outcome.value;
  };
  const base = { providerEventId: "evt_1NG8Du2eZvKYlo2CUI79vXWy", occurredAt: 1686089970_000, providerRef: PI };
  const usd = (minorUnits: number) => ({ minorUnits, currency: "USD" });

  it("payment_intent.* carries the intent's evidence", async () => {
    expect(await facts("payment_intent.succeeded", intentSucceeded)).toEqual([{
      ...base,
      evidence: { providerRef: PI, correlationId: "pay_1", status: "succeeded", amount: usd(2000), captured: usd(2000), next: { kind: "none" }, refunds: [], disputes: [] },
    }]);
    expect(await facts("payment_intent.payment_failed", intentDeclined)).toMatchObject([{ evidence: { status: "failed" } }]);
  });

  it("an unreadable intent with an id is a fact without evidence (ingest retrieves); without an id, no fact", async () => {
    expect(await facts("payment_intent.processing", { id: PI, status: "new_status" })).toEqual([base]);
    expect(await facts("payment_intent.processing", { status: "processing" })).toEqual([]);
  });

  it.each(["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"])("%s carries the refund inside evidence for the intent", async (type) => {
    expect(await facts(type, refundSucceeded)).toEqual([{
      ...base,
      evidence: { providerRef: PI, status: "succeeded", refunds: [{ providerRefundRef: refundSucceeded.id, correlationId: "ref_1", amount: usd(500), status: "succeeded" }], disputes: [] },
    }]);
  });

  it("a refund event with an unreadable refund is a fact without evidence; without payment_intent, no fact", async () => {
    expect(await facts("refund.updated", refund({ status: "??" }))).toEqual([base]);
    expect(await facts("refund.updated", refund({ payment_intent: null }))).toEqual([]);
  });

  it("charge.refunded carries every listed refund and the captured amount", async () => {
    const list = [refundSucceeded, refund({ id: "re_2", status: "pending", metadata: {} })];
    expect(await facts("charge.refunded", chargeRefunded(list))).toEqual([{
      ...base,
      evidence: {
        providerRef: PI, status: "succeeded", captured: usd(2000), disputes: [],
        refunds: [
          { providerRefundRef: refundSucceeded.id, correlationId: "ref_1", amount: usd(500), status: "succeeded" },
          { providerRefundRef: "re_2", amount: usd(500), status: "pending" },
        ],
      },
    }]);
  });

  it("charge.refunded without a refunds list, with an unreadable refund or no captured amount is a fact without evidence", async () => {
    expect(await facts("charge.refunded", chargeRefunded(undefined))).toEqual([base]);
    expect(await facts("charge.refunded", chargeRefunded([refund({ amount: -5 })]))).toEqual([base]);
    expect(await facts("charge.refunded", { ...chargeRefunded([]), refunds: { data: "x" } })).toEqual([base]);
    expect(await facts("charge.refunded", { ...chargeRefunded([]), amount_captured: null })).toEqual([base]);
    expect(await facts("charge.refunded", { ...chargeRefunded([]), payment_intent: null })).toEqual([]);
  });

  it.each(["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "charge.dispute.funds_withdrawn"])("%s carries the dispute", async (type) => {
    expect(await facts(type, disputeNeedsResponse)).toEqual([{
      ...base,
      evidence: { providerRef: PI, status: "succeeded", refunds: [], disputes: [{ providerDisputeRef: disputeNeedsResponse.id, amount: usd(2000), status: "open", dueBy: 1693612799_000 }] },
    }]);
  });

  it("a dispute event with an unreadable dispute is a fact without evidence; without payment_intent, no fact", async () => {
    expect(await facts("charge.dispute.closed", dispute({ status: "prevented" }))).toEqual([base]);
    expect(await facts("charge.dispute.closed", dispute({ payment_intent: null }))).toEqual([]);
  });

  it("an event type we do not handle is ok with no facts", async () => {
    expect(await facts("customer.created", { id: "cus_1", object: "customer" })).toEqual([]);
    expect(await facts("charge.succeeded", chargeRefunded(undefined))).toEqual([]);
  });
});
