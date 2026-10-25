import { describe, expect, test } from "vitest";

import { derivePaymentStatus, mergeDisputeStatus, mergeIntentStatus, mergeRefundStatus, refundTotals, refundableMinor, type IntentStatus, type RefundStatus } from "../status.js";

/**
 * Exhaustive transition matrices (Stryker L6: terminal-state arrays and the succeeded/refund
 * boundary survived). Every (current, incoming) pair is checked against an INLINE allowed list,
 * so adding or removing a single transition is a visible edit here.
 */

const INTENTS: IntentStatus[] = ["unknown", "requires_action", "pending", "authorized", "succeeded", "failed", "canceled"];
const ALLOWED_INTENT: Record<IntentStatus, IntentStatus[]> = {
  unknown: ["requires_action", "pending", "authorized", "succeeded", "failed", "canceled"],
  requires_action: ["pending", "authorized", "succeeded", "failed", "canceled"],
  pending: ["requires_action", "authorized", "succeeded", "failed", "canceled"],
  authorized: ["succeeded", "canceled"],
  succeeded: [],
  failed: ["authorized", "succeeded"],
  canceled: [],
};
const REFUNDS: RefundStatus[] = ["reserved", "unknown", "pending", "succeeded", "failed"];
const ALLOWED_REFUND: Record<RefundStatus, RefundStatus[]> = {
  reserved: ["unknown", "pending", "succeeded", "failed"],
  unknown: ["pending", "succeeded", "failed"],
  pending: ["succeeded", "failed"],
  succeeded: ["failed"],
  failed: [],
};

describe("status merge matrices", () => {
  const intentPairs = INTENTS.flatMap((current) => INTENTS.map((incoming) => [current, incoming] as const));
  test.each(intentPairs)("intent %s + %s", (current, incoming) => {
    expect(mergeIntentStatus({ current, incoming })).toBe(ALLOWED_INTENT[current].includes(incoming) ? incoming : current);
  });

  const refundPairs = REFUNDS.flatMap((current) => REFUNDS.map((incoming) => [current, incoming] as const));
  test.each(refundPairs)("refund %s + %s", (current, incoming) => {
    expect(mergeRefundStatus({ current, incoming })).toBe(ALLOWED_REFUND[current].includes(incoming) ? incoming : current);
  });

  test.each([
    ["open", "won", "won"], ["open", "lost", "lost"], ["open", "open", "open"],
    ["won", "lost", "won"], ["won", "open", "won"], ["lost", "won", "lost"], ["lost", "open", "lost"],
  ] as const)("dispute %s + %s → %s", (current, incoming, expected) => {
    expect(mergeDisputeStatus({ current, incoming })).toBe(expected);
  });
});

describe("derivePaymentStatus", () => {
  test.each([
    ["succeeded", 1000, 0, "succeeded"],
    ["succeeded", 1000, -5, "succeeded"],
    ["succeeded", 1000, 1, "partially_refunded"],
    ["succeeded", 1000, 999, "partially_refunded"],
    ["succeeded", 1000, 1000, "refunded"],
    ["succeeded", 600, 1000, "refunded"],
    ["authorized", 1000, 1000, "authorized"],
    ["failed", 0, 50, "failed"],
    ["canceled", 0, 0, "canceled"],
  ] as const)("intent %s, captured %i, refunded %i → %s", (intent, capturedMinor, refundedMinor, expected) => {
    expect(derivePaymentStatus({ intent, capturedMinor, refundedMinor })).toBe(expected);
  });
});

describe("refund totals", () => {
  test("succeeded sums, failed is ignored, every other status is held — with ≥2 rows of each", () => {
    const refunds = [
      { status: "succeeded" as const, amountMinor: 100 }, { status: "failed" as const, amountMinor: 7 },
      { status: "reserved" as const, amountMinor: 10 }, { status: "unknown" as const, amountMinor: 20 },
      { status: "pending" as const, amountMinor: 30 }, { status: "succeeded" as const, amountMinor: 1 },
      { status: "failed" as const, amountMinor: 9 },
    ];
    expect(refundTotals({ refunds })).toEqual({ succeeded: 101, held: 60 });
  });
  test("refundableMinor never goes negative and subtracts both succeeded and held", () => {
    expect(refundableMinor({ capturedMinor: 1000, totals: { succeeded: 300, held: 200 } })).toBe(500);
    expect(refundableMinor({ capturedMinor: 1000, totals: { succeeded: 600, held: 600 } })).toBe(0);
    expect(refundableMinor({ capturedMinor: 1000, totals: { succeeded: 500, held: 500 } })).toBe(0);
  });
});
