import { describe, expect, test } from "vitest";
import type { PaymentEvidence, RefundEvidence } from "../../contract/evidence.js";
import { planDisputeEvidence, planIntentEvidence, planRefundEvidence, type PaymentState, type RefundState } from "../plan-evidence.js";

const USD = (minorUnits: number) => ({ minorUnits, currency: "USD" });

const payment: PaymentState = {
  id: "pay_1", currency: "USD", amountMinor: 10_000, capturedMinor: 10_000,
  intentStatus: "succeeded", providerRef: "ch_1",
};
const observation: PaymentEvidence = { providerRef: "ch_1", status: "succeeded", refunds: [], disputes: [] };

describe("evidence money boundaries", () => {
  test.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -1, 0, 0.5])(
    "refund amount %s is quarantined without changing the reservation",
    (minorUnits) => {
      const reserved: RefundState = Object.freeze({ id: "ours", providerRefundRef: null, amountMinor: 1, status: "reserved" });
      expect(planRefundEvidence({
        payment, refunds: Object.freeze([reserved]), newId: "unused",
        evidence: { providerRefundRef: "re_1", correlationId: "ours", amount: USD(minorUnits), status: "succeeded" },
      })).toEqual({ kind: "quarantined", reason: "bad-amount" });
      expect(reserved).toEqual({ id: "ours", providerRefundRef: null, amountMinor: 1, status: "reserved" });
    },
  );

  test.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, -1, 0, 0.5])(
    "dispute amount %s cannot create a withdrawal",
    (minorUnits) => {
      expect(planDisputeEvidence({
        payment, disputes: [], newId: "dispute",
        evidence: { providerDisputeRef: "dp_1", amount: USD(minorUnits), status: "lost" },
      })).toEqual({ kind: "quarantined", reason: "bad-amount" });
    },
  );

  test.each(["amount", "captured"] as const)("unsafe %s evidence cannot change captured money", (field) => {
    expect(planIntentEvidence({ payment, evidence: { ...observation, [field]: USD(Number.MAX_SAFE_INTEGER + 1) } }))
      .toEqual({ kind: "quarantined", reason: "bad-amount" });
  });

  test("a charge currency mismatch is refused even when the captured currency matches", () => {
    expect(planIntentEvidence({ payment, evidence: {
      ...observation, amount: { currency: "EUR", minorUnits: 10_000 }, captured: USD(10_000),
    } })).toEqual({ kind: "quarantined", reason: "currency-mismatch" });
  });

  test("an unsolicited failed refund records the fact without announcing returned money", () => {
    const evidence: RefundEvidence = { providerRefundRef: "re_failed", amount: USD(37), status: "failed" };
    const row = { id: "new", providerRefundRef: "re_failed", amountMinor: 37, status: "failed" };
    expect(planRefundEvidence({ payment, refunds: [], evidence, newId: "new" }))
      .toEqual({ kind: "refund", write: "insert", row, refunds: [row], outbox: [] });
  });

  test("binding an explicitly correlated refund preserves unrelated holds and their order", () => {
    const unrelated: RefundState = Object.freeze({ id: "other", providerRefundRef: null, amountMinor: 100, status: "unknown" });
    const ours: RefundState = Object.freeze({ id: "ours", providerRefundRef: null, amountMinor: 23, status: "reserved" });
    const evidence: RefundEvidence = { providerRefundRef: "re_ours", correlationId: "ours", amount: USD(23), status: "succeeded" };
    const settled = { ...ours, providerRefundRef: "re_ours", status: "succeeded" };
    expect(planRefundEvidence({ payment, refunds: Object.freeze([unrelated, ours]), evidence, newId: "unused" }))
      .toEqual({ kind: "refund", write: "update", row: settled, refunds: [unrelated, settled], outbox: ["refund.succeeded"] });
    expect(ours).toEqual({ id: "ours", providerRefundRef: null, amountMinor: 23, status: "reserved" });
  });

  test("a refund equal to captured is accepted and one minor unit more is quarantined", () => {
    const evidence: RefundEvidence = { providerRefundRef: "re_all", amount: USD(10_000), status: "succeeded" };
    expect(planRefundEvidence({ payment, refunds: [], evidence, newId: "all" }))
      .toMatchObject({ kind: "refund", row: { amountMinor: 10_000 }, outbox: ["refund.succeeded"] });
    expect(planRefundEvidence({ payment, refunds: [], evidence: { ...evidence, amount: USD(10_001) }, newId: "all" }))
      .toEqual({ kind: "quarantined", reason: "over-refund" });
  });

  test("an explicit unmatched correlation id does not take an unrelated in-flight reservation", () => {
    const reservation: RefundState = { id: "ours", providerRefundRef: null, amountMinor: 37, status: "reserved" };
    const incoming: RefundEvidence = { correlationId: "other", providerRefundRef: "re_other", amount: USD(37), status: "succeeded" };
    const row = { id: "unsolicited", providerRefundRef: "re_other", amountMinor: 37, status: "succeeded" };
    expect(planRefundEvidence({ payment, refunds: [reservation], evidence: incoming, newId: "unsolicited" }))
      .toEqual({ kind: "refund", write: "insert", row, refunds: [reservation, row], outbox: ["refund.succeeded"] });
  });

  test.each(["failed", "succeeded"] as const)("an unbound %s refund does not defer a different incoming refund", (status) => {
    const settled: RefundState = { id: "settled", providerRefundRef: null, amountMinor: 37, status };
    const row = { id: "new", providerRefundRef: "re_new", amountMinor: 23, status: "succeeded" };
    expect(planRefundEvidence({
      payment, refunds: [settled], newId: "new",
      evidence: { providerRefundRef: "re_new", amount: USD(23), status: "succeeded" },
    })).toEqual({ kind: "refund", write: "insert", row, refunds: [settled, row], outbox: ["refund.succeeded"] });
  });

  test("an explicit zero captured total overrides automatic full-capture inference", () => {
    const uncaptured: PaymentState = { ...payment, intentStatus: "authorized", capturedMinor: 0 };
    expect(planIntentEvidence({ payment: uncaptured, evidence: { ...observation, captured: USD(0) } }))
      .toEqual({ kind: "intent", changed: true, payment: { ...uncaptured, intentStatus: "succeeded" }, outbox: ["payment.succeeded"] });
  });
});
