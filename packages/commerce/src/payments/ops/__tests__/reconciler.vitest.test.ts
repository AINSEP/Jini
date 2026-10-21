import { describe, expect, test } from "vitest";

import type { NewPayment } from "../../ledger/rows.js";
import { newPayment } from "../../accounting/__tests__/harness.js";
import { LIPAY, NOW, SCRIPTED, USD, paidLipay, recordingAlerts, timedOut, world, type World } from "./harness.js";

/**
 * @file The reconciler: unknown intents settled from `retrieve`, unsettled refunds settled from
 * the payment snapshot, the owner's "no such refund at the provider → failed" rule, and every
 * case it must leave alone (with an `unknown-aged` alert).
 */

const AGE = 60_000;
const zero = { scanned: 0, settled: 0, failed: 0, left: 0, errors: 0 };

async function insertPayment(w: World, overrides: Partial<NewPayment>) {
  const payment = newPayment({ siteId: "site", createdAt: NOW - AGE * 2, updatedAt: NOW - AGE * 2, ...overrides });
  await w.ledger.transaction((tx) => tx.insertPayment({ payment }));
  return payment;
}

async function unknownRefund(w: World, refunds: "payment" | "payment+refunds") {
  const paid = await w.service.createIntent({ scope: SCRIPTED, amount: USD(10_000), idempotencyKey: "ik", reference: "o" });
  const id = (paid as { payment: { id: string } }).payment.id;
  w.scripted.queue("refund", timedOut());
  const grant = await w.grant({ op: "refund", paymentId: id, amount: USD(3_000), idempotencyKey: "rk", scope: SCRIPTED });
  await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(3_000), idempotencyKey: "rk", grant });
  w.tick(AGE * 2);
  return { id, refundId: (await w.read(id)).refunds[0]!.id, retrieveKind: refunds };
}

describe("reconcileUnknown: payments", () => {
  test("an unknown intent with a provider ref is settled from retrieve (source retrieve)", async () => {
    const w = await world({ scripted: { capture: "auto" } });
    const p = await insertPayment(w, { id: "pay_r", providerId: "scripted", providerRef: "sp_pay_r", idempotencyKey: "k1" });
    w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: "sp_pay_r", status: "succeeded", refunds: [], disputes: [] } });
    expect(await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).toEqual({ payments: { ...zero, scanned: 1, settled: 1 }, refunds: zero });
    const after = await w.read(p.id);
    expect(after.payment).toMatchObject({ intentStatus: "succeeded", capturedMinor: 10_000 });
    expect(after.evidence.map((e) => e.source)).toEqual(["retrieve"]);
  });

  test("what cannot be settled is left with an unknown-aged alert", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts, scripted: { retrieve: "none" } });
    await insertPayment(w, { id: "p_gone", providerId: "gone", idempotencyKey: "a", providerRef: "x1" });
    await insertPayment(w, { id: "p_noretrieve", providerId: "scripted", idempotencyKey: "b", providerRef: "x2" });
    await insertPayment(w, { id: "p_noref", providerId: "lipay", idempotencyKey: "c" });
    await insertPayment(w, { id: "p_ctx", providerId: "lipay", idempotencyKey: "d", providerRef: "x4" });
    w.failContextFor("lipay");
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments).toEqual({ ...zero, scanned: 4, left: 4 });
    // Equal update times: listed by id.
    expect(alerts.raised.map((a) => [a.kind, a.paymentId, a.detail])).toEqual([
      ["unknown-aged", "p_ctx", "payment p_ctx is unknown: no credentials for lipay"],
      ["unknown-aged", "p_gone", "payment p_gone is unknown: provider 'gone' is not registered"],
      ["unknown-aged", "p_noref", "payment p_noref is unknown: no provider reference (the provider never answered)"],
      ["unknown-aged", "p_noretrieve", "payment p_noretrieve is unknown: provider 'scripted' cannot retrieve"],
    ]);
  });

  test("a failed retrieve or a quarantined snapshot leaves it; a storage fault is counted as an error and the run moves on", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts });
    await insertPayment(w, { id: "p_a", providerId: "scripted", idempotencyKey: "a", providerRef: "ra", updatedAt: NOW - AGE * 4 });
    await insertPayment(w, { id: "p_b", providerId: "scripted", idempotencyKey: "b", providerRef: "rb", updatedAt: NOW - AGE * 3 });
    await insertPayment(w, { id: "p_c", providerId: "scripted", idempotencyKey: "c", providerRef: "rc", updatedAt: NOW - AGE * 2 });
    const taken = await insertPayment(w, { id: "p_taken", providerId: "scripted", idempotencyKey: "t", providerRef: "rt", intentStatus: "succeeded", status: "succeeded" });
    await w.ledger.transaction((tx) => tx.insertRefund({ refund: {
      id: "rf_taken", paymentId: taken.id, workspaceId: "ws", siteId: "site", providerId: "scripted", providerAccountId: "acct_fake", mode: "test",
      idempotencyKey: null, providerRefundRef: "rr_taken", currency: "USD", amountMinor: 100, status: "succeeded", reason: null, createdAt: NOW, updatedAt: NOW,
    } }));
    w.scripted.queue(
      "retrieve",
      timedOut(),
      { kind: "ok", value: { providerRef: "rb", status: "succeeded", amount: USD(1), refunds: [], disputes: [] } },
      // The snapshot carries a refund ref another payment holds: the unique key throws inside the apply.
      { kind: "ok", value: { providerRef: "rc", status: "succeeded", refunds: [{ providerRefundRef: "rr_taken", amount: USD(100), status: "succeeded" }], disputes: [] } },
    );
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments).toEqual({ ...zero, scanned: 3, left: 2, errors: 1 });
    expect(alerts.raised.filter((a) => a.kind === "unknown-aged").map((a) => a.detail)).toEqual([
      "payment p_a is unknown: timed out", "payment p_b is unknown: its snapshot was quarantined",
    ]);
  });

  test("the cutoff, the limit and the scope bound the scan", async () => {
    const w = await world({ scripted: { retrieve: "none" } });
    await insertPayment(w, { id: "p_old", providerId: "scripted", idempotencyKey: "a" });
    await insertPayment(w, { id: "p_new", providerId: "scripted", idempotencyKey: "b", updatedAt: NOW - 10 });
    await insertPayment(w, { id: "p_live", providerId: "scripted", idempotencyKey: "c", mode: "live" });
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments.scanned).toBe(2);
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 1 })).payments.scanned).toBe(1);
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 }, { scope: { workspaceId: "ws", mode: "test" } })).payments.scanned).toBe(1);
  });
});

describe("reconcileUnknown: refunds", () => {
  test("OWNER RULE: a full snapshot with no such refund means the provider never made it → failed, hold released", async () => {
    const w = await world({ scripted: { capture: "auto", retrieve: "payment+refunds" } });
    const { id, refundId } = await unknownRefund(w, "payment+refunds");
    w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${id}`, status: "succeeded", refunds: [], disputes: [] } });
    expect(await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).toEqual({ payments: zero, refunds: { ...zero, scanned: 1, failed: 1 } });
    const after = await w.read(id);
    expect(after.refunds).toEqual([expect.objectContaining({ id: refundId, status: "failed" })]);
    expect(after.payment?.refundHeldMinor).toBe(0);
    expect(after.outbox.at(-1)).toBe("refund.failed");
    expect(after.evidence.at(-1)).toMatchObject({ source: "retrieve", subject: "refund", observedStatus: "failed" });
  });

  test("a snapshot that carries the refund settles it from evidence", async () => {
    const w = await world();
    const paid = await paidLipay(w);
    w.lipay.server.script({ op: "refund", behaviours: ["timeout"] });
    await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk", grant: await w.grant({ op: "refund", paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk" }) });
    const [row] = (await w.read(paid.id)).refunds;
    expect(row?.status).toBe("unknown");
    // The fake made the refund server-side before "timing out"; it has since succeeded.
    w.lipay.server.settleRefund({ refundId: "re_2", status: "succeeded" });
    w.tick(AGE * 2);
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, settled: 1 });
    expect((await w.read(paid.id)).payment).toMatchObject({ refundedMinor: 3_000, refundHeldMinor: 0 });
  });

  test("still in progress at the provider (pending), or a provider that cannot list refunds: left with an alert", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts });
    const paid = await paidLipay(w);
    w.lipay.server.script({ op: "refund", behaviours: ["timeout"] });
    await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk", grant: await w.grant({ op: "refund", paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk" }) });
    w.tick(AGE * 2);
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, left: 1 });
    expect(alerts.raised.at(-1)?.detail).toMatch(/is pending: the provider still reports it in progress$/);

    const w2 = await world({ alerts, scripted: { capture: "auto", retrieve: "payment" } });
    const { id } = await unknownRefund(w2, "payment");
    expect((await w2.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, left: 1 });
    expect(alerts.raised.at(-1)).toMatchObject({ kind: "unknown-aged", paymentId: id, detail: expect.stringMatching(/is unknown: the provider cannot list refunds$/) });
  });

  test("a snapshot listing an unbound refund that may be ours (a provider that does not echo) is not judged", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts, scripted: { capture: "auto", retrieve: "payment+refunds", echoesCorrelation: false } });
    const { id } = await unknownRefund(w, "payment+refunds");
    const foreign = { providerRefundRef: "sre_other", amount: USD(1_000), status: "succeeded" as const };
    w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${id}`, status: "succeeded", refunds: [foreign], disputes: [] } });
    // The writer inserts the foreign refund (another amount) as its own row, so it is bound elsewhere and ours is judged.
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, failed: 1 });
    const refunds = (await w.read(id)).refunds;
    expect(refunds.map((r) => r.status).sort()).toEqual(["failed", "succeeded"]);

    const w2 = await world({ alerts, scripted: { capture: "auto", retrieve: "payment+refunds", echoesCorrelation: false } });
    const two = await unknownRefund(w2, "payment+refunds");
    // A FAILURE of our amount without a correlation id never binds by amount (it is deferred), so it may still be ours.
    w2.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${two.id}`, status: "succeeded", refunds: [{ ...foreign, amount: USD(3_000), status: "failed" }], disputes: [] } });
    expect((await w2.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, left: 1 });
    expect(alerts.raised.at(-1)?.detail).toMatch(/the snapshot lists a refund that may be it$/);
  });

  test("a snapshot naming our refund by its ref, though not settling it, is left", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts, scripted: { capture: "auto", retrieve: "payment+refunds" } });
    const { id, refundId } = await unknownRefund(w, "payment+refunds");
    await w.ledger.transaction((tx) => tx.updateRefund({ id: refundId, patch: { providerRefundRef: "sre_known", updatedAt: NOW } }));
    w.tick(AGE * 2);
    // Same ref, but a currency the writer quarantines: the row stays unknown.
    const bad = { providerRefundRef: "sre_known", amount: { minorUnits: 3_000, currency: "EUR" }, status: "succeeded" as const };
    w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${id}`, status: "succeeded", refunds: [bad], disputes: [] } });
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, left: 1 });
    expect(alerts.raised.map((a) => a.kind)).toEqual(["quarantine", "unknown-aged"]);
  });

  test("a reservation left by a crash between Tx1 and Tx2 becomes unknown, then is judged", async () => {
    const w = await world({ scripted: { capture: "auto", retrieve: "payment+refunds" } });
    const paid = await w.service.createIntent({ scope: SCRIPTED, amount: USD(10_000), idempotencyKey: "ik", reference: "o" });
    const id = (paid as { payment: { id: string } }).payment.id;
    const { reserveRefund } = await import("../../accounting/apply-evidence.js");
    await w.ledger.transaction((tx) => reserveRefund({ tx, deps: { now: () => NOW, newId: () => "rf_crash" }, workspaceId: "ws", mode: "test", paymentId: id, refundId: "rf_crash", amountMinor: 500, idempotencyKey: "rk" }));
    w.tick(AGE * 2);
    w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${id}`, status: "succeeded", refunds: [], disputes: [] } });
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, failed: 1 });
  });

  test("no snapshot: left with an alert", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts, scripted: { capture: "auto", retrieve: "payment+refunds" } });
    const { refundId } = await unknownRefund(w, "payment+refunds");
    w.scripted.queue("retrieve", timedOut());
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, left: 1 });
    expect(alerts.raised.at(-1)?.detail).toBe(`refund ${refundId} is unsettled: timed out`);
  });
});
