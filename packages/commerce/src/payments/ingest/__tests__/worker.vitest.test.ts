import { describe, expect, test } from "vitest";

import { applyPaymentEvidence, applyRefundEvidence, reserveRefund } from "../../accounting/apply-evidence.js";
import type { PaymentEvidence, WebhookFact } from "../../contract/evidence.js";
import { paymentError, type PaymentProvider } from "../../contract/provider.js";
import { LedgerConstraintError, type LedgerTx, type PaymentsLedger } from "../../ledger/repo.js";
import { createKernelProviderRegistry } from "../../provider-registry.js";
import { lipayFakeContext } from "../../testkit/lipay-fake.js";
import { createInboxWorker, type InboxWorkerOptions } from "../worker.js";
import { T0, USD, ingestWorld } from "./harness.js";

/**
 * @file The inbox worker: locate → apply in one transaction with the row's state change → park,
 * dead-letter or quarantine. Memory ledger + the LiPay fake's signed webhooks through the real receiver.
 */

type World = Awaited<ReturnType<typeof ingestWorld>>;

function workerOf(w: World, optional: InboxWorkerOptions & { ledger?: PaymentsLedger; provider?: PaymentProvider | null } = {}) {
  const { ledger, provider, ...options } = optional;
  const providers = provider === undefined ? w.providers
    : createKernelProviderRegistry({ items: provider ? [{ pluginId: "lipay-fake", module: provider }] : [] });
  return createInboxWorker({ ledger: ledger ?? w.ledger, providers, contexts: w.contexts, now: w.now, newId: w.newId }, { alerts: w.alerts, ...options });
}

const counts = (c: Partial<Record<"seen" | "applied" | "parked" | "dead" | "quarantined", number>>) =>
  ({ seen: 0, applied: 0, parked: 0, dead: 0, quarantined: 0, ...c });

async function evidenceInboxIds(w: World) {
  const ids = await w.tx(async (t) => (await t.listEvidence({ paymentId: "pay_1" })).map((e) => e.inboxId));
  return ids;
}

/** A ledger whose transactions hand out a tx whose `lockPayment` throws `thrown`. */
function lockThrows(ledger: PaymentsLedger, thrown: () => unknown): PaymentsLedger {
  return {
    transaction: (fn) => ledger.transaction((tx) => fn(new Proxy(tx, {
      get(target, key) {
        if (key === "lockPayment") return async () => { throw thrown(); };
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as LedgerTx)),
  };
}

const lastError = async (w: World) => (await w.tx((t) => t.listDueInbox({ now: Number.MAX_SAFE_INTEGER, limit: 10 })))[0]?.lastError;

describe("inbox worker: apply", () => {
  test("a recorded charge webhook applies through the single writer, purges the fact in the same commit and emits payment.succeeded", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    const [due] = await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 1 }));

    expect(await workerOf(w).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, applied: 1 }));

    const { payment, evidence, outbox } = await w.read();
    expect(payment).toMatchObject({ intentStatus: "succeeded", status: "succeeded", providerRef: "ch_1", capturedMinor: 10_000 });
    expect(evidence.map((e) => [e.source, e.inboxId])).toEqual([["webhook", due!.id]]);
    expect(outbox.map((m) => m.topic)).toEqual(["payment.succeeded"]);
    expect(await w.inbox(due!.id)).toMatchObject({ state: "applied", factsJson: null, appliedAt: T0, purgedAt: T0, bodySha256: due!.bodySha256 });
    expect(await workerOf(w).runOnce({ limit: 10 })).toEqual(counts({}));
    expect(w.alerts.raised).toEqual([]);
  });

  test("money withdrawn beyond captured raises over-withdrawn through the worker's alert sink; the evidence still applies", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    await workerOf(w).runOnce({ limit: 10 });
    const deps = { now: w.now, newId: w.newId };
    const target = { deps, workspaceId: "ws", mode: "test" as const, paymentId: "pay_1" };
    await w.tx((tx) => reserveRefund({ tx, ...target, refundId: "rf_1", amountMinor: 10_000, idempotencyKey: "rk" }));
    await w.tx((tx) => applyRefundEvidence({ tx, ...target, source: "response", evidence: { providerRefundRef: "re_x", correlationId: "rf_1", amount: USD(10_000), status: "succeeded" } }));
    // A dispute row the caches do not count yet: the next apply re-derives them and crosses the line.
    await w.tx((tx) => tx.insertDispute({ dispute: {
      id: "dp_row", paymentId: "pay_1", workspaceId: "ws", siteId: "site", providerId: "lipay", providerAccountId: "acct_fake", mode: "test",
      providerDisputeRef: "dp_1", currency: "USD", amountMinor: 10_000, status: "open", dueBy: null, createdAt: T0, updatedAt: T0,
    } }));
    await w.deliver("charge.succeeded", "ch_1", "evt_2");
    expect(await workerOf(w).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, applied: 1 }));
    expect(w.alerts.raised).toEqual([expect.objectContaining({ kind: "over-withdrawn", paymentId: "pay_1" })]);
    expect((await w.read()).payment).toMatchObject({ refundedMinor: 10_000, disputedMinor: 10_000 });
  });

  test("a webhook that beats our own insert is parked with backoff, then applied once the payment exists (matched by correlation id)", async () => {
    const w = await ingestWorld();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    const worker = workerOf(w);
    expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, parked: 1 }));
    const [parked] = await w.tx((t) => t.listDueInbox({ now: T0 + 30_000, limit: 1 }));
    expect(parked).toMatchObject({ state: "parked", attempts: 1, lastError: "payment not found yet", nextAttemptAt: T0 + 30_000 });
    expect(await worker.runOnce({ limit: 10 })).toEqual(counts({}));

    await w.insertPayment();
    w.clock.now = T0 + 30_000;
    expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, applied: 1 }));
    expect((await w.read()).payment.status).toBe("succeeded");
  });

  test("without an echoed correlation id the payment is found by its provider ref; with neither it waits", async () => {
    const w = await ingestWorld("memory", { echoesCorrelation: false });
    await w.insertPayment({ id: "pay_1", providerRef: "ch_1" });
    await w.charge("pay_1");
    await w.charge("pay_2");
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    await w.deliver("charge.succeeded", "ch_2", "evt_2");
    expect(await workerOf(w).runOnce({ limit: 10 })).toEqual(counts({ seen: 2, applied: 1, parked: 1 }));
    expect((await w.read()).payment.status).toBe("succeeded");
    expect(await lastError(w)).toBe("payment not found yet");
  });

  test("an id-only event is applied from a `retrieve` snapshot, recorded as source retrieve", async () => {
    const w = await ingestWorld();
    w.hooks.mutate = ({ evidence: _dropped, ...idsOnly }: WebhookFact) => idsOnly;
    await w.insertPayment();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    expect(await workerOf(w).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, applied: 1 }));
    const { payment, evidence } = await w.read();
    expect(payment.status).toBe("succeeded");
    expect(evidence.map((e) => e.source)).toEqual(["retrieve"]);
  });

  test("an unmatched refund (deferred) parks the whole observation; once our refund response binds the ref it applies", async () => {
    const w = await ingestWorld("memory", { echoesCorrelation: false });
    await w.insertPayment();
    const ref = await w.charge();
    const deps = { now: w.now, newId: w.newId };
    const scope = { workspaceId: "ws", mode: "test" as const, paymentId: "pay_1" };
    const charged: PaymentEvidence = { providerRef: ref, status: "succeeded", amount: USD(10_000), refunds: [], disputes: [] };
    await w.tx((tx) => applyPaymentEvidence({ tx, deps, ...scope, source: "response", evidence: charged }));
    await w.tx((tx) => reserveRefund({ tx, deps, ...scope, refundId: "rf_1", amountMinor: 3_000, idempotencyKey: "k_rf_1" }));
    const dispatched = await w.fake.provider.refund!({ req: { providerRef: ref, amount: USD(3_000), idempotencyKey: "k_rf_1", correlationId: "rf_1" }, ctx: lipayFakeContext({ now: w.now }) });
    if (dispatched.kind !== "ok") throw new Error("refund dispatch failed");
    await w.deliver("refund.updated", dispatched.value.providerRefundRef, "evt_r");

    const worker = workerOf(w);
    expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, parked: 1 }));
    expect(await lastError(w)).toBe("refund evidence deferred (not matchable yet)");

    await w.tx((tx) => applyRefundEvidence({ tx, deps, ...scope, source: "response", evidence: dispatched.value }, { refundId: "rf_1" }));
    w.clock.now = T0 + 30_000;
    expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, applied: 1 }));
    expect((await w.read()).refunds.map((r) => [r.id, r.providerRefundRef])).toEqual([["rf_1", dispatched.value.providerRefundRef]]);
  });
});

describe("inbox worker: quarantine", () => {
  test("an intent the writer quarantines (amount mismatch) finishes the row and raises a quarantine alert", async () => {
    const w = await ingestWorld();
    await w.insertPayment({ amountMinor: 5_000 });
    await w.charge("pay_1", { amountMinor: 10_000 });
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    expect(await workerOf(w).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, applied: 1, quarantined: 1 }));
    const { payment, quarantine } = await w.read();
    expect(payment.intentStatus).toBe("unknown");
    expect(quarantine).toHaveLength(1);
    expect(w.alerts.raised).toEqual([expect.objectContaining({ kind: "quarantine", workspaceId: "ws", mode: "test", paymentId: "pay_1" })]);
    expect(w.alerts.raised[0]!.detail).toContain(`evidence quarantined: ${quarantine[0]!.reason}`);
  });

  test("an applied observation with a quarantined refund still finishes the row, counted and alerted", async () => {
    const w = await ingestWorld();
    w.hooks.mutate = (fact) => ({ ...fact, evidence: { ...fact.evidence!, refunds: [{ providerRefundRef: "re_big", amount: USD(50_000), status: "succeeded" }] } });
    await w.insertPayment();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    expect(await workerOf(w).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, applied: 1, quarantined: 1 }));
    const { payment, quarantine } = await w.read();
    expect(payment.status).toBe("succeeded");
    expect(quarantine.map((q) => q.subject)).toEqual(["refund"]);
    expect(w.alerts.raised.map((a) => a.kind)).toEqual(["quarantine"]);
  });

  test("a correlation id naming a payment at ANOTHER provider account is dead-lettered and quarantined, never applied", async () => {
    const w = await ingestWorld();
    await w.insertPayment({ providerAccountId: "acct_other" });
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    expect(await workerOf(w).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, dead: 1, quarantined: 1 }));
    const { payment, quarantine } = await w.read();
    expect(payment.intentStatus).toBe("unknown");
    expect(quarantine).toEqual([expect.objectContaining({ reason: "scope-mismatch", paymentId: null, subject: "payment" })]);
    expect(JSON.parse(quarantine[0]!.evidenceJson)).toMatchObject({ providerRef: "ch_1", correlationId: "pay_1" });
    expect(w.alerts.raised).toEqual([expect.objectContaining({ kind: "inbox-dead-letter", paymentId: null })]);
  });

  test("a provider ref held by ANOTHER payment (LedgerConstraintError) rolls the apply back, then dead-letters + quarantines in a new transaction", async () => {
    const w = await ingestWorld();
    await w.insertPayment({ id: "pay_1", idempotencyKey: "k1" });
    await w.insertPayment({ id: "pay_2", idempotencyKey: "k2" });
    await w.charge("pay_1");
    await w.charge("pay_2");
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    await w.deliver("charge.succeeded", "ch_2", "evt_2");
    const worker = workerOf(w);
    await worker.runOnce({ limit: 10 });
    const deps = { now: w.now, newId: w.newId };
    await w.tx((tx) => applyPaymentEvidence({
      tx, deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", source: "response",
      evidence: { providerRef: "ch_1", status: "succeeded", amount: USD(10_000), refunds: [{ providerRefundRef: "re_x", amount: USD(1_000), status: "succeeded" }], disputes: [] },
    }));
    const before = await w.read("pay_2");
    const stolen: WebhookFact = {
      providerEventId: "evt_steal", providerRef: "ch_2",
      evidence: { providerRef: "ch_2", status: "succeeded", amount: USD(10_000), refunds: [{ providerRefundRef: "re_x", amount: USD(1_000), status: "succeeded" }], disputes: [] },
    };
    const { id } = await w.insertInbox({ providerEventId: "evt_steal", fact: stolen });

    expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, dead: 1, quarantined: 1 }));

    const after = await w.read("pay_2");
    expect(after.payment.version).toBe(before.payment.version);
    expect(after.evidence).toEqual(before.evidence);
    expect(after.refunds).toEqual([]);
    expect(await w.inbox(id)).toMatchObject({ state: "dead", factsJson: null, lastError: "ledger: unique constraint violated on commerce_refunds" });
    expect(after.quarantine).toEqual([expect.objectContaining({ reason: "ref-conflict", paymentId: "pay_2", subject: "payment" })]);
    expect(JSON.parse(after.quarantine[0]!.evidenceJson)).toEqual(stolen.evidence);
    expect(w.alerts.raised).toEqual([expect.objectContaining({ kind: "inbox-dead-letter", paymentId: "pay_2" })]);
  });

  test("a non-unique LedgerConstraintError is dead-lettered with its kind as the quarantine reason", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    const ledger = lockThrows(w.ledger, () => new LedgerConstraintError({ kind: "check", table: "commerce_payments" }));
    expect(await workerOf(w, { ledger }).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, dead: 1, quarantined: 1 }));
    expect((await w.read()).quarantine.map((q) => [q.reason, q.paymentId])).toEqual([["constraint-check", "pay_1"]]);
  });
});

describe("inbox worker: retry and dead letter", () => {
  test("after maxAttempts the row is dead-lettered with an alert; the fact is purged", async () => {
    const w = await ingestWorld();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    const [row] = await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 1 }));
    const worker = workerOf(w, { maxAttempts: 2, backoff: (attempt) => attempt * 1_000 });
    expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, parked: 1 }));
    expect(await w.inbox(row!.id)).toMatchObject({ nextAttemptAt: T0 + 1_000 });
    w.clock.now = T0 + 1_000;
    expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, dead: 1 }));
    expect(await w.inbox(row!.id)).toMatchObject({ state: "dead", factsJson: null, purgedAt: T0 + 1_000, lastError: "payment not found yet (gave up after 2 attempts)" });
    expect(w.alerts.raised).toEqual([{
      kind: "inbox-dead-letter", workspaceId: "ws", mode: "test", paymentId: null,
      detail: `inbox ${row!.id} (lipay event evt_1): payment not found yet (gave up after 2 attempts)`,
    }]);
  });

  test("defaults: 30 s doubling backoff, 8 attempts, alerts dropped", async () => {
    const w = await ingestWorld();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    const worker = createInboxWorker({ ledger: w.ledger, providers: w.providers, contexts: w.contexts, now: w.now, newId: w.newId });
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, parked: 1 }));
      const [row] = await w.tx((t) => t.listDueInbox({ now: Number.MAX_SAFE_INTEGER, limit: 1 }));
      delays.push(row!.nextAttemptAt - w.clock.now);
      w.clock.now = row!.nextAttemptAt;
    }
    expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000]);
    expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, dead: 1 }));
    expect(w.alerts.raised).toEqual([]);
  });

  test("the default backoff is capped at one hour", async () => {
    const w = await ingestWorld();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    const [row] = await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 1 }));
    await w.tx((t) => t.parkInbox({ id: row!.id, error: "seeded", nextAttemptAt: T0 }));
    for (let i = 0; i < 10; i += 1) await w.tx((t) => t.parkInbox({ id: row!.id, error: "seeded", nextAttemptAt: T0 }));
    await createInboxWorker({ ledger: w.ledger, providers: w.providers, contexts: w.contexts, now: w.now, newId: w.newId }, { maxAttempts: 100 }).runOnce({ limit: 1 });
    expect(await w.inbox(row!.id)).toMatchObject({ attempts: 12, nextAttemptAt: T0 + 3_600_000 });
  });

  test("a provider no longer registered parks the row", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    expect(await workerOf(w, { provider: null }).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, parked: 1 }));
    expect(await lastError(w)).toBe("provider 'lipay' is not registered");
  });

  describe("id-only events that cannot be retrieved now are parked", () => {
    const idOnly = async (setup: (w: World) => InboxWorkerOptions & { provider?: PaymentProvider | null; contextsFail?: boolean }) => {
      const w = await ingestWorld();
      await w.insertPayment();
      await w.insertInbox({ providerEventId: "evt_ids", fact: { providerEventId: "evt_ids", providerRef: "ch_1" } });
      const { contextsFail, ...options } = setup(w);
      const contexts = contextsFail
        ? { resolve: async () => ({ ok: false as const, error: paymentError({ code: "NO_CREDENTIALS_CONFIGURED", message: "empty" }) }) }
        : w.contexts;
      const worker = workerOf({ ...w, contexts }, options);
      expect(await worker.runOnce({ limit: 10 })).toEqual(counts({ seen: 1, parked: 1 }));
      return lastError(w);
    };

    test("the provider cannot retrieve", async () => {
      expect(await idOnly((w) => {
        const { retrieve: _none, ...noRetrieve } = w.provider;
        return { provider: { ...noRetrieve, capabilities: { ...w.provider.capabilities, retrieve: "none" } } };
      })).toBe("id-only event and provider 'lipay' cannot retrieve");
    });

    test("the provider context cannot be resolved (only the error code is kept)", async () => {
      expect(await idOnly(() => ({ contextsFail: true }))).toBe("provider context unavailable: NO_CREDENTIALS_CONFIGURED");
    });

    test("the provider answers rejected or unknown", async () => {
      expect(await idOnly(() => ({}))).toBe("retrieve rejected: DECLINED");
      expect(await idOnly((w) => ({
        provider: { ...w.provider, retrieve: async () => ({ kind: "unknown", error: paymentError({ code: "TRANSPORT_ERROR", message: "t/o" }) }) },
      }))).toBe("retrieve unknown: TRANSPORT_ERROR");
    });

    test("a provider that throws (against its contract) is recorded by error name only", async () => {
      expect(await idOnly((w) => ({ provider: { ...w.provider, retrieve: async () => { throw new TypeError("sk_live_secret in message"); } } })))
        .toBe("retrieve threw TypeError");
      expect(await idOnly((w) => ({ provider: { ...w.provider, retrieve: async () => { throw "sk_live_secret"; } } })))
        .toBe("retrieve threw a non-error");
    });
  });

  test.each([
    ["no payload", null],
    ["unparseable JSON", "{"],
    ["a fact without a provider ref", JSON.stringify({ providerEventId: "evt_x" })],
  ])("a row with %s can never apply: dead-lettered at once", async (_label, factsJson) => {
    const w = await ingestWorld();
    const { id } = await w.insertInbox({ factsJson });
    expect(await workerOf(w).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, dead: 1 }));
    expect(await w.inbox(id)).toMatchObject({ state: "dead", lastError: "inbox row has no readable fact" });
    expect(w.alerts.raised.map((a) => a.kind)).toEqual(["inbox-dead-letter"]);
  });

  test.each([
    ["an Error", () => new RangeError("boom"), "apply threw RangeError"],
    ["a non-error", () => "boom", "apply threw a non-error"],
  ])("any other throw out of the apply (%s) parks the row: it is never lost", async (_label, thrown, error) => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    expect(await workerOf(w, { ledger: lockThrows(w.ledger, thrown) }).runOnce({ limit: 10 })).toEqual(counts({ seen: 1, parked: 1 }));
    expect(await lastError(w)).toBe(error);
    expect((await w.read()).evidence).toEqual([]);
    expect(await evidenceInboxIds(w)).toEqual([]);
  });

  test("a failing alert port never stops the worker", async () => {
    const w = await ingestWorld();
    await w.insertInbox({ factsJson: null });
    await w.insertInbox({ factsJson: null });
    const alerts = { raise: async () => { throw new Error("pager down"); } };
    expect(await workerOf(w, { alerts }).runOnce({ limit: 10 })).toEqual(counts({ seen: 2, dead: 2 }));
  });

  test("runOnce honours its limit", async () => {
    const w = await ingestWorld();
    await w.insertInbox({ factsJson: null });
    await w.insertInbox({ factsJson: null });
    expect(await workerOf(w).runOnce({ limit: 1 })).toEqual(counts({ seen: 1, dead: 1 }));
  });
});
