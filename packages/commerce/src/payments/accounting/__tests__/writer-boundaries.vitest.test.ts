import { describe, expect, test } from "vitest";
import type { PaymentEvidence } from "../../contract/evidence.js";
import {
  applyPaymentEvidence, applyRefundEvidence, recordIntentDispatchOutcome, recordRefundDispatchOutcome,
  reserveRefund, settleUnknownIntent, settleUnknownRefund,
} from "../apply-evidence.js";
import { NOW, USD, paidPayment, type LedgerKind } from "./harness.js";

const evidence: PaymentEvidence = { providerRef: "ch_1", status: "succeeded", refunds: [], disputes: [] };

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`writer boundaries on ${kind}`, () => {
    test.each([
      { workspaceId: "foreign", mode: "test" as const },
      { workspaceId: "ws", mode: "live" as const },
    ])("every writer treats payment access outside $workspaceId/$mode as missing", async (scope) => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 37);
      await w.dispatchOutcome("rf_1", "unknown");
      const before = await w.read();
      await w.ledger.transaction({ fn: async (tx) => {
        const input = { tx, deps: w.deps, ...scope, paymentId: "pay_1", source: "operator" as const };
        expect(await applyPaymentEvidence({ ...input, evidence })).toEqual({ kind: "missing" });
        expect(await applyRefundEvidence({ ...input, evidence: { providerRefundRef: "re_1", amount: USD(37), status: "succeeded" } }))
          .toEqual({ kind: "missing" });
        expect(await reserveRefund({ ...input, refundId: "foreign", amountMinor: 1, idempotencyKey: "foreign" })).toEqual({ kind: "missing" });
        expect(await recordIntentDispatchOutcome({ ...input, outcome: "rejected" })).toEqual({ kind: "missing" });
        expect(await recordRefundDispatchOutcome({ ...input, refundId: "rf_1", outcome: "rejected" })).toEqual({ kind: "missing" });
        expect(await settleUnknownIntent({ ...input, status: "failed" })).toEqual({ kind: "missing" });
        expect(await settleUnknownRefund({ ...input, refundId: "rf_1", status: "succeeded" })).toEqual({ kind: "missing" });
      } });
      expect(await w.read()).toEqual(before);
    });

    test.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -1, 0, 0.5])(
      "reservation amount %s is refused without creating a hold or changing the payment",
      async (amount) => {
        const w = await paidPayment(kind);
        const before = await w.read();
        expect(await w.reserve("invalid", amount)).toEqual({ kind: "invalid-amount" });
        expect(await w.read()).toEqual(before);
      },
    );

    test("reservations consume the last cent exactly and refuse another cent without a partial write", async () => {
      const w = await paidPayment(kind);
      expect(await w.reserve("first", 9_999)).toMatchObject({ kind: "reserved", refund: { currency: "USD", amountMinor: 9_999 } });
      expect(await w.reserve("last", 1)).toMatchObject({ kind: "reserved", refund: { currency: "USD", amountMinor: 1 } });
      const before = await w.read();
      expect(before.payment).toMatchObject({ currency: "USD", capturedMinor: 10_000, refundedMinor: 0, refundHeldMinor: 10_000 });
      expect(await w.reserve("excess", 1)).toEqual({ kind: "insufficient", refundableMinor: 0 });
      expect(await w.read()).toEqual(before);
    });

    test("refund evidence retains its inbox link, currency and source in the append-only audit", async () => {
      const w = await paidPayment(kind);
      await w.reserve("ours", 37);
      await w.ledger.transaction({ fn: async (tx) => {
        await tx.insertInbox({ entry: {
          id: "inbox_refund", workspaceId: "ws", siteId: "site", providerId: "lipay", providerAccountId: "acct_fake", mode: "test",
          providerEventId: "evt_refund", factsJson: "{}", bodySha256: "0".repeat(64), nextAttemptAt: NOW, receivedAt: NOW,
        } });
        expect(await applyRefundEvidence({
          tx, deps: w.deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", source: "webhook",
          evidence: { providerRefundRef: "re_ours", correlationId: "ours", amount: USD(37), status: "succeeded" },
        }, { inboxId: "inbox_refund" })).toEqual({ kind: "applied", quarantined: [], outbox: ["refund.succeeded"], deferred: 0 });
      } });
      const after = await w.read();
      expect(after.payment).toMatchObject({ currency: "USD", refundedMinor: 37, refundHeldMinor: 0, capturedMinor: 10_000 });
      expect(after.evidence.at(-1)).toMatchObject({
        subject: "refund", subjectRef: "re_ours", amountMinor: 37, currency: "USD", source: "webhook", inboxId: "inbox_refund", recordedAt: NOW,
      });
    });

    test("late settlement fields update independently and absent fields preserve prior facts", async () => {
      const w = await paidPayment(kind);
      await w.payment({ ...evidence, settlement: { fee: USD(31) } });
      expect((await w.read()).payment).toMatchObject({ feeMinor: 31, feeCurrency: "USD", netMinor: null, settlementMinor: null });
      await w.payment({ ...evidence, settlement: { net: USD(9_969) } });
      await w.payment({ ...evidence, settlement: { settlement: { currency: "EUR", minorUnits: 9_123 } } });
      await w.payment({ ...evidence, settlement: {} });
      await w.payment(evidence);
      const after = await w.read();
      expect(after.payment).toMatchObject({
        currency: "USD", amountMinor: 10_000, capturedMinor: 10_000,
        feeCurrency: "USD", feeMinor: 31, netCurrency: "USD", netMinor: 9_969, settlementCurrency: "EUR", settlementMinor: 9_123,
      });
      expect(after.outbox).toEqual(["payment.succeeded"]);
      expect(after.quarantine).toEqual([]);
    });

    test("repeated dispute evidence without a deadline keeps the deadline null and emits once", async () => {
      const w = await paidPayment(kind);
      const observation: PaymentEvidence = { ...evidence, disputes: [{ providerDisputeRef: "dp_1", amount: USD(17), status: "open" }] };
      await w.payment(observation);
      expect(await w.payment(observation)).toEqual({ kind: "applied", quarantined: [], outbox: [], deferred: 0 });
      const rows = await w.ledger.transaction({ fn: (tx) => tx.listDisputes({ paymentId: "pay_1" }) });
      expect(rows).toEqual([expect.objectContaining({ providerDisputeRef: "dp_1", currency: "USD", amountMinor: 17, status: "open", dueBy: null })]);
      expect((await w.read()).payment).toMatchObject({ disputedMinor: 17, refundedMinor: 0, currency: "USD" });
    });
  });
}
