import { describe, expect, test } from "vitest";
import type { PaymentEvidence, RefundEvidence } from "../../contract/evidence.js";
import {
  computeTotals, matchRefund, planDisputeEvidence, planIntentEvidence, planRefundEvidence,
  type PaymentState, type RefundState,
} from "../plan-evidence.js";

const USD = (minorUnits: number) => ({ minorUnits, currency: "USD" });
const paid: PaymentState = { id: "pay_1", currency: "USD", amountMinor: 10_000, capturedMinor: 10_000, intentStatus: "succeeded", providerRef: "ch_1" };
const reserved: RefundState = { id: "rf_1", providerRefundRef: null, amountMinor: 3_000, status: "reserved" };
const ev = (over: Partial<RefundEvidence> = {}): RefundEvidence => ({ providerRefundRef: "re_9", correlationId: "rf_1", amount: USD(3_000), status: "succeeded", ...over });

describe("matchRefund", () => {
  test("correlation id wins over provider ref", () => {
    const other: RefundState = { id: "rf_2", providerRefundRef: "re_9", amountMinor: 3_000, status: "pending" };
    expect(matchRefund({ refunds: [other, reserved], evidence: ev() })?.id).toBe("rf_1");
  });
  test("falls back to the provider ref when there is no or no matching correlation id", () => {
    const known: RefundState = { ...reserved, providerRefundRef: "re_9" };
    expect(matchRefund({ refunds: [known], evidence: ev({ correlationId: undefined }) })?.id).toBe("rf_1");
    expect(matchRefund({ refunds: [known], evidence: ev({ correlationId: "rf_x" }) })?.id).toBe("rf_1");
    expect(matchRefund({ refunds: [], evidence: ev() })).toBeUndefined();
  });
});

describe("planRefundEvidence", () => {
  test("webhook lands on the reserved row: one row, succeeded, outbox once", () => {
    const plan = planRefundEvidence({ payment: paid, refunds: [reserved], evidence: ev(), newId: "new" });
    expect(plan).toEqual({
      kind: "refund", write: "update",
      row: { id: "rf_1", providerRefundRef: "re_9", amountMinor: 3_000, status: "succeeded" },
      refunds: [{ id: "rf_1", providerRefundRef: "re_9", amountMinor: 3_000, status: "succeeded" }],
      outbox: ["refund.succeeded"],
    });
  });
  test("the same evidence again changes nothing and emits nothing", () => {
    const done: RefundState = { id: "rf_1", providerRefundRef: "re_9", amountMinor: 3_000, status: "succeeded" };
    const plan = planRefundEvidence({ payment: paid, refunds: [done], evidence: ev(), newId: "new" });
    expect(plan).toMatchObject({ kind: "refund", write: "none", outbox: [] });
  });
  test("an unsolicited refund (no match) is inserted under newId", () => {
    const plan = planRefundEvidence({ payment: paid, refunds: [], evidence: ev({ correlationId: undefined, status: "pending" }), newId: "new" });
    expect(plan).toMatchObject({ kind: "refund", write: "insert", row: { id: "new", status: "pending" }, outbox: [] });
  });
  test("succeeded → failed emits refund.failed; failed straight from pending emits nothing", () => {
    const done: RefundState = { id: "rf_1", providerRefundRef: "re_9", amountMinor: 3_000, status: "succeeded" };
    expect(planRefundEvidence({ payment: paid, refunds: [done], evidence: ev({ status: "failed" }), newId: "n" })).toMatchObject({ outbox: ["refund.failed"], row: { status: "failed" } });
    const pending: RefundState = { ...done, status: "pending" };
    expect(planRefundEvidence({ payment: paid, refunds: [pending], evidence: ev({ status: "failed" }), newId: "n" })).toMatchObject({ outbox: [], row: { status: "failed" } });
  });
  test.each([
    ["zero amount", ev({ amount: USD(0) }), "bad-amount"],
    ["negative amount", ev({ amount: USD(-5) }), "bad-amount"],
    ["fractional amount", ev({ amount: USD(1.5) }), "bad-amount"],
    ["other currency", ev({ amount: { minorUnits: 3_000, currency: "EUR" } }), "currency-mismatch"],
    ["charge amount on a partial refund (B1)", ev({ amount: USD(10_000) }), "amount-mismatch"],
  ])("%s is quarantined", (_n, evidence, reason) => {
    expect(planRefundEvidence({ payment: paid, refunds: [reserved], evidence, newId: "n" })).toEqual({ kind: "quarantined", reason });
  });
  test("a correlated row already bound to another provider ref is a conflict", () => {
    const bound: RefundState = { ...reserved, providerRefundRef: "re_other" };
    expect(planRefundEvidence({ payment: paid, refunds: [bound], evidence: ev(), newId: "n" })).toEqual({ kind: "quarantined", reason: "ref-conflict" });
  });
  test("over-refund is quarantined, never capped", () => {
    const big: RefundState = { id: "rf_0", providerRefundRef: "re_0", amountMinor: 8_000, status: "succeeded" };
    expect(planRefundEvidence({ payment: paid, refunds: [big, reserved], evidence: ev(), newId: "n" })).toEqual({ kind: "quarantined", reason: "over-refund" });
  });
});

describe("planDisputeEvidence", () => {
  const dispute = { providerDisputeRef: "dp_1", amount: USD(10_000), status: "open" as const };
  test("a new open dispute is inserted and announced", () => {
    expect(planDisputeEvidence({ payment: paid, disputes: [], evidence: dispute, newId: "d1" })).toEqual({
      kind: "dispute", write: "insert", row: { id: "d1", providerDisputeRef: "dp_1", amountMinor: 10_000, status: "open" },
      disputes: [{ id: "d1", providerDisputeRef: "dp_1", amountMinor: 10_000, status: "open" }], outbox: ["dispute.opened"],
    });
  });
  test("a dispute first seen already closed is announced opened and closed", () => {
    expect(planDisputeEvidence({ payment: paid, disputes: [], evidence: { ...dispute, status: "won" }, newId: "d1" })).toMatchObject({ outbox: ["dispute.opened", "dispute.closed"] });
  });
  test("open → won closes it; a stale open afterwards changes nothing", () => {
    const open = { id: "d1", providerDisputeRef: "dp_1", amountMinor: 10_000, status: "open" as const };
    expect(planDisputeEvidence({ payment: paid, disputes: [open], evidence: { ...dispute, status: "won" }, newId: "x" })).toMatchObject({ write: "update", outbox: ["dispute.closed"], row: { status: "won" } });
    const won = { ...open, status: "won" as const };
    expect(planDisputeEvidence({ payment: paid, disputes: [won], evidence: dispute, newId: "x" })).toMatchObject({ write: "none", outbox: [] });
  });
  test("updating one dispute leaves the others untouched", () => {
    const a = { id: "d1", providerDisputeRef: "dp_1", amountMinor: 10_000, status: "open" as const };
    const b = { id: "d2", providerDisputeRef: "dp_2", amountMinor: 500, status: "open" as const };
    const plan = planDisputeEvidence({ payment: paid, disputes: [b, a], evidence: { ...dispute, status: "lost" }, newId: "x" });
    expect(plan).toMatchObject({ disputes: [b, { ...a, status: "lost" }] });
  });
  test("a dispute in another currency is quarantined", () => {
    expect(planDisputeEvidence({ payment: paid, disputes: [], evidence: { ...dispute, amount: { minorUnits: 1, currency: "EUR" } }, newId: "d" })).toEqual({ kind: "quarantined", reason: "currency-mismatch" });
  });
});

describe("planIntentEvidence", () => {
  const created: PaymentState = { id: "pay_1", currency: "USD", amountMinor: 10_000, capturedMinor: 0, intentStatus: "unknown", providerRef: null };
  const pe = (over: Partial<PaymentEvidence> = {}): PaymentEvidence => ({ providerRef: "ch_1", status: "succeeded", refunds: [], disputes: [], ...over });

  test("first success binds the ref, captures the full amount and announces once", () => {
    expect(planIntentEvidence({ payment: created, evidence: pe({ amount: USD(10_000) }) })).toEqual({
      kind: "intent", changed: true, outbox: ["payment.succeeded"],
      payment: { ...created, providerRef: "ch_1", intentStatus: "succeeded", capturedMinor: 10_000 },
    });
  });
  test("replaying it changes nothing", () => {
    const done = { ...created, providerRef: "ch_1", intentStatus: "succeeded" as const, capturedMinor: 10_000 };
    expect(planIntentEvidence({ payment: done, evidence: pe() })).toEqual({ kind: "intent", changed: false, payment: done, outbox: [] });
  });
  test("authorized keeps captured at zero; a partial capture is recorded and never decreases", () => {
    expect(planIntentEvidence({ payment: created, evidence: pe({ status: "authorized" }) })).toMatchObject({ payment: { capturedMinor: 0, intentStatus: "authorized" } });
    const partial = planIntentEvidence({ payment: { ...created, intentStatus: "authorized", providerRef: "ch_1" }, evidence: pe({ captured: USD(6_000) }) });
    expect(partial).toMatchObject({ payment: { capturedMinor: 6_000 } });
    expect(planIntentEvidence({ payment: { ...created, intentStatus: "succeeded", capturedMinor: 6_000, providerRef: "ch_1" }, evidence: pe({ captured: USD(1_000) }) }))
      .toMatchObject({ payment: { capturedMinor: 6_000 } });
  });
  test.each([
    ["another provider ref", { ...created, providerRef: "ch_other" }, pe(), "ref-conflict"],
    ["bad amount", created, pe({ amount: USD(0) }), "bad-amount"],
    ["other currency capture", created, pe({ captured: { minorUnits: 5, currency: "EUR" } }), "currency-mismatch"],
    ["different amount", created, pe({ amount: USD(9_999) }), "amount-mismatch"],
    ["capture above amount", created, pe({ captured: USD(10_001) }), "amount-mismatch"],
  ])("%s is quarantined", (_n, payment, evidence, reason) => {
    expect(planIntentEvidence({ payment, evidence })).toEqual({ kind: "quarantined", reason });
  });
});

describe("computeTotals", () => {
  test("derives refunded/held/disputed and status from rows", () => {
    const refunds: RefundState[] = [
      { id: "a", providerRefundRef: "r1", amountMinor: 3_000, status: "succeeded" },
      { id: "b", providerRefundRef: null, amountMinor: 1_000, status: "reserved" },
    ];
    expect(computeTotals({ payment: paid, refunds, disputes: [{ id: "d", providerDisputeRef: "dp", amountMinor: 500, status: "open" }] }))
      .toEqual({ refundedMinor: 3_000, refundHeldMinor: 1_000, disputedMinor: 500, status: "partially_refunded" });
  });
});

describe("L3 review fixes (planner)", () => {
  const pe = (over: Partial<PaymentEvidence> = {}): PaymentEvidence => ({ providerRef: "ch_1", status: "succeeded", refunds: [], disputes: [], ...over });

  test("a later success without `captured` never widens a partial capture", () => {
    const partial: PaymentState = { ...paid, capturedMinor: 6_000 };
    expect(planIntentEvidence({ payment: partial, evidence: pe() })).toMatchObject({ payment: { capturedMinor: 6_000 } });
    const pendingSnapshot = planIntentEvidence({ payment: { ...paid, intentStatus: "pending", capturedMinor: 0 }, evidence: pe({ status: "pending" }) });
    expect(pendingSnapshot).toMatchObject({ payment: { capturedMinor: 0 } });
  });

  test("terminal conflicts are quarantined, not silently ignored", () => {
    const failed: RefundState = { id: "rf_1", providerRefundRef: "re_9", amountMinor: 3_000, status: "failed" };
    expect(planRefundEvidence({ payment: paid, refunds: [failed], evidence: ev(), newId: "n" })).toEqual({ kind: "quarantined", reason: "terminal-conflict" });
    expect(planRefundEvidence({ payment: paid, refunds: [failed], evidence: ev({ status: "pending" }), newId: "n" })).toMatchObject({ kind: "refund", write: "none" });
    const canceled: PaymentState = { ...paid, intentStatus: "canceled", capturedMinor: 0 };
    expect(planIntentEvidence({ payment: canceled, evidence: pe() })).toEqual({ kind: "quarantined", reason: "terminal-conflict" });
    expect(planIntentEvidence({ payment: canceled, evidence: pe({ status: "authorized" }) })).toEqual({ kind: "quarantined", reason: "terminal-conflict" });
    expect(planIntentEvidence({ payment: canceled, evidence: pe({ status: "failed" }) })).toMatchObject({ kind: "intent", changed: false });
  });

  test("a payment observation naming another payment's correlation id is a conflict", () => {
    expect(planIntentEvidence({ payment: paid, evidence: pe({ correlationId: "pay_other" }) })).toEqual({ kind: "quarantined", reason: "ref-conflict" });
    expect(planIntentEvidence({ payment: paid, evidence: pe({ correlationId: "pay_1" }) })).toMatchObject({ kind: "intent" });
  });

  test("no echo: defer while a response is awaited; bind a success only to the single lost (unknown) row of that amount", () => {
    const noEcho = ev({ correlationId: undefined });
    expect(planRefundEvidence({ payment: paid, refunds: [reserved], evidence: noEcho, newId: "n" })).toEqual({ kind: "deferred" });
    const lost: RefundState = { ...reserved, status: "unknown" };
    expect(planRefundEvidence({ payment: paid, refunds: [lost], evidence: noEcho, newId: "n" })).toMatchObject({ kind: "refund", write: "update", row: { id: "rf_1", providerRefundRef: "re_9" } });
    expect(planRefundEvidence({ payment: paid, refunds: [lost], evidence: ev({ correlationId: undefined, status: "failed" }), newId: "n" })).toEqual({ kind: "deferred" });
    const twin: RefundState = { ...lost, id: "rf_2" };
    expect(planRefundEvidence({ payment: paid, refunds: [lost, twin], evidence: noEcho, newId: "n" })).toEqual({ kind: "deferred" });
    const other: RefundState = { ...lost, amountMinor: 1_000 };
    expect(planRefundEvidence({ payment: paid, refunds: [other], evidence: noEcho, newId: "n" })).toMatchObject({ kind: "refund", write: "insert", row: { id: "n" } });
  });

  test("a dispute CLOSING with a changed amount is applied with the stored amount; the difference is flagged (owner 2026-10-21)", () => {
    const open = { id: "d1", providerDisputeRef: "dp_1", amountMinor: 10_000, status: "open" as const };
    expect(planDisputeEvidence({ payment: paid, disputes: [open], evidence: { providerDisputeRef: "dp_1", amount: USD(5_000), status: "lost" }, newId: "x" }))
      .toEqual({
        kind: "dispute", write: "update", row: { ...open, status: "lost" }, disputes: [{ ...open, status: "lost" }], outbox: ["dispute.closed"],
        amountChanged: { storedMinor: 10_000, observedMinor: 5_000 },
      });
  });
  test("a changed amount that does not close the dispute (still open, or already closed) is quarantined whole", () => {
    const open = { id: "d1", providerDisputeRef: "dp_1", amountMinor: 10_000, status: "open" as const };
    expect(planDisputeEvidence({ payment: paid, disputes: [open], evidence: { providerDisputeRef: "dp_1", amount: USD(5_000), status: "open" }, newId: "x" }))
      .toEqual({ kind: "quarantined", reason: "amount-mismatch" });
    const won = { ...open, status: "won" as const };
    expect(planDisputeEvidence({ payment: paid, disputes: [won], evidence: { providerDisputeRef: "dp_1", amount: USD(5_000), status: "lost" }, newId: "x" }))
      .toEqual({ kind: "quarantined", reason: "amount-mismatch" });
  });
  test("a closing observation in another currency is still quarantined whole", () => {
    const open = { id: "d1", providerDisputeRef: "dp_1", amountMinor: 10_000, status: "open" as const };
    expect(planDisputeEvidence({ payment: paid, disputes: [open], evidence: { providerDisputeRef: "dp_1", amount: { minorUnits: 10_000, currency: "EUR" }, status: "won" }, newId: "x" }))
      .toEqual({ kind: "quarantined", reason: "currency-mismatch" });
  });
});
