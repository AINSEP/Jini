import { describe, expect, test } from "vitest";

import {
  recordIntentDispatchOutcome, settleUnknownIntent, settleUnknownRefund,
} from "../apply-evidence.js";
import { NOW, USD, newPayment, openLedger, paidPayment, recordingAlerts, type LedgerKind } from "./harness.js";

/**
 * @file L4 additions to the single writer: the owner's dispute and over-withdrawn rules, the
 * intent dispatch outcome, and the settle-from-unknown writers the reconciler and the operator
 * path use. Runs on the in-memory ledger and the SQL ledger over SQLite.
 */

const SCOPE = { workspaceId: "ws", mode: "test" } as const;
const succeeded = (refundId: string, amountMinor: number) =>
  ({ providerRefundRef: `re_${refundId}`, correlationId: refundId, amount: USD(amountMinor), status: "succeeded" as const });

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`owner rules on ${kind}`, () => {
    test("a dispute closing with a changed amount: status applied, stored amount kept, only the difference quarantined", async () => {
      const w = await paidPayment(kind);
      const snapshot = await w.retrieve();
      const dispute = { providerDisputeRef: "dp_1", amount: USD(10_000), status: "open" as const };
      await w.payment({ ...snapshot, disputes: [dispute] });
      expect(await w.payment({ ...snapshot, disputes: [{ ...dispute, amount: USD(4_000), status: "lost" }] }))
        .toEqual({ kind: "applied", quarantined: ["dispute-amount-changed"], outbox: ["dispute.closed"], deferred: 0 });
      const after = await w.read();
      expect(after.payment.disputedMinor).toBe(10_000);
      const [entry] = after.quarantine;
      expect(entry).toMatchObject({ reason: "dispute-amount-changed", subject: "dispute", paymentId: "pay_1" });
      expect(JSON.parse(entry!.evidenceJson)).toEqual({
        evidence: { ...dispute, amount: USD(4_000), status: "lost" }, storedMinor: 10_000, observedMinor: 4_000, differenceMinor: -6_000,
      });
      const disputes = await w.ledger.transaction({ fn: (tx) => tx.listDisputes({ paymentId: "pay_1" }) });
      expect(disputes.map((d) => [d.status, d.amountMinor])).toEqual([["lost", 10_000]]);
    });

    test("refunds + disputes above captured raise over-withdrawn ONCE and never cap or refuse the evidence", async () => {
      const alerts = recordingAlerts();
      const w = await paidPayment(kind, { alerts });
      await w.reserve("rf_1", 10_000);
      await w.refundEvidence(succeeded("rf_1", 10_000), "rf_1");
      expect(alerts.raised).toEqual([]);
      const snapshot = await w.retrieve();
      const dispute = { providerDisputeRef: "dp_1", amount: USD(10_000), status: "open" as const };
      expect(await w.payment({ ...snapshot, disputes: [dispute] })).toMatchObject({ kind: "applied", quarantined: [] });
      expect(alerts.raised).toEqual([{
        kind: "over-withdrawn", workspaceId: "ws", mode: "test", paymentId: "pay_1", detail: "withdrawn 20000 > captured 10000 USD (minor units)",
      }]);
      // Still over: a redelivery does not alert again.
      await w.payment({ ...snapshot, disputes: [dispute] });
      expect(alerts.raised).toHaveLength(1);
      expect((await w.read()).payment).toMatchObject({ refundedMinor: 10_000, disputedMinor: 10_000 });
    });

    test("a failing alert port never rolls back the money facts", async () => {
      const alerts = recordingAlerts({ fail: true });
      const w = await paidPayment(kind, { alerts });
      await w.reserve("rf_1", 10_000);
      await w.refundEvidence(succeeded("rf_1", 10_000), "rf_1");
      const snapshot = await w.retrieve();
      await w.payment({ ...snapshot, disputes: [{ providerDisputeRef: "dp_1", amount: USD(5_000), status: "open" }] });
      expect(alerts.raised).toHaveLength(1);
      expect((await w.read()).payment.disputedMinor).toBe(5_000);
    });

    test("without an alert port, over-withdrawn evidence is still applied", async () => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 10_000);
      await w.refundEvidence(succeeded("rf_1", 10_000), "rf_1");
      const snapshot = await w.retrieve();
      await w.payment({ ...snapshot, disputes: [{ providerDisputeRef: "dp_1", amount: USD(5_000), status: "open" }] });
      expect((await w.read()).payment).toMatchObject({ refundedMinor: 10_000, disputedMinor: 5_000 });
    });
  });

  describe(`intent dispatch outcome on ${kind}`, () => {
    async function unknownPayment(overrides: Parameters<typeof newPayment>[0] = {}) {
      const ledger = await openLedger(kind);
      await ledger.transaction({ fn: (tx) => tx.insertPayment({ payment: newPayment(overrides) }) });
      let seq = 0;
      const deps = { now: () => NOW + 1, newId: () => `id_${++seq}` };
      const record = (outcome: "rejected" | "unknown") =>
        ledger.transaction({ fn: (tx) => recordIntentDispatchOutcome({ tx, deps, ...SCOPE, paymentId: "pay_1", outcome }) });
      const read = () => ledger.transaction({ fn: (tx) => tx.getPayment({ ...SCOPE, id: "pay_1" }) });
      return { ledger, record, read };
    }

    test("rejected moves an untouched unknown intent to failed; unknown leaves it unknown", async () => {
      const p = await unknownPayment();
      expect(await p.record("unknown")).toEqual({ kind: "applied", quarantined: [], outbox: [], deferred: 0 });
      expect(await p.read()).toMatchObject({ intentStatus: "unknown", status: "unknown", version: 1 });
      await p.record("rejected");
      expect(await p.read()).toMatchObject({ intentStatus: "failed", status: "failed", updatedAt: NOW + 1, version: 2 });
    });

    test("a rejection never moves an intent that evidence already touched", async () => {
      const bound = await unknownPayment({ providerRef: "ch_1" });
      await bound.record("rejected");
      expect(await bound.read()).toMatchObject({ intentStatus: "unknown", version: 1 });
      const moved = await unknownPayment({ intentStatus: "succeeded", status: "succeeded" });
      await moved.record("rejected");
      expect(await moved.read()).toMatchObject({ intentStatus: "succeeded", version: 1 });
    });

    test("a missing payment is reported", async () => {
      const ledger = await openLedger(kind);
      const deps = { now: () => NOW, newId: () => "x" };
      expect(await ledger.transaction({ fn: (tx) => recordIntentDispatchOutcome({ tx, deps, ...SCOPE, paymentId: "nope", outcome: "rejected" }) }))
        .toEqual({ kind: "missing" });
    });
  });

  describe(`settle from unknown on ${kind}`, () => {
    async function unknownRefund() {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 3_000);
      await w.dispatchOutcome("rf_1", "unknown");
      const settle = (status: "succeeded" | "failed", source: "retrieve" | "operator", refundId = "rf_1") =>
        w.ledger.transaction({ fn: (tx) => settleUnknownRefund({ tx, deps: w.deps, ...SCOPE, paymentId: "pay_1", source, refundId, status }) });
      return { w, settle };
    }

    test("an unknown refund settled failed: hold released, retrieve evidence appended, refund.failed with previousStatus", async () => {
      const { w, settle } = await unknownRefund();
      expect((await w.read()).payment.refundHeldMinor).toBe(3_000);
      expect(await settle("failed", "retrieve")).toEqual({ kind: "settled", outbox: ["refund.failed"] });
      const after = await w.read();
      expect(after.payment).toMatchObject({ refundHeldMinor: 0, refundedMinor: 0, status: "succeeded" });
      expect(after.refunds.map((r) => r.status)).toEqual(["failed"]);
      expect(after.evidence.at(-1)).toMatchObject({ source: "retrieve", subject: "refund", subjectRef: "rf_1", observedStatus: "failed", amountMinor: 3_000, currency: "USD" });
      const messages = await w.ledger.transaction({ fn: (tx) => tx.listPendingOutbox({ limit: 100 }) });
      expect(JSON.parse(messages.at(-1)!.payloadJson)).toEqual({ paymentId: "pay_1", refundId: "rf_1", amountMinor: 3_000, currency: "USD", previousStatus: "unknown" });
      // Settled: a second attempt is refused and writes nothing.
      expect(await settle("succeeded", "operator")).toEqual({ kind: "not-unknown", status: "failed" });
    });

    test("an unknown refund settled succeeded by an operator counts as refunded", async () => {
      const { w, settle } = await unknownRefund();
      expect(await settle("succeeded", "operator")).toEqual({ kind: "settled", outbox: ["refund.succeeded"] });
      const after = await w.read();
      expect(after.payment).toMatchObject({ refundHeldMinor: 0, refundedMinor: 3_000, status: "partially_refunded" });
      expect(after.evidence.at(-1)).toMatchObject({ source: "operator", observedStatus: "succeeded" });
    });

    test("a refund with a provider ref is labelled by it; reserved, missing refund and missing payment are refused", async () => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 3_000);
      const call = (paymentId: string, refundId: string) =>
        w.ledger.transaction({ fn: (tx) => settleUnknownRefund({ tx, deps: w.deps, ...SCOPE, paymentId, source: "operator", refundId, status: "failed" }) });
      expect(await call("pay_1", "rf_1")).toEqual({ kind: "not-unknown", status: "reserved" });
      expect(await call("pay_1", "rf_nope")).toEqual({ kind: "missing" });
      expect(await call("pay_nope", "rf_1")).toEqual({ kind: "missing" });
      await w.ledger.transaction({ fn: (tx) => tx.updateRefund({ id: "rf_1", patch: { status: "unknown", providerRefundRef: "re_7", updatedAt: NOW } }) });
      await call("pay_1", "rf_1");
      expect((await w.read()).evidence.at(-1)).toMatchObject({ subjectRef: "re_7" });
    });

    test("an operator settles an unknown intent: succeeded captures the full amount and announces it; failed moves nothing", async () => {
      const ledger = await openLedger(kind);
      await ledger.transaction({ fn: async (tx) => {
        await tx.insertPayment({ payment: newPayment() });
        await tx.insertPayment({ payment: newPayment({ id: "pay_2", idempotencyKey: "idem-2", providerRef: "ch_2" }) });
      } });
      let seq = 0;
      const deps = { now: () => NOW, newId: () => `id_${++seq}` };
      const settle = (paymentId: string, status: "succeeded" | "failed") =>
        ledger.transaction({ fn: (tx) => settleUnknownIntent({ tx, deps, ...SCOPE, paymentId, source: "operator", status }) });
      expect(await settle("pay_1", "succeeded")).toEqual({ kind: "settled", outbox: ["payment.succeeded"] });
      expect(await settle("pay_2", "failed")).toEqual({ kind: "settled", outbox: [] });
      expect(await settle("pay_1", "failed")).toEqual({ kind: "not-unknown", status: "succeeded" });
      expect(await settle("nope", "failed")).toEqual({ kind: "missing" });
      const read = await ledger.transaction({ fn: async (tx) => ({
        one: await tx.getPayment({ ...SCOPE, id: "pay_1" }), two: await tx.getPayment({ ...SCOPE, id: "pay_2" }),
        ev1: await tx.listEvidence({ paymentId: "pay_1" }), ev2: await tx.listEvidence({ paymentId: "pay_2" }),
      }) });
      expect(read.one).toMatchObject({ intentStatus: "succeeded", status: "succeeded", capturedMinor: 10_000 });
      expect(read.two).toMatchObject({ intentStatus: "failed", status: "failed", capturedMinor: 0 });
      expect(read.ev1).toEqual([expect.objectContaining({ source: "operator", subject: "payment", subjectRef: "pay_1", observedStatus: "succeeded", amountMinor: 10_000 })]);
      expect(read.ev2).toEqual([expect.objectContaining({ subjectRef: "ch_2", observedStatus: "failed" })]);
    });
  });
}
