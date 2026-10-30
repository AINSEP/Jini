import { describe, expect, it } from "vitest";
import { translateStripeEvent } from "../webhook.js";

const session = { object: "checkout.session", id: "cs_1", mode: "payment", livemode: false,
  metadata: { jini_payment_id: "pay_1" }, amount_total: 900, currency: "usd", status: "complete", payment_status: "paid" };
const event = (patch: Record<string, unknown> = {}) => ({ id: "evt_1", type: "checkout.session.completed",
  created: 1730000123, livemode: false, data: { object: session }, ...patch });
const fact = { providerEventId: "evt_1", providerRef: "cs_1", occurredAt: 1730000123000 };

describe("Stripe webhook translation", () => {
  it.each([null, [], 1, "event", {}, event({ id: undefined }), event({ id: 1 }), event({ id: "" }),
    event({ type: undefined }), event({ type: 1 }), event({ type: "" }), event({ created: undefined }),
    event({ created: "1730000123" }), event({ created: NaN }), event({ created: Infinity }),
    event({ created: Number.MAX_VALUE }), event({ data: null }), event({ data: [] }), event({ data: {} }),
    event({ data: { object: null } }), event({ data: { object: [] } }), event({ data: { object: 1 } }),
  ])("refuses malformed envelopes: %j", input => {
    expect(translateStripeEvent({ event: input, mode: "test" })).toEqual({ kind: "malformed", reason: "invalid event envelope" });
  });
  it.each([true, undefined, "false"])("refuses mode mismatch before ignoring unsupported/foreign events: %j", livemode => {
    const input = event({ livemode, type: "payment_intent.succeeded", data: { object: {} } });
    expect(translateStripeEvent({ event: input, mode: "test" })).toEqual({ kind: "malformed", reason: "event mode differs from account" });
  });
  it("ignores unsupported types before inspecting owned metadata", () => {
    expect(translateStripeEvent({ event: event({ type: "payment_intent.succeeded",
      data: { object: { object: "payment_intent", metadata: session.metadata } } }), mode: "test" })).toEqual({ kind: "ignored" });
  });
  it.each([{}, { metadata: {} }, { metadata: null }])("ignores foreign objects: %j", object => {
    expect(translateStripeEvent({ event: event({ data: { object } }), mode: "test" }, {})).toEqual({ kind: "ignored" });
  });
  it.each([{ object: "payment_intent" }, { mode: "subscription" }, { id: "" }, { id: undefined }, { livemode: true }])(
    "refuses owned malformed objects: %j", patch => {
      expect(translateStripeEvent({ event: event({ data: { object: { ...session, ...patch } } }), mode: "test" }))
        .toEqual({ kind: "malformed", reason: "invalid checkout session identity or mode" });
    });
  it.each([{ amount_total: undefined }, { payment_status: "no_payment_required" }])("preserves incomplete owned sessions as id-only: %j", patch => {
    expect(translateStripeEvent({ event: event({ data: { object: { ...session, ...patch } } }), mode: "test" }))
      .toEqual({ kind: "facts", facts: [fact] });
  });
  it.each([["completed", "succeeded"], ["expired", "canceled"], ["async_payment_succeeded", "succeeded"],
    ["async_payment_failed", "failed"]])("translates %s and keeps the dedupe id stable on redelivery", (suffix, status) => {
    const input = event({ type: `checkout.session.${suffix}`, data: { object: { ...session, status: suffix === "expired" ? "expired" : "complete" } } });
    const expected = { kind: "facts", facts: [{ ...fact, evidence: { providerRef: "cs_1", correlationId: "pay_1", status,
      amount: { minorUnits: 900, currency: "USD" }, refunds: [], disputes: [] } }] };
    expect(translateStripeEvent({ event: input, mode: "test" })).toEqual(expected);
    expect(translateStripeEvent({ event: JSON.parse(JSON.stringify(input)), mode: "test" }, {})).toEqual(expected);
  });
  it("accepts live envelopes and sessions only in live mode", () => {
    const input = event({ livemode: true, data: { object: { ...session, livemode: true } } });
    expect(translateStripeEvent({ event: input, mode: "live" })).toEqual({ kind: "facts", facts: [{ ...fact, evidence: {
      providerRef: "cs_1", correlationId: "pay_1", status: "succeeded", amount: { minorUnits: 900, currency: "USD" }, refunds: [], disputes: [],
    } }] });
    expect(translateStripeEvent({ event: event(), mode: "live" })).toEqual({ kind: "malformed", reason: "event mode differs from account" });
  });
});
