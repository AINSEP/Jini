import { describe, expect, test } from "vitest";
import {
  derivePaymentStatus, disputedMinor, mergeDisputeStatus, mergeIntentStatus, mergeRefundStatus, refundTotals, refundableMinor,
  type DisputeStatus, type IntentStatus, type RefundStatus,
} from "../status.js";

describe("intent status merge", () => {
  test("moves forward along the table", () => {
    expect(mergeIntentStatus({ current: "unknown", incoming: "succeeded" })).toBe("succeeded");
    expect(mergeIntentStatus({ current: "requires_action", incoming: "pending" })).toBe("pending");
    expect(mergeIntentStatus({ current: "authorized", incoming: "canceled" })).toBe("canceled");
  });
  test("stale or reordered evidence never regresses", () => {
    expect(mergeIntentStatus({ current: "authorized", incoming: "requires_action" })).toBe("authorized");
    expect(mergeIntentStatus({ current: "succeeded", incoming: "pending" })).toBe("succeeded");
    expect(mergeIntentStatus({ current: "succeeded", incoming: "failed" })).toBe("succeeded");
    expect(mergeIntentStatus({ current: "canceled", incoming: "succeeded" })).toBe("canceled");
    expect(mergeIntentStatus({ current: "failed", incoming: "pending" })).toBe("failed");
    expect(mergeIntentStatus({ current: "pending", incoming: "unknown" })).toBe("pending");
  });
  test("a later success beats an earlier decline (retry on the same intent; no charged-but-failed)", () => {
    expect(mergeIntentStatus({ current: "failed", incoming: "succeeded" })).toBe("succeeded");
    expect(mergeIntentStatus({ current: "failed", incoming: "authorized" })).toBe("authorized");
  });
  test("pending may still ask for customer action", () => {
    expect(mergeIntentStatus({ current: "pending", incoming: "requires_action" })).toBe("requires_action");
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

describe("every evidence transition", () => {
  const intents: IntentStatus[] = ["unknown", "requires_action", "pending", "authorized", "succeeded", "failed", "canceled"];
  // Rows are the expected outcomes for each incoming status in `intents` order.
  const intentOutcomes: Record<IntentStatus, IntentStatus[]> = {
    unknown: ["unknown", "requires_action", "pending", "authorized", "succeeded", "failed", "canceled"],
    requires_action: ["requires_action", "requires_action", "pending", "authorized", "succeeded", "failed", "canceled"],
    pending: ["pending", "requires_action", "pending", "authorized", "succeeded", "failed", "canceled"],
    authorized: ["authorized", "authorized", "authorized", "authorized", "succeeded", "authorized", "canceled"],
    succeeded: ["succeeded", "succeeded", "succeeded", "succeeded", "succeeded", "succeeded", "succeeded"],
    failed: ["failed", "failed", "failed", "authorized", "succeeded", "failed", "failed"],
    canceled: ["canceled", "canceled", "canceled", "canceled", "canceled", "canceled", "canceled"],
  };
  for (const current of intents) {
    test.each(intents.map((incoming, index) => ({ incoming, expected: intentOutcomes[current][index] })))
      (`intent ${current} followed by $incoming keeps $expected`, ({ incoming, expected }) => {
        expect(mergeIntentStatus({ current, incoming }, {})).toBe(expected);
      });
  }

  const refunds: RefundStatus[] = ["reserved", "unknown", "pending", "succeeded", "failed"];
  const refundOutcomes: Record<RefundStatus, RefundStatus[]> = {
    reserved: ["reserved", "unknown", "pending", "succeeded", "failed"],
    unknown: ["unknown", "unknown", "pending", "succeeded", "failed"],
    pending: ["pending", "pending", "pending", "succeeded", "failed"],
    succeeded: ["succeeded", "succeeded", "succeeded", "succeeded", "failed"],
    failed: ["failed", "failed", "failed", "failed", "failed"],
  };
  for (const current of refunds) {
    test.each(refunds.map((incoming, index) => ({ incoming, expected: refundOutcomes[current][index] })))
      (`refund ${current} followed by $incoming keeps $expected`, ({ incoming, expected }) => {
        expect(mergeRefundStatus({ current, incoming }, {})).toBe(expected);
      });
  }

  const disputes: DisputeStatus[] = ["open", "won", "lost"];
  const disputeOutcomes: Record<DisputeStatus, DisputeStatus[]> = {
    open: ["open", "won", "lost"], won: ["won", "won", "won"], lost: ["lost", "lost", "lost"],
  };
  for (const current of disputes) {
    test.each(disputes.map((incoming, index) => ({ incoming, expected: disputeOutcomes[current][index] })))
      (`dispute ${current} followed by $incoming keeps $expected`, ({ incoming, expected }) => {
        expect(mergeDisputeStatus({ current, incoming }, {})).toBe(expected);
      });
  }
});

describe("money boundaries and reversals", () => {
  test.each(["unknown", "requires_action", "pending", "authorized", "failed", "canceled"] as IntentStatus[])
    ("refund totals never replace an intent in %s", (intent) => {
      expect(derivePaymentStatus({ intent, capturedMinor: 501, refundedMinor: 502 }, {})).toBe(intent);
    });

  test.each([
    { refundedMinor: -1, expected: "succeeded" },
    { refundedMinor: 0, expected: "succeeded" },
    { refundedMinor: 1, expected: "partially_refunded" },
    { refundedMinor: 500, expected: "partially_refunded" },
    { refundedMinor: 501, expected: "refunded" },
    { refundedMinor: 502, expected: "refunded" },
  ])("501 captured minor units with $refundedMinor refunded derives $expected", ({ refundedMinor, expected }) => {
    expect(derivePaymentStatus({ intent: "succeeded", capturedMinor: 501, refundedMinor })).toBe(expected);
  });

  test("a failed refund releases its exact hold without modifying the source rows", () => {
    const refunds = Object.freeze([
      Object.freeze({ status: "reserved" as const, amountMinor: 101 }),
      Object.freeze({ status: "unknown" as const, amountMinor: 203 }),
      Object.freeze({ status: "pending" as const, amountMinor: 307 }),
      Object.freeze({ status: "succeeded" as const, amountMinor: 409 }),
      Object.freeze({ status: "failed" as const, amountMinor: 997 }),
    ]);
    expect(refundTotals({ refunds }, {})).toEqual({ succeeded: 409, held: 611 });
    expect(refundableMinor({ capturedMinor: 1_021, totals: refundTotals({ refunds }) }, {})).toBe(1);
    const settled = refunds.map((row) => row.status === "pending" ? { ...row, status: "failed" as const } : row);
    expect(refundTotals({ refunds: settled })).toEqual({ succeeded: 409, held: 304 });
    expect(refundableMinor({ capturedMinor: 1_021, totals: refundTotals({ refunds: settled }) })).toBe(308);
    expect(refunds[2]).toEqual({ status: "pending", amountMinor: 307 });
  });

  test("a won dispute restores only its withdrawn amount and empty disputes withdraw zero", () => {
    const disputes = [{ status: "open" as const, amountMinor: 101 }, { status: "lost" as const, amountMinor: 203 }, { status: "won" as const, amountMinor: 307 }];
    expect(disputedMinor({ disputes }, {})).toBe(304);
    expect(disputedMinor({ disputes: [{ ...disputes[0]!, status: "won" }, disputes[1]!, disputes[2]!] })).toBe(203);
    expect(disputedMinor({ disputes: [] })).toBe(0);
  });

  test.each([
    { capturedMinor: 600, expected: 0 }, { capturedMinor: 601, expected: 0 }, { capturedMinor: 602, expected: 1 },
  ])("301 succeeded plus 300 held leaves $expected when capture is $capturedMinor", ({ capturedMinor, expected }) => {
    expect(refundableMinor({ capturedMinor, totals: { succeeded: 301, held: 300 } })).toBe(expected);
  });

  test("refund availability conserves exact minor units across combinations of held and settled rows", () => {
    for (const succeeded of [0, 1, 101, 999]) {
      for (const held of [0, 1, 203, 1_001]) {
        const totals = refundTotals({ refunds: [{ status: "succeeded", amountMinor: succeeded }, { status: "reserved", amountMinor: held }] });
        expect(totals).toEqual({ succeeded, held });
        const available = refundableMinor({ capturedMinor: 1_000, totals });
        expect(available).toBe(succeeded + held > 1_000 ? 0 : 1_000 - succeeded - held);
      }
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
