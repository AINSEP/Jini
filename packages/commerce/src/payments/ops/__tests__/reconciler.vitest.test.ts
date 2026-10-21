import { describe, expect, test } from "vitest";

import type { NewPayment } from "../../ledger/rows.js";
import { newPayment } from "../../accounting/__tests__/harness.js";
import type { LedgerTx, PaymentsLedger } from "../../ledger/repo.js";
import { reconcileUnknown } from "../reconciler.js";
import { LIPAY, NOW, SCRIPTED, USD, authorizedScripted, paidLipay, recordingAlerts, timedOut, world, type World } from "./harness.js";

/**
 * @file The reconciler: unknown intents settled from `retrieve`, unsettled refunds settled from
 * the payment snapshot, the owner's "no such refund at the provider → failed" rule, and every
 * case it must leave alone (with an `unknown-aged` alert).
 */

const AGE = 60_000;
const zero = { scanned: 0, settled: 0, failed: 0, left: 0, errors: 0 };
/** A pass that saw fewer rows than its limit everywhere: every scan starts over next time. */
const restart = { payments: null, refunds: null, attempts: null };

async function insertPayment(w: World, overrides: Partial<NewPayment>) {
  const payment = newPayment({ siteId: "site", createdAt: NOW - AGE * 2, updatedAt: NOW - AGE * 2, ...overrides });
  await w.ledger.transaction({ fn: (tx) => tx.insertPayment({ payment }) });
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
    expect(await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).toEqual({ payments: { ...zero, scanned: 1, settled: 1 }, refunds: zero, attempts: zero, cursor: restart });
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
    await w.ledger.transaction({ fn: (tx) => tx.insertRefund({ refund: {
      id: "rf_taken", paymentId: taken.id, workspaceId: "ws", siteId: "site", providerId: "scripted", providerAccountId: "acct_fake", mode: "test",
      idempotencyKey: null, providerRefundRef: "rr_taken", currency: "USD", amountMinor: 100, status: "succeeded", reason: null, createdAt: NOW, updatedAt: NOW,
    } }) });
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
    expect(await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).toEqual({ payments: zero, refunds: { ...zero, scanned: 1, failed: 1 }, attempts: zero, cursor: restart });
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
    await w.ledger.transaction({ fn: (tx) => tx.updateRefund({ id: refundId, patch: { providerRefundRef: "sre_known", updatedAt: NOW } }) });
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
    await w.ledger.transaction({ fn: (tx) => reserveRefund({ tx, deps: { now: () => NOW, newId: () => "rf_crash" }, workspaceId: "ws", mode: "test", paymentId: id, refundId: "rf_crash", amountMinor: 500, idempotencyKey: "rk" }) });
    w.tick(AGE * 2);
    w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${id}`, status: "succeeded", refunds: [], disputes: [] } });
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, failed: 1 });
  });

  test("a snapshot the writer refused (quarantined) is not judged: an empty refund list there proves nothing, the hold stays", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts, scripted: { capture: "auto", retrieve: "payment+refunds" } });
    const { id, refundId } = await unknownRefund(w, "payment+refunds");
    // An amount that contradicts the payment's: the writer quarantines the whole observation.
    w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${id}`, status: "succeeded", amount: USD(1), refunds: [], disputes: [] } });
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).refunds).toEqual({ ...zero, scanned: 1, left: 1 });
    const after = await w.read(id);
    expect(after.refunds).toEqual([expect.objectContaining({ id: refundId, status: "unknown" })]);
    expect(after.payment?.refundHeldMinor).toBe(3_000);
    expect(alerts.raised.map((a) => a.kind)).toEqual(["quarantine", "unknown-aged"]);
    expect(alerts.raised.at(-1)?.detail).toBe(`refund ${refundId} is unsettled: its snapshot was quarantined`);
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

/** A held authorization whose capture (or void) timed out: the attempt is `unknown`, the payment still authorized. */
async function ambiguous(w: World, op: "capture" | "void", key = "ik-s") {
  const held = await authorizedScripted(w, key);
  w.scripted.queue(op, timedOut());
  const binding = op === "capture" ? { op, amount: USD(4_000) } : { op, amount: null };
  const grant = await w.grant({ ...binding, paymentId: held.id, idempotencyKey: `${op}-${key}`, scope: SCRIPTED });
  if (op === "capture") await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(4_000), idempotencyKey: `${op}-${key}`, grant });
  else await w.service.void({ scope: SCRIPTED, paymentId: held.id, idempotencyKey: `${op}-${key}`, grant });
  w.tick(AGE * 2);
  const attempt = (await w.read(held.id)).attempts.find((a) => a.op === op)!;
  expect(attempt.outcome).toBe("unknown");
  return { id: held.id, attemptId: attempt.id };
}

const attemptOf = async (w: World, id: string, attemptId: string) => (await w.read(id)).attempts.find((a) => a.id === attemptId);

for (const ledgerKind of ["memory", "sqlite"] as const) {
  describe(`reconcileUnknown: capture/void attempts whose response was lost (${ledgerKind})`, () => {
    test("the provider shows the capture happened: evidence applied, the attempt closes ok, a void is then refused by status", async () => {
      const w = await world({ ledgerKind });
      const { id, attemptId } = await ambiguous(w, "capture");
      w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${id}`, status: "succeeded", captured: USD(4_000), refunds: [], disputes: [] } });
      expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).attempts).toEqual({ ...zero, scanned: 1, settled: 1 });
      expect(await attemptOf(w, id, attemptId)).toMatchObject({ outcome: "ok", updatedAt: NOW + AGE * 2 });
      expect((await w.read(id)).payment).toMatchObject({ intentStatus: "succeeded", capturedMinor: 4_000 });
    });

    test("the provider still shows it authorized: the capture never took effect → rejected, and a void may go out", async () => {
      const w = await world({ ledgerKind });
      const { id, attemptId } = await ambiguous(w, "capture");
      w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${id}`, status: "authorized", refunds: [], disputes: [] } });
      expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).attempts).toEqual({ ...zero, scanned: 1, failed: 1 });
      expect(await attemptOf(w, id, attemptId)).toMatchObject({
        outcome: "rejected", errorCode: "RECONCILED", errorMessage: "reconciled: the provider reports the payment authorized",
      });
      const grant = await w.grant({ op: "void", paymentId: id, amount: null, idempotencyKey: "vk-2", scope: SCRIPTED });
      expect(await w.service.void({ scope: SCRIPTED, paymentId: id, idempotencyKey: "vk-2", grant })).toMatchObject({ ok: true, payment: { status: "canceled" } });
    });
  });
}

describe("reconcileUnknown: capture/void attempts, without asking the provider or leaving them open", () => {
  test("a payment already moved by a webhook settles the attempt from the ledger alone (no retrieve)", async () => {
    const w = await world();
    const done = await ambiguous(w, "void", "ik-1");
    const moved = await ambiguous(w, "capture", "ik-2");
    const { applyPaymentEvidence } = await import("../../accounting/apply-evidence.js");
    const apply = (paymentId: string, status: "canceled") => w.ledger.transaction({ fn: (tx) => applyPaymentEvidence({
      tx, deps: { now: () => NOW, newId: () => `ev_${paymentId}` }, workspaceId: "ws", mode: "test", paymentId, source: "webhook",
      evidence: { providerRef: `sp_${paymentId}`, status, refunds: [], disputes: [] },
    }) });
    await apply(done.id, "canceled");
    await apply(moved.id, "canceled");
    const retrieves = w.scripted.calls.filter((c) => c.op === "retrieve").length;
    expect((await w.operator.reconcileUnknown({ olderThanMs: 0, limit: 10 })).attempts).toEqual({ ...zero, scanned: 2, settled: 1, failed: 1 });
    expect(w.scripted.calls.filter((c) => c.op === "retrieve")).toHaveLength(retrieves);
    expect(await attemptOf(w, done.id, done.attemptId)).toMatchObject({ outcome: "ok" });
    expect(await attemptOf(w, moved.id, moved.attemptId)).toMatchObject({ outcome: "rejected", errorMessage: "reconciled: the provider reports the payment canceled" });
  });

  test("no snapshot, or a quarantined one: left open with an unknown-aged alert", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts });
    const a = await ambiguous(w, "void", "ik-1");
    const b = await ambiguous(w, "capture", "ik-2");
    w.scripted.queue("retrieve", timedOut(), { kind: "ok", value: { providerRef: `sp_${b.id}`, status: "succeeded", amount: USD(1), refunds: [], disputes: [] } });
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).attempts).toEqual({ ...zero, scanned: 2, left: 2 });
    expect(await attemptOf(w, a.id, a.attemptId)).toMatchObject({ outcome: "unknown" });
    expect(alerts.raised.filter((x) => x.kind === "unknown-aged").map((x) => x.detail)).toEqual([
      `void attempt ${a.attemptId} of payment ${a.id} is unknown: timed out`,
      `capture attempt ${b.attemptId} of payment ${b.id} is unknown: its snapshot was quarantined`,
    ]);
  });

  test("an attempt the original call closed meanwhile is not overwritten", async () => {
    let lateAnswer: string | null = null;
    // The late provider answer lands exactly when the reconciler re-reads the attempt to close it.
    const wrapLedger = (ledger: PaymentsLedger): PaymentsLedger => ({
      transaction: ({ fn }) => ledger.transaction({ fn: (tx) => fn(new Proxy(tx, {
        get: (target, name) => {
          const value = Reflect.get(target, name).bind(target);
          if (name !== "findAttemptByOperationKey" || lateAnswer === null) return value;
          const id = lateAnswer;
          lateAnswer = null;
          return async (args: never) => { await target.updateAttempt({ id, patch: { outcome: "ok", updatedAt: NOW } }); return value(args); };
        },
      }) as LedgerTx) }),
    });
    const w = await world({ wrapLedger });
    const { id, attemptId } = await ambiguous(w, "capture");
    w.scripted.queue("retrieve", { kind: "ok", value: { providerRef: `sp_${id}`, status: "authorized", refunds: [], disputes: [] } });
    lateAnswer = attemptId;
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).attempts).toEqual({ ...zero, scanned: 1, settled: 1 });
    // The late answer's `ok` stands (its earlier timeout code is history); no RECONCILED rejection over it.
    expect(await attemptOf(w, id, attemptId)).toMatchObject({ outcome: "ok", errorCode: "TRANSPORT_ERROR" });
  });
});

describe("reconcileUnknown: limited passes make progress past rows that never settle (cursor)", () => {
  test("payments, refunds and attempts: consecutive limit-1 passes visit every row, then start over", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts, scripted: { retrieve: "none" } });
    for (const id of ["p_1", "p_2", "p_3"]) await insertPayment(w, { id, providerId: "scripted", idempotencyKey: id, providerRef: `r_${id}` });
    const seen: string[][] = [];
    for (let pass = 0; pass < 5; pass += 1) {
      const before = alerts.raised.length;
      await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 1 });
      seen.push(alerts.raised.slice(before).map((a) => a.paymentId as string));
    }
    // Without a cursor every pass would re-scan p_1 forever. Past the last row the scan comes back
    // short (empty here), which resets the cursor: the fifth pass starts over.
    expect(seen).toEqual([["p_1"], ["p_2"], ["p_3"], [], ["p_1"]]);
  });

  test("the report carries the cursor; an explicit cursor resumes there; a short pass resets to the start", async () => {
    const w = await world({ scripted: { retrieve: "none" } });
    for (const id of ["p_1", "p_2"]) await insertPayment(w, { id, providerId: "scripted", idempotencyKey: id, providerRef: `r_${id}` });
    const first = await reconcileUnknown({ deps: w.deps, olderThanMs: AGE, limit: 1 });
    expect(first.cursor).toEqual({ payments: { updatedAt: NOW - AGE * 2, id: "p_1" }, refunds: null, attempts: null });
    const second = await reconcileUnknown({ deps: w.deps, olderThanMs: AGE, limit: 1 }, { cursor: first.cursor });
    expect(second.cursor.payments).toEqual({ updatedAt: NOW - AGE * 2, id: "p_2" });
    const third = await reconcileUnknown({ deps: w.deps, olderThanMs: AGE, limit: 1 }, { cursor: second.cursor });
    expect(third).toMatchObject({ payments: { scanned: 0 }, cursor: restart });
    // The operator port keeps a cursor per scope on its own; an explicit one overrides it.
    const scope = { workspaceId: "ws", mode: "test" as const };
    await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 1 }, { scope });
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 1 }, { scope })).cursor.payments?.id).toBe("p_2");
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 1 }, { scope, cursor: restart })).cursor.payments?.id).toBe("p_1");
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 1 })).cursor.payments?.id).toBe("p_1");
  });

  test("refunds and attempts advance too", async () => {
    const w = await world({ scripted: { retrieve: "none" } });
    const one = await ambiguous(w, "void", "ik-1");
    const two = await ambiguous(w, "void", "ik-2");
    const first = await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 1 });
    const second = await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 1 });
    expect([first.cursor.attempts?.id, second.cursor.attempts?.id]).toEqual([one.attemptId, two.attemptId]);
    const w2 = await world({ scripted: { capture: "auto", retrieve: "payment" } });
    await unknownRefund(w2, "payment");
    expect((await w2.operator.reconcileUnknown({ olderThanMs: AGE, limit: 1 })).cursor.refunds).toMatchObject({ id: expect.any(String) });
  });
});
