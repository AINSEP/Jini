import { describe, expect, test } from "vitest";
import {
  derivePaymentStatus, disputedMinor, mergeDisputeStatus, mergeIntentStatus, mergeRefundStatus, refundTotals, refundableMinor,
  type IntentStatus, type RefundStatus,
} from "../status.js";

describe("intent status merge", () => {
  test("moves forward along the table", () => {
    expect(mergeIntentStatus({ current: "unknown", incoming: "succeeded" })).toBe("succeeded");
    expect(mergeIntentStatus({ current: "requires_action", incoming: "pending" })).toBe("pending");
    expect(mergeIntentStatus({ current: "authorized", incoming: "canceled" })).toBe("canceled");
  });
  test("stale or reordered evidence never regresses", () => {
    expect(mergeIntentStatus({ current: "pending", incoming: "requires_action" })).toBe("pending");
    expect(mergeIntentStatus({ current: "succeeded", incoming: "pending" })).toBe("succeeded");
    expect(mergeIntentStatus({ current: "succeeded", incoming: "failed" })).toBe("succeeded");
    expect(mergeIntentStatus({ current: "failed", incoming: "succeeded" })).toBe("failed");
    expect(mergeIntentStatus({ current: "pending", incoming: "unknown" })).toBe("pending");
  });
  test("order-independence: any permutation of a real sequence ends at the same status", () => {
    const sequence: IntentStatus[] = ["requires_action", "pending", "succeeded"];
    const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const order of permutations) {
      const end = order.reduce<IntentStatus>((current, i) => mergeIntentStatus({ current, incoming: sequence[i]! }), "unknown");
      expect(end).toBe("succeeded");
    }
  });
});

describe("refund status merge", () => {
  test("a succeeded refund may still fail later (Stripe), but nothing leaves failed", () => {
    expect(mergeRefundStatus({ current: "succeeded", incoming: "failed" })).toBe("failed");
    expect(mergeRefundStatus({ current: "failed", incoming: "succeeded" })).toBe("failed");
  });
  test("a stale pending snapshot cannot regress succeeded; reservations progress", () => {
    expect(mergeRefundStatus({ current: "succeeded", incoming: "pending" })).toBe("succeeded");
    expect(mergeRefundStatus({ current: "reserved", incoming: "unknown" })).toBe("unknown");
    expect(mergeRefundStatus({ current: "unknown", incoming: "succeeded" })).toBe("succeeded");
    expect(mergeRefundStatus({ current: "pending", incoming: "reserved" })).toBe("pending");
  });
});

describe("dispute status merge", () => {
  test("open resolves once; outcomes are final", () => {
    expect(mergeDisputeStatus({ current: "open", incoming: "won" })).toBe("won");
    expect(mergeDisputeStatus({ current: "open", incoming: "lost" })).toBe("lost");
    expect(mergeDisputeStatus({ current: "won", incoming: "open" })).toBe("won");
  });
});

describe("derived totals and status", () => {
  const rows = (pairs: Array<[RefundStatus, number]>) => pairs.map(([status, amountMinor]) => ({ status, amountMinor }));

  test("refunded total is the sum of succeeded rows; reserved/unknown/pending are held; failed counts for nothing", () => {
    expect(refundTotals({ refunds: rows([["succeeded", 300], ["succeeded", 200], ["reserved", 50], ["unknown", 10], ["pending", 5], ["failed", 999]]) }))
      .toEqual({ succeeded: 500, held: 65 });
    expect(refundTotals({ refunds: [] })).toEqual({ succeeded: 0, held: 0 });
  });

  test("disputes: open and lost withdraw, won returns", () => {
    expect(disputedMinor({ disputes: [{ status: "open", amountMinor: 100 }, { status: "lost", amountMinor: 50 }, { status: "won", amountMinor: 70 }] })).toBe(150);
  });

  test("payment status derives from intent + refunds", () => {
    expect(derivePaymentStatus({ intent: "pending", capturedMinor: 0, refundedMinor: 0 })).toBe("pending");
    expect(derivePaymentStatus({ intent: "succeeded", capturedMinor: 1000, refundedMinor: 0 })).toBe("succeeded");
    expect(derivePaymentStatus({ intent: "succeeded", capturedMinor: 1000, refundedMinor: 300 })).toBe("partially_refunded");
    expect(derivePaymentStatus({ intent: "succeeded", capturedMinor: 1000, refundedMinor: 1000 })).toBe("refunded");
    expect(derivePaymentStatus({ intent: "authorized", capturedMinor: 0, refundedMinor: 0 })).toBe("authorized");
  });

  test("a refund that later fails puts the payment back to succeeded (derived, not stored)", () => {
    const before = refundTotals({ refunds: rows([["succeeded", 1000]]) });
    const after = refundTotals({ refunds: rows([[mergeRefundStatus({ current: "succeeded", incoming: "failed" }), 1000]]) });
    expect(derivePaymentStatus({ intent: "succeeded", capturedMinor: 1000, refundedMinor: before.succeeded })).toBe("refunded");
    expect(derivePaymentStatus({ intent: "succeeded", capturedMinor: 1000, refundedMinor: after.succeeded })).toBe("succeeded");
  });

  test("refundable = captured − succeeded − held, floored at zero", () => {
    expect(refundableMinor({ capturedMinor: 1000, totals: { succeeded: 300, held: 200 } })).toBe(500);
    expect(refundableMinor({ capturedMinor: 100, totals: { succeeded: 300, held: 0 } })).toBe(0);
  });
});
