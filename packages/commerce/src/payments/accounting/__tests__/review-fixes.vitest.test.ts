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
