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
      const first = await w.ledger.transaction({ fn: (tx) => tx.insertInbox({ entry }) });
      const second = await w.ledger.transaction({ fn: (tx) => tx.insertInbox({ entry: { ...entry, id: "in_2" } }) });
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

    test("settlement facts are stored on the payment; a succeeded payment carries no next action", async () => {
      const w = await paidPayment(kind);
      const snapshot = await w.retrieve();
      await w.payment({
        ...snapshot, next: { kind: "redirect", url: "https://pay.test/3ds" },
        settlement: { fee: USD(320), net: USD(9_680), settlement: { minorUnits: 9_100, currency: "EUR" } },
      });
      // R1-F5: the action follows the merged status, so a redirect on a succeeded intent is not kept
      // (storing an in-progress action is covered in review-fixes.vitest.test.ts).
      expect((await w.read()).payment).toMatchObject({
        nextActionJson: JSON.stringify({ kind: "none" }),
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

  /** Applies each delivery; returns true when it was (partly) deferred and must be retried by the worker. */
  const isDeferred = (r: unknown) => (r as { kind: string }).kind === "deferred" || ((r as { deferred?: number }).deferred ?? 0) > 0;

  function shuffle<T>(items: T[], seed: number): T[] {
    const random = rng(seed);
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }

  /** The inbox worker's park-and-retry, to a fixpoint: only deferred deliveries are delivered again. */
  async function deliverUntilSettled(deliveries: Array<() => Promise<unknown>>): Promise<number> {
    let pending = deliveries;
    for (let round = 0; round < 4 && pending.length > 0; round++) {
      const next: typeof pending = [];
      for (const deliver of pending) if (isDeferred(await deliver())) next.push(deliver);
      pending = next;
    }
    return pending.length;
  }

  async function scenario(kind: LedgerKind, seed: number) {
    // Every third seed: equal amounts, the ambiguous case for providers that do not echo.
    const [a1, a2] = seed % 3 === 0 ? [2_500, 2_500] : [3_000, 2_000];
    const foreign = (["succeeded", "failed", undefined, undefined] as const)[seed % 4];
    const w = await paidPayment(kind, { echoesCorrelation: seed % 2 === 0 });
    await w.reserve("rf_1", a1);
    await w.reserve("rf_2", a2);
    if (seed % 5 === 0) w.fake.server.script({ op: "refund", behaviours: ["timeout"] });
    const r1 = await w.dispatch("rf_1", a1);
    const r2 = await w.dispatch("rf_2", a2);
    const early = await w.retrieve();
    w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
    w.fake.server.settleRefund({ refundId: "re_3", status: "succeeded" });
    const stuck = await deliverUntilSettled(shuffle([
      () => (r1.kind === "ok" ? w.refundEvidence(r1.value, "rf_1") : w.dispatchOutcome("rf_1", "unknown")),
      () => w.refundEvidence((r2 as { value: never }).value, "rf_2"),
      async () => w.payment(await w.webhook("refund.updated", "re_2", "e1")),
      async () => w.payment(await w.webhook("refund.updated", "re_3", "e2")),
      async () => w.payment(await w.webhook("charge.refunded", "ch_1", "e3")),
      async () => w.payment(await w.webhook("charge.refunded", "ch_1", "e3")),
      () => w.payment(early, "retrieve"),
      // A dashboard refund of the SAME amount as ours, with no correlation id (seeds 0/1 mod 4).
      ...(foreign ? [() => w.refundEvidence({ providerRefundRef: "re_D", amount: USD(a1), status: foreign })] : []),
    ], seed));
    const { payment, refunds, outbox, quarantine } = await w.read();
    return {
      actual: { stuck, refunded: payment.refundedMinor, held: payment.refundHeldMinor, rows: refunds.length, announced: count(outbox, "refund.succeeded"), quarantine: quarantine.length },
      expected: {
        stuck: 0, refunded: a1 + a2 + (foreign === "succeeded" ? a1 : 0), held: 0,
        rows: foreign ? 3 : 2, announced: foreign === "succeeded" ? 3 : 2, quarantine: 0,
      },
    };
  }

  for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
    test(`${kind}: shuffled deliveries (responses, both webhook types, duplicates, a stale snapshot, timeouts), retrying only deferred ones`, async () => {
      for (let seed = 1; seed <= (kind === "memory" ? 200 : 40); seed++) {
        const { actual, expected } = await scenario(kind, seed);
        expect(actual, `seed ${seed}`).toEqual(expected);
      }
    }, 120_000);
  }
});

describe("guards", () => {
  const deps = { now: () => NOW, newId: () => "x" };

  test("every writer reports a missing payment", async () => {
    const ledger = memoryPaymentsLedger();
    const evidence = { providerRefundRef: "re", amount: USD(1), status: "succeeded" as const };
    await ledger.transaction({ fn: async (tx) => {
      expect(await applyPaymentEvidence({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "nope", source: "webhook", evidence: { providerRef: "c", status: "pending", refunds: [], disputes: [] } })).toEqual({ kind: "missing" });
      expect(await applyRefundEvidence({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "nope", source: "webhook", evidence })).toEqual({ kind: "missing" });
      expect(await reserveRefund({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "nope", refundId: "r", amountMinor: 1, idempotencyKey: "k" })).toEqual({ kind: "missing" });
      expect(await recordRefundDispatchOutcome({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "nope", refundId: "r", outcome: "unknown" })).toEqual({ kind: "missing" });
    } });
  });

  test("an unpaid payment is not refundable; a bad amount is refused; an unknown refund id is missing", async () => {
    const ledger = memoryPaymentsLedger();
    await ledger.transaction({ fn: (tx) => tx.insertPayment({ payment: newPayment({ intentStatus: "pending", status: "pending" }) }) });
    await ledger.transaction({ fn: async (tx) => {
      expect(await reserveRefund({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", refundId: "r", amountMinor: 1, idempotencyKey: "k" })).toEqual({ kind: "not-refundable", status: "pending" });
      expect(await recordRefundDispatchOutcome({ tx, deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", refundId: "r", outcome: "rejected" })).toEqual({ kind: "missing" });
    } });
    const w = await paidPayment("memory");
    expect(await w.reserve("r", 0)).toEqual({ kind: "invalid-amount" });
    expect(await w.reserve("r", 1.5)).toEqual({ kind: "invalid-amount" });
  });

  test("a refund reservation carries its idempotency key and reason", async () => {
    const w = await paidPayment("memory");
    const reserved = await w.ledger.transaction({ fn: (tx) =>
      reserveRefund({ tx, deps: w.deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", refundId: "rf_r", amountMinor: 100, idempotencyKey: "kr" }, { reason: "requested_by_customer" }) });
    expect(reserved).toMatchObject({ kind: "reserved", refund: { idempotencyKey: "kr", reason: "requested_by_customer", status: "reserved", currency: "USD" } });
  });

  test("a writer that bypasses the lock is detected, not silently overwritten", async () => {
    const w = await paidPayment("memory");
    await expect(w.ledger.transaction({ fn: async (tx) => {
      const original = tx.updatePayment.bind(tx);
      tx.updatePayment = async (r) => { await original({ ...r, patch: { updatedAt: NOW } }); return original(r); };
      return applyRefundEvidence({ tx, deps: w.deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", source: "webhook", evidence: { providerRefundRef: "re_q", amount: USD(5), status: "pending" } });
    } })).rejects.toThrow("payments ledger: payment pay_1 changed under its lock");
  });
});

describe("providers that do not echo our correlation id", () => {
  test("one in-flight refund awaiting its response: the webhook is deferred, then matches by ref", async () => {
    const w = await paidPayment("memory", { echoesCorrelation: false });
    await w.reserve("rf_1", 3_000);
    const response = await w.dispatch("rf_1", 3_000);
    w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
    const early = await w.webhook("refund.updated", "re_2", "evt_1");
    expect(await w.payment(early)).toMatchObject({ kind: "applied", deferred: 1 });
    await w.refundEvidence((response as { value: never }).value, "rf_1");
    expect(await w.payment(early)).toMatchObject({ kind: "applied", deferred: 0 });
    const { refunds, payment } = await w.read();
    expect(refunds).toEqual([expect.objectContaining({ id: "rf_1", providerRefundRef: "re_2", status: "succeeded" })]);
    expect(payment.refundedMinor).toBe(3_000);
  });

  test("a foreign dashboard refund of the same amount never takes our awaited reservation", async () => {
    const w = await paidPayment("memory", { echoesCorrelation: false });
    await w.reserve("rf_1", 500);
    const response = await w.dispatch("rf_1", 500);
    const foreign = { providerRefundRef: "re_D", amount: USD(500), status: "failed" as const };
    expect(await w.refundEvidence(foreign)).toEqual({ kind: "deferred" });
    await w.refundEvidence((response as { value: never }).value, "rf_1");
    expect(await w.refundEvidence({ ...foreign, status: "succeeded" })).toMatchObject({ kind: "applied" });
    const { refunds, payment } = await w.read();
    expect(refunds.find((r) => r.id === "rf_1")).toMatchObject({ providerRefundRef: "re_2", status: "pending" });
    expect(refunds.filter((r) => r.id !== "rf_1").map((r) => [r.providerRefundRef, r.status])).toEqual([["re_D", "succeeded"]]);
    expect(payment).toMatchObject({ refundedMinor: 500, refundHeldMinor: 500 });
  });

  test("timeout without echo: a retrieve snapshot settles the unknown row (no endless deferral)", async () => {
    const w = await paidPayment("memory", { echoesCorrelation: false });
    await w.reserve("rf_1", 3_000);
    w.fake.server.script({ op: "refund", behaviours: ["timeout"] });
    await w.dispatch("rf_1", 3_000);
    await w.dispatchOutcome("rf_1", "unknown");
    w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
    await w.payment(await w.retrieve(), "retrieve");
    expect((await w.read()).refunds).toEqual([expect.objectContaining({ id: "rf_1", status: "succeeded", providerRefundRef: "re_2" })]);
  });

  test("two in-flight refunds of the same amount: defer, then match once the responses bind refs", async () => {
    const w = await paidPayment("memory", { echoesCorrelation: false });
    await w.reserve("rf_1", 3_000);
    await w.reserve("rf_2", 3_000);
    const r1 = await w.dispatch("rf_1", 3_000);
    const r2 = await w.dispatch("rf_2", 3_000);
    w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
    const early = await w.webhook("refund.updated", "re_2", "evt_1");
    expect(await w.payment(early)).toMatchObject({ kind: "applied", deferred: 1 });
    expect(await w.refundEvidence(early.refunds[0]!)).toEqual({ kind: "deferred" });
    await w.refundEvidence((r1 as { value: never }).value, "rf_1");
    await w.refundEvidence((r2 as { value: never }).value, "rf_2");
    expect(await w.payment(early)).toMatchObject({ kind: "applied", deferred: 0 });
    const { refunds, payment } = await w.read();
    expect(refunds.map((r) => [r.id, r.providerRefundRef, r.status])).toEqual([["rf_1", "re_2", "succeeded"], ["rf_2", "re_3", "pending"]]);
    expect(payment).toMatchObject({ refundedMinor: 3_000, refundHeldMinor: 3_000 });
  });
});

describe("L3 review fixes (writer)", () => {
  test("BLOCKER: a rejected retry never flips a settled or in-flight refund to failed", async () => {
    const w = await paidPayment("memory");
    await w.reserve("rf_1", 10_000);
    w.fake.server.script({ op: "refund", behaviours: ["timeout"] });
    await w.dispatch("rf_1", 10_000);
    await w.dispatchOutcome("rf_1", "unknown");
    await w.dispatchOutcome("rf_1", "rejected");
    expect((await w.read()).refunds[0]!.status).toBe("unknown");
    w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
    await w.payment(await w.retrieve(), "retrieve");
    await w.dispatchOutcome("rf_1", "rejected");
    const { refunds, payment } = await w.read();
    expect(refunds[0]!.status).toBe("succeeded");
    expect(payment).toMatchObject({ refundedMinor: 10_000, status: "refunded" });
    expect(await w.reserve("rf_2", 1)).toEqual({ kind: "insufficient", refundableMinor: 0 });
  });

  test("money withdrawn by a dispute is not refundable", async () => {
    const w = await paidPayment("memory");
    const snapshot = await w.retrieve();
    await w.payment({ ...snapshot, disputes: [{ providerDisputeRef: "dp_1", amount: USD(7_000), status: "open" }] });
    expect(await w.reserve("rf_1", 3_001)).toEqual({ kind: "insufficient", refundableMinor: 3_000 });
    await w.payment({ ...snapshot, disputes: [{ providerDisputeRef: "dp_1", amount: USD(7_000), status: "won" }] });
    expect(await w.reserve("rf_1", 10_000)).toMatchObject({ kind: "reserved" });
  });

  test("a snapshot applies refund failures before successes, so the cap sees the returned money", async () => {
    const w = await paidPayment("memory");
    await w.reserve("rf_a", 10_000);
    await w.dispatch("rf_a", 10_000);
    w.fake.server.settleRefund({ refundId: "re_2", status: "succeeded" });
    await w.payment(await w.webhook("refund.updated", "re_2", "e1"));
    const snapshot = await w.retrieve();
    const failedA = { ...snapshot.refunds[0]!, status: "failed" as const };
    const dashboardB = { providerRefundRef: "re_dash", amount: USD(10_000), status: "succeeded" as const };
    expect(await w.payment({ ...snapshot, refunds: [dashboardB, failedA] })).toMatchObject({ kind: "applied", quarantined: [] });
    const { payment, refunds } = await w.read();
    expect(payment.refundedMinor).toBe(10_000);
    expect(refunds.map((r) => r.status).sort()).toEqual(["failed", "succeeded"]);
  });

  test("payment.succeeded is enqueued before any refund topic of the same observation", async () => {
    const w = await paidPayment("memory");
    const first = await w.retrieve();
    // A fresh payment whose first evidence already carries a refund.
    await w.ledger.transaction({ fn: (tx) => tx.insertPayment({ payment: { ...newPayment({ id: "pay_2", idempotencyKey: "idem-2" }) } }) });
    const result = await w.ledger.transaction({ fn: (tx) => applyPaymentEvidence({
      tx, deps: w.deps, workspaceId: "ws", mode: "test", paymentId: "pay_2", source: "webhook",
      evidence: { ...first, providerRef: "ch_9", correlationId: "pay_2", refunds: [{ providerRefundRef: "re_9", amount: USD(100), status: "succeeded" }] },
    }) });
    expect(result).toMatchObject({ kind: "applied", outbox: ["payment.succeeded", "refund.succeeded"] });
  });

  test("every writer takes the payment lock before any other ledger access", async () => {
    const w = await paidPayment("memory");
    await w.reserve("rf_1", 1_000);
    const calls: string[] = [];
    const run = (fn: Parameters<typeof w.ledger.transaction>[0]["fn"]) => w.ledger.transaction({ fn: (tx) => {
      const spy = new Proxy(tx, { get: (target, name) => {
        const value = Reflect.get(target, name);
        return typeof value === "function" ? (...args: unknown[]) => { calls.push(String(name)); return value.apply(target, args); } : value;
      } });
      return fn(spy);
    } });
    const base = { deps: w.deps, workspaceId: "ws", mode: "test" as const, paymentId: "pay_1" };
    const writers = [
      (tx: never) => applyPaymentEvidence({ ...base, tx, source: "retrieve", evidence: { providerRef: "ch_1", status: "succeeded", refunds: [], disputes: [] } }),
      (tx: never) => applyRefundEvidence({ ...base, tx, source: "webhook", evidence: { providerRefundRef: "re_x", correlationId: "rf_1", amount: USD(1_000), status: "pending" } }),
      (tx: never) => reserveRefund({ ...base, tx, refundId: "rf_2", amountMinor: 1, idempotencyKey: "k2" }),
      (tx: never) => recordRefundDispatchOutcome({ ...base, tx, refundId: "rf_2", outcome: "unknown" }),
    ];
    for (const writer of writers) {
      calls.length = 0;
      await run(writer as never);
      expect(calls[0]).toBe("lockPayment");
    }
  });
});
