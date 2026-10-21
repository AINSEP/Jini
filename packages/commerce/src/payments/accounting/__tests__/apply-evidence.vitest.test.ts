import { describe, expect, test } from "vitest";

import { memoryPaymentsLedger } from "../../ledger/repo.memory.js";
import {
  applyPaymentEvidence, applyRefundEvidence, recordRefundDispatchOutcome, reserveRefund,
} from "../apply-evidence.js";
import { NOW, USD, newPayment, paidPayment, type LedgerKind } from "./harness.js";

/**
 * @file L3: the single writer under every delivery race the design names — webhook before the
 * synchronous response, duplicate event ids, the same refund via two event types, reversed
 * order, timeout then late success, a stale snapshot, two concurrent refunds — on the in-memory
 * ledger AND the SQL ledger over SQLite, driven by the deterministic LiPay fake.
 */

const count = (topics: string[], topic: string) => topics.filter((t) => t === topic).length;

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`single writer on ${kind}`, () => {
    test("the charge response binds the payment: succeeded, captured, payment.succeeded once", async () => {
      const w = await paidPayment(kind);
      const { payment, outbox, evidence } = await w.read();
      expect(payment).toMatchObject({ intentStatus: "succeeded", status: "succeeded", providerRef: "ch_1", capturedMinor: 10_000, version: 2 });
      expect(outbox).toEqual(["payment.succeeded"]);
      expect(evidence.map((e) => [e.source, e.subject, e.observedStatus])).toEqual([["response", "payment", "succeeded"]]);
      // A replayed charge.succeeded webhook changes nothing and announces nothing.
      await w.payment(await w.webhook("charge.succeeded", "ch_1", "evt_dup"));
      expect((await w.read()).outbox).toEqual(["payment.succeeded"]);
    });

    test("webhook BEFORE the synchronous response: one row, counted once (B2)", async () => {
      const w = await paidPayment(kind);
      expect(await w.reserve("rf_1", 3_000)).toMatchObject({ kind: "reserved" });
      expect((await w.read()).payment).toMatchObject({ refundHeldMinor: 3_000, refundedMinor: 0 });
      const response = await w.dispatch("rf_1", 3_000);
      w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
      await w.payment(await w.webhook("refund.updated", "re_2", "evt_1"));
      if (response.kind !== "ok") throw new Error("expected ok");
      expect(await w.refundEvidence(response.value, "rf_1")).toEqual({ kind: "applied", quarantined: [], outbox: [], deferred: 0 });
      const { payment, refunds, outbox } = await w.read();
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({ id: "rf_1", providerRefundRef: "re_2", status: "succeeded", amountMinor: 3_000 });
      expect(payment).toMatchObject({ refundedMinor: 3_000, refundHeldMinor: 0, status: "partially_refunded" });
      expect(count(outbox, "refund.succeeded")).toBe(1);
    });

    test("duplicate event ids are deduped by the inbox; re-applying the same evidence is a no-op anyway", async () => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 3_000);
      await w.dispatch("rf_1", 3_000);
      w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
      const entry = {
        id: "in_1", workspaceId: "ws", siteId: "site", providerId: "lipay", providerAccountId: "acct_fake", mode: "test" as const,
        providerEventId: "evt_1", factsJson: "{}", bodySha256: "ab".repeat(32), nextAttemptAt: NOW, receivedAt: NOW,
      };
      const first = await w.ledger.transaction((tx) => tx.insertInbox({ entry }));
      const second = await w.ledger.transaction((tx) => tx.insertInbox({ entry: { ...entry, id: "in_2" } }));
      expect([first.inserted, second.inserted]).toEqual([true, false]);
      const evidence = await w.webhook("refund.updated", "re_2", "evt_1");
      await w.payment(evidence);
      await w.payment(evidence);
      const { payment, outbox } = await w.read();
      expect(payment.refundedMinor).toBe(3_000);
      expect(count(outbox, "refund.succeeded")).toBe(1);
    });

    test("the same refund via two event types lands on one row", async () => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 3_000);
      await w.dispatch("rf_1", 3_000);
      w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
      await w.payment(await w.webhook("charge.refunded", "ch_1", "evt_a"));
      await w.payment(await w.webhook("refund.updated", "re_2", "evt_b"));
      const { payment, refunds, outbox } = await w.read();
      expect(refunds).toHaveLength(1);
      expect(payment.refundedMinor).toBe(3_000);
      expect(count(outbox, "refund.succeeded")).toBe(1);
    });

    test("reversed order: a stale pending event after succeeded does not regress it", async () => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 3_000);
      await w.dispatch("rf_1", 3_000);
      const stale = await w.webhook("refund.updated", "re_2", "evt_pending");
      w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
      await w.payment(await w.webhook("refund.updated", "re_2", "evt_done"));
      await w.payment(stale);
      expect((await w.read()).refunds[0]!.status).toBe("succeeded");
    });

    test("timeout → unknown holds the money; a late success settles it (B4)", async () => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 3_000);
      w.fake.server.script({ op: "refund", behaviours: ["timeout"] });
      expect(await w.dispatch("rf_1", 3_000)).toMatchObject({ kind: "unknown" });
      await w.dispatchOutcome("rf_1", "unknown");
      let state = await w.read();
      expect(state.refunds[0]!.status).toBe("unknown");
      expect(state.payment).toMatchObject({ refundHeldMinor: 3_000, refundedMinor: 0, status: "succeeded" });
      expect(await w.reserve("rf_2", 7_001)).toEqual({ kind: "insufficient", refundableMinor: 7_000 });
      w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
      await w.payment(await w.retrieve(), "retrieve");
      state = await w.read();
      expect(state.refunds[0]).toMatchObject({ status: "succeeded", providerRefundRef: "re_2" });
      expect(state.payment).toMatchObject({ refundedMinor: 3_000, refundHeldMinor: 0 });
      // A late "unknown" for an already-settled row cannot regress it.
      await w.dispatchOutcome("rf_1", "unknown");
      expect((await w.read()).refunds[0]!.status).toBe("succeeded");
    });

    test("a rejected dispatch fails the reservation and releases the hold", async () => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 3_000);
      await w.dispatchOutcome("rf_1", "rejected");
      const { refunds, payment } = await w.read();
      expect(refunds[0]!.status).toBe("failed");
      expect(payment).toMatchObject({ refundHeldMinor: 0, status: "succeeded" });
    });

    test("a stale snapshot taken before the refund never deletes or regresses it", async () => {
      const w = await paidPayment(kind);
      const before = await w.retrieve();
      await w.reserve("rf_1", 3_000);
      await w.dispatch("rf_1", 3_000);
      w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
      await w.payment(await w.webhook("refund.updated", "re_2", "evt_1"));
      await w.payment(before, "retrieve");
      const { refunds, payment } = await w.read();
      expect(refunds).toHaveLength(1);
      expect(payment.refundedMinor).toBe(3_000);
    });

    test("two concurrent refunds cannot both take the last refundable money", async () => {
      const w = await paidPayment(kind);
      const results = await Promise.all([w.reserve("rf_a", 6_000), w.reserve("rf_b", 6_000)]);
      expect(results.map((r) => r.kind).sort()).toEqual(["insufficient", "reserved"]);
      expect((await w.read()).payment.refundHeldMinor).toBe(6_000);
    });

    test("a succeeded refund that later fails returns the money: refund.failed, payment back to succeeded", async () => {
      const w = await paidPayment(kind);
      await w.reserve("rf_1", 10_000);
      await w.dispatch("rf_1", 10_000);
      w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
      await w.payment(await w.webhook("refund.updated", "re_2", "evt_1"));
      expect((await w.read()).payment.status).toBe("refunded");
      w.fake.server.settleRefund({ refundId: "re_2", status: "failed" });
      await w.payment(await w.webhook("refund.updated", "re_2", "evt_2"));
      const { payment, outbox } = await w.read();
      expect(payment).toMatchObject({ status: "succeeded", refundedMinor: 0 });
      expect(count(outbox, "refund.failed")).toBe(1);
    });

    test("an over-refund or a charge-amount refund is quarantined, never capped (B1)", async () => {
      const w = await paidPayment(kind);
      const unsolicited = { providerRefundRef: "re_big", amount: USD(10_001), status: "succeeded" as const };
      expect(await w.refundEvidence(unsolicited)).toEqual({ kind: "quarantined", reason: "over-refund" });
      await w.reserve("rf_1", 3_000);
      const charged = { providerRefundRef: "re_x", correlationId: "rf_1", amount: USD(10_000), status: "succeeded" as const };
      expect(await w.refundEvidence(charged)).toEqual({ kind: "quarantined", reason: "amount-mismatch" });
      const { payment, quarantine, refunds } = await w.read();
      expect(payment.refundedMinor).toBe(0);
      expect(quarantine.map((q) => q.reason)).toEqual(["over-refund", "amount-mismatch"]);
      expect(refunds).toHaveLength(1);
    });

    test("disputes: opened then won returns the money; a mismatched intent quarantines the whole observation", async () => {
      const w = await paidPayment(kind);
      const snapshot = await w.retrieve();
      const dispute = { providerDisputeRef: "dp_1", amount: USD(10_000), status: "open" as const, dueBy: NOW + 1 };
      expect(await w.payment({ ...snapshot, disputes: [dispute] })).toMatchObject({ kind: "applied", outbox: ["dispute.opened"] });
      expect((await w.read()).payment.disputedMinor).toBe(10_000);
      await w.payment({ ...snapshot, disputes: [{ ...dispute, status: "won" }] });
      await w.payment({ ...snapshot, disputes: [{ ...dispute, status: "won" }] });
      const after = await w.read();
      expect(after.payment.disputedMinor).toBe(0);
      expect(count(after.outbox, "dispute.closed")).toBe(1);
      expect(await w.payment({ ...snapshot, disputes: [{ ...dispute, amount: { minorUnits: 1, currency: "EUR" } }] }))
        .toEqual({ kind: "applied", quarantined: ["currency-mismatch"], outbox: [], deferred: 0 });
      expect(await w.payment({ ...snapshot, providerRef: "ch_other" })).toEqual({ kind: "quarantined", reason: "ref-conflict" });
    });

    test("next action and settlement facts are stored on the payment", async () => {
      const w = await paidPayment(kind);
      const snapshot = await w.retrieve();
      await w.payment({
        ...snapshot, next: { kind: "redirect", url: "https://pay.test/3ds" },
        settlement: { fee: USD(320), net: USD(9_680), settlement: { minorUnits: 9_100, currency: "EUR" } },
      });
      expect((await w.read()).payment).toMatchObject({
        nextActionJson: JSON.stringify({ kind: "redirect", url: "https://pay.test/3ds" }),
        feeCurrency: "USD", feeMinor: 320, netCurrency: "USD", netMinor: 9_680, settlementCurrency: "EUR", settlementMinor: 9_100,
      });
    });
  });
}

describe("property: any delivery order of the same facts ends in the same ledger", () => {
  /** Deterministic PRNG (mulberry32) so a failure names its seed. */
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test("200 shuffled deliveries of two refunds (responses, both webhook types, duplicates, snapshots)", async () => {
    for (let seed = 1; seed <= 200; seed++) {
      const w = await paidPayment("memory", { echoesCorrelation: seed % 2 === 0 });
      await w.reserve("rf_1", 3_000);
      await w.reserve("rf_2", 2_000);
      const r1 = await w.dispatch("rf_1", 3_000);
      const r2 = await w.dispatch("rf_2", 2_000);
      const early = await w.retrieve();
      w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
      w.fake.server.settleRefund({ refundId: "re_3", status: "succeeded" });
      const deliveries = [
        () => w.refundEvidence((r1 as { value: never }).value, "rf_1"),
        () => w.refundEvidence((r2 as { value: never }).value, "rf_2"),
        async () => w.payment(await w.webhook("refund.updated", "re_2", "e1")),
        async () => w.payment(await w.webhook("refund.updated", "re_3", "e2")),
        async () => w.payment(await w.webhook("charge.refunded", "ch_1", "e3")),
        async () => w.payment(await w.webhook("charge.refunded", "ch_1", "e3")),
        () => w.payment(early, "retrieve"),
      ];
      const random = rng(seed);
      for (let i = deliveries.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [deliveries[i], deliveries[j]] = [deliveries[j]!, deliveries[i]!];
      }
      for (const deliver of deliveries) await deliver();
      // The inbox worker retries parked (deferred) deliveries after the attempts settle: replay all once.
      for (const deliver of deliveries) await deliver();
      const { payment, refunds, outbox, quarantine } = await w.read();
      const summary = { refunded: payment.refundedMinor, held: payment.refundHeldMinor, rows: refunds.length, announced: count(outbox, "refund.succeeded"), quarantine: quarantine.length };
      expect(summary, `seed ${seed}`).toEqual({ refunded: 5_000, held: 0, rows: 2, announced: 2, quarantine: 0 });
    }
  });
});

describe("guards", () => {
  const deps = { now: () => NOW, newId: () => "x" };

  test("every writer reports a missing payment", async () => {
    const ledger = memoryPaymentsLedger();
    const evidence = { providerRefundRef: "re", amount: USD(1), status: "succeeded" as const };
    await ledger.transaction(async (tx) => {
      expect(await applyPaymentEvidence({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "nope", source: "webhook", evidence: { providerRef: "c", status: "pending", refunds: [], disputes: [] } })).toEqual({ kind: "missing" });
      expect(await applyRefundEvidence({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "nope", source: "webhook", evidence })).toEqual({ kind: "missing" });
      expect(await reserveRefund({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "nope", refundId: "r", amountMinor: 1, idempotencyKey: "k" })).toEqual({ kind: "missing" });
      expect(await recordRefundDispatchOutcome({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "nope", refundId: "r", outcome: "unknown" })).toEqual({ kind: "missing" });
    });
  });

  test("an unpaid payment is not refundable; a bad amount is refused; an unknown refund id is missing", async () => {
    const ledger = memoryPaymentsLedger();
    await ledger.transaction((tx) => tx.insertPayment({ payment: newPayment({ intentStatus: "pending", status: "pending" }) }));
    await ledger.transaction(async (tx) => {
      expect(await reserveRefund({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", refundId: "r", amountMinor: 1, idempotencyKey: "k" })).toEqual({ kind: "not-refundable", status: "pending" });
      expect(await recordRefundDispatchOutcome({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", refundId: "r", outcome: "rejected" })).toEqual({ kind: "missing" });
    });
    const w = await paidPayment("memory");
    expect(await w.reserve("r", 0)).toEqual({ kind: "invalid-amount" });
    expect(await w.reserve("r", 1.5)).toEqual({ kind: "invalid-amount" });
  });

  test("a refund reservation carries its idempotency key and reason", async () => {
    const w = await paidPayment("memory");
    const reserved = await w.ledger.transaction((tx) =>
      reserveRefund({ tx, deps: w.deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", refundId: "rf_r", amountMinor: 100, idempotencyKey: "kr" }, { reason: "requested_by_customer" }));
    expect(reserved).toMatchObject({ kind: "reserved", refund: { idempotencyKey: "kr", reason: "requested_by_customer", status: "reserved", currency: "USD" } });
  });

  test("a writer that bypasses the lock is detected, not silently overwritten", async () => {
    const w = await paidPayment("memory");
    await expect(w.ledger.transaction(async (tx) => {
      const original = tx.updatePayment.bind(tx);
      tx.updatePayment = async (r) => { await original({ ...r, patch: { updatedAt: NOW } }); return original(r); };
      return applyRefundEvidence({ tx, deps: w.deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", source: "webhook", evidence: { providerRefundRef: "re_q", amount: USD(5), status: "pending" } });
    })).rejects.toThrow("payments ledger: payment pay_1 changed under its lock");
  });
});

describe("providers that do not echo our correlation id", () => {
  test("a webhook for an in-flight refund is deferred, then matches once the response binds the ref", async () => {
    const w = await paidPayment("memory", { echoesCorrelation: false });
    await w.reserve("rf_1", 3_000);
    const response = await w.dispatch("rf_1", 3_000);
    w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
    const early = await w.webhook("refund.updated", "re_2", "evt_1");
    expect(await w.payment(early)).toMatchObject({ kind: "applied", deferred: 1 });
    expect(await w.refundEvidence((early.refunds[0])!)).toEqual({ kind: "deferred" });
    expect((await w.read()).refunds).toHaveLength(1);
    await w.refundEvidence((response as { value: never }).value, "rf_1");
    expect(await w.payment(early)).toMatchObject({ kind: "applied", deferred: 0 });
    const { refunds, payment } = await w.read();
    expect(refunds).toEqual([expect.objectContaining({ id: "rf_1", providerRefundRef: "re_2", status: "succeeded" })]);
    expect(payment.refundedMinor).toBe(3_000);
  });
});
