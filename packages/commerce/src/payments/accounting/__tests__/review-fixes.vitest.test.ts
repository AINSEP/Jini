import { describe, expect, test } from "vitest";

import { USD, paidPayment, type LedgerKind } from "./harness.js";

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
