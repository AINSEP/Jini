import { describe, expect, it } from "vitest";
import { readSession } from "../session-reading.js";

const session = (patch: Record<string, unknown> = {}) => ({
  object: "checkout.session", id: "cs_1", mode: "payment", livemode: false, metadata: { jini_payment_id: "pay_1" },
  amount_total: 900, currency: "usd", status: "complete", payment_status: "paid", ...patch,
});
const evidence = (status: string) => ({ kind: "evidence", evidence: {
  providerRef: "cs_1", correlationId: "pay_1", status, amount: { minorUnits: 900, currency: "USD" }, refunds: [], disputes: [],
} });
const idOnly = { kind: "id_only", sessionId: "cs_1" };

describe("Stripe Checkout session reading", () => {
  it.each([
    ["open", "unpaid", undefined, "requires_action"], ["expired", "unpaid", undefined, "canceled"],
    ["complete", "paid", undefined, "succeeded"], ["complete", "unpaid", undefined, "pending"],
    ["complete", "no_payment_required", undefined, null], ["complete", "unpaid", "checkout.session.async_payment_failed", "failed"],
    ["complete", "paid", "checkout.session.async_payment_succeeded", "succeeded"],
    ["complete", "unpaid", "checkout.session.async_payment_succeeded", null],
    ["future", "paid", undefined, null], [undefined, "paid", undefined, null], ["complete", undefined, undefined, null],
  ] as const)("maps %s / %s / %s", (status, payment_status, eventType, expected) => {
    const result = readSession({ object: session({ status, payment_status }), mode: "test" }, eventType === undefined ? {} : { eventType });
    expect(result).toEqual(expected === null ? idOnly : evidence(expected));
  });
  it.each([
    [{ status: "requires_payment_method" }, "failed"], [{ status: "canceled" }, "failed"],
    [{ status: "processing" }, "pending"], [{ status: "succeeded" }, "pending"],
    ["pi_1", "pending"], [null, "pending"], [undefined, "pending"], [[], "pending"], [{ status: { toString: null } }, "pending"],
  ] as const)("uses only expanded PI failure states under complete/unpaid: %j", (payment_intent, expected) => {
    expect(readSession({ object: session({ payment_status: "unpaid", payment_intent }), mode: "test" })).toEqual(evidence(expected));
  });
  it.each(["open", "expired", "complete"])("does not let a PI failure override %s/paid", status => {
    const expected: Record<string, string> = { open: "requires_action", expired: "canceled", complete: "succeeded" };
    expect(readSession({ object: session({ status, payment_intent: { status: "canceled" } }), mode: "test" })).toEqual(evidence(expected[status]!));
  });
  it.each([
    { amount_total: undefined }, { amount_total: "900" }, { amount_total: -1 }, { currency: undefined }, { currency: "kwd" },
  ])("requests retrieval for incomplete evidence %j", patch => {
    expect(readSession({ object: session(patch), mode: "test" })).toEqual(idOnly);
  });
  it.each([null, [], "session", 1, {}, { metadata: null }, { metadata: [] }, { metadata: {} }])("ignores objects without our metadata: %j", object => {
    expect(readSession({ object, mode: "test" })).toEqual({ kind: "foreign" });
  });
  it.each([
    { metadata: { jini_payment_id: null } }, { metadata: { jini_payment_id: 1 } }, { metadata: { jini_payment_id: "" } },
  ])("refuses invalid correlation metadata %j", patch => {
    expect(readSession({ object: session(patch), mode: "test" })).toEqual({ kind: "malformed", reason: "invalid payment correlation" });
  });
  it.each([
    { id: undefined }, { id: 1 }, { id: "" }, { object: "payment_intent" }, { mode: "subscription" },
    { livemode: true }, { livemode: undefined },
  ])("refuses malformed or cross-mode owned sessions %j", patch => {
    expect(readSession({ object: session(patch), mode: "test" })).toEqual({ kind: "malformed", reason: "invalid checkout session identity or mode" });
  });
  it("accepts a live session only in live context", () => {
    expect(readSession({ object: session({ livemode: true }), mode: "live" }, {})).toEqual(evidence("succeeded"));
    expect(readSession({ object: session(), mode: "live" })).toEqual({ kind: "malformed", reason: "invalid checkout session identity or mode" });
  });
});
