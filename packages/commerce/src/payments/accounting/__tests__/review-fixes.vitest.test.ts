import { describe, expect, test } from "vitest";

import type { PaymentEvidence } from "../../contract/evidence.js";
import { applyPaymentEvidence } from "../apply-evidence.js";
import { NOW, USD, newPayment, openLedger, paidPayment, type LedgerKind } from "./harness.js";

/**
 * @file Regression tests for the commerce review (01-commerce R1-F1..F6), on the in-memory ledger
 * AND the SQL ledger over SQLite, driven through the single writer.
 */

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`R1-F1 unknown reservation vs foreign same-amount refund (${kind})`, () => {
    test("unknown → foreign pending → foreign failed keeps our hold", async () => {
      const w = await paidPayment(kind, { echoesCorrelation: false });
      await w.reserve("rf_1", 3_000);
      w.fake.server.script({ op: "refund", behaviours: ["timeout"] });
      await w.dispatch("rf_1", 3_000);
      await w.dispatchOutcome("rf_1", "unknown");
      const foreign = { providerRefundRef: "re_D", amount: USD(3_000), status: "pending" as const };
      expect(await w.refundEvidence(foreign)).toEqual({ kind: "deferred" });
      expect(await w.refundEvidence({ ...foreign, status: "failed" })).toEqual({ kind: "deferred" });
      const { refunds, payment } = await w.read();
      expect(refunds.map((r) => [r.id, r.providerRefundRef, r.status])).toEqual([["rf_1", null, "unknown"]]);
      expect(payment).toMatchObject({ refundedMinor: 0, refundHeldMinor: 3_000 });
    });
  });
}

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`R1-F4 authorization with zero captured (${kind})`, () => {
    test("is applied as authorized; a later capture records the captured amount", async () => {
      const ledger = await openLedger(kind);
      let seq = 0;
      const deps = { now: () => NOW, newId: () => `id_${++seq}` };
      const scope = { workspaceId: "ws", mode: "test" as const, paymentId: "pay_1" };
      await ledger.transaction((tx) => tx.insertPayment({ payment: newPayment() }));
      const apply = (evidence: PaymentEvidence) => ledger.transaction((tx) => applyPaymentEvidence({ tx, deps, ...scope, source: "response", evidence }));
      const base = { providerRef: "ch_1", correlationId: "pay_1", amount: USD(10_000), refunds: [], disputes: [] };
      expect(await apply({ ...base, status: "authorized", captured: USD(0) })).toEqual({ kind: "applied", quarantined: [], outbox: [], deferred: 0 });
      const read = () => ledger.transaction((tx) => tx.getPayment({ workspaceId: "ws", mode: "test", id: "pay_1" }));
      expect(await read()).toMatchObject({ intentStatus: "authorized", capturedMinor: 0, status: "authorized" });
      expect(await apply({ ...base, status: "succeeded", captured: USD(6_000) })).toMatchObject({ kind: "applied", quarantined: [], outbox: ["payment.succeeded"] });
      expect(await read()).toMatchObject({ intentStatus: "succeeded", capturedMinor: 6_000 });
    });
  });
}

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`R1-F3 malformed amounts are quarantined, never rolled back (${kind})`, () => {
    const paidEvidence = { providerRef: "ch_1", correlationId: "pay_1", status: "succeeded" as const, refunds: [], disputes: [] };

    test.each([["fractional", 1.5], ["unsafe", 2 ** 53]])("a %s refund amount: bad-amount quarantine, evidence kept without the amount", async (_name, minorUnits) => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 3_000);
      const evidence = { providerRefundRef: "re_9", correlationId: "rf_1", amount: USD(minorUnits), status: "succeeded" as const };
      expect(await w.refundEvidence(evidence)).toEqual({ kind: "quarantined", reason: "bad-amount" });
      const { refunds, quarantine, evidence: log } = await w.read();
      expect(refunds).toEqual([expect.objectContaining({ id: "rf_1", status: "reserved" })]);
      expect(log.at(-1)).toMatchObject({ subject: "refund", subjectRef: "re_9", observedStatus: "succeeded", currency: "USD", amountMinor: null });
      expect(quarantine.map((q) => [q.subject, q.reason, JSON.parse(q.evidenceJson)])).toEqual([["refund", "bad-amount", evidence]]);
    });

    test("a fractional payment amount: bad-amount quarantine, evidence kept without the amount", async () => {
      const w = await paidPayment(kind);
      const evidence = { ...paidEvidence, amount: USD(10_000.5) };
      expect(await w.payment(evidence)).toEqual({ kind: "quarantined", reason: "bad-amount" });
      const { quarantine, evidence: log } = await w.read();
      expect(log.at(-1)).toMatchObject({ subject: "payment", subjectRef: "ch_1", currency: "USD", amountMinor: null });
      expect(quarantine.map((q) => [q.subject, q.reason])).toEqual([["payment", "bad-amount"]]);
    });

    test("a fractional dispute amount: the dispute is quarantined, the rest of the observation applies", async () => {
      const w = await paidPayment(kind);
      const dispute = { providerDisputeRef: "dp_1", amount: USD(0.25), status: "open" as const };
      expect(await w.payment({ ...paidEvidence, disputes: [dispute] })).toMatchObject({ kind: "applied", quarantined: ["bad-amount"] });
      const { payment, quarantine, evidence: log } = await w.read();
      expect(payment.disputedMinor).toBe(0);
      expect(log.at(-1)).toMatchObject({ subject: "dispute", subjectRef: "dp_1", amountMinor: null });
      expect(quarantine.map((q) => [q.subject, q.reason, JSON.parse(q.evidenceJson)])).toEqual([["dispute", "bad-amount", dispute]]);
    });
  });
}

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`R1-F5 the next action follows the merged intent status (${kind})`, () => {
    const redirect = { kind: "redirect" as const, url: "https://pay.test/3ds" };
    const NONE = JSON.stringify({ kind: "none" });
    async function fresh() {
      const ledger = await openLedger(kind);
      let seq = 0;
      const deps = { now: () => NOW, newId: () => `id_${++seq}` };
      await ledger.transaction((tx) => tx.insertPayment({ payment: newPayment() }));
      const apply = (evidence: PaymentEvidence) =>
        ledger.transaction((tx) => applyPaymentEvidence({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", source: "webhook", evidence }));
      const next = async () => (await ledger.transaction((tx) => tx.getPayment({ workspaceId: "ws", mode: "test", id: "pay_1" })))!.nextActionJson;
      return { apply, next };
    }
    const base = { providerRef: "ch_1", correlationId: "pay_1", refunds: [], disputes: [] };

    test("action then success without one: the action is cleared on completion", async () => {
      const p = await fresh();
      await p.apply({ ...base, status: "requires_action", next: redirect });
      expect(await p.next()).toBe(JSON.stringify(redirect));
      await p.apply({ ...base, status: "succeeded" });
      expect(await p.next()).toBe(NONE);
    });

    test("success then a stale action-bearing observation: the action is not restored", async () => {
      const p = await fresh();
      await p.apply({ ...base, status: "succeeded" });
      await p.apply({ ...base, status: "requires_action", next: redirect });
      expect(await p.next()).toBe(NONE);
    });

    test("an observation without an action keeps the live one; a newer in-progress status replaces it", async () => {
      const p = await fresh();
      await p.apply({ ...base, status: "requires_action", next: redirect });
      await p.apply({ ...base, status: "requires_action" });
      expect(await p.next()).toBe(JSON.stringify(redirect));
      await p.apply({ ...base, status: "pending", next: { kind: "none" } });
      expect(await p.next()).toBe(NONE);
    });
  });
}
