import { describe, expect, test } from "vitest";
import type { WebhookFact } from "../../contract/evidence.js";
import type { PaymentsLedger } from "../../ledger/repo.js";
import { createInboxWorker } from "../worker.js";
import { SCOPE, T0, USD, ingestWorld, type LedgerKind } from "./harness.js";

const fact: WebhookFact = {
  providerEventId: "evt_1", providerRef: "ch_1",
  evidence: { providerRef: "ch_1", correlationId: "pay_1", status: "succeeded", amount: USD(10_000), refunds: [], disputes: [] },
};

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`inbox scope and recovery on ${kind}`, () => {
    test("an account shared by two sites applies to the payment's site and preserves its scope", async () => {
      const w = await ingestWorld(kind);
      await w.insertPayment({ siteId: "checkout_site" });
      const inserted = await w.insertInbox({ siteId: "webhook_site", providerEventId: fact.providerEventId, fact });
      const worker = createInboxWorker(w, { alerts: w.alerts });
      expect(await worker.runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 1, parked: 0, dead: 0, quarantined: 0 });
      const after = await w.read();
      expect(after.payment).toMatchObject({ siteId: "checkout_site", currency: "USD", capturedMinor: 10_000, status: "succeeded", providerRef: "ch_1" });
      expect(after.evidence).toEqual([expect.objectContaining({ siteId: "checkout_site", inboxId: inserted.id, source: "webhook", amountMinor: 10_000, currency: "USD" })]);
      expect(after.outbox.map((row) => [row.topic, JSON.parse(row.payloadJson)]))
        .toEqual([["payment.succeeded", { paymentId: "pay_1", reference: "order-1", amountMinor: 10_000, currency: "USD" }]]);
      expect(await w.inbox(inserted.id)).toMatchObject({ siteId: "webhook_site", state: "applied", factsJson: null });
      expect(w.alerts.raised).toEqual([]);
    });

    test.each([
      { workspaceId: "foreign", mode: "test" as const },
      { workspaceId: "ws", mode: "live" as const },
    ])("an inbox in $workspaceId/$mode cannot locate a payment by ref or correlation in another scope", async (scope) => {
      const w = await ingestWorld(kind);
      await w.insertPayment({ providerRef: "ch_1" });
      const before = await w.read();
      const inserted = await w.insertInbox({ ...scope, providerEventId: fact.providerEventId, fact });
      expect(await createInboxWorker(w).runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 0, parked: 1, dead: 0, quarantined: 0 });
      expect(await w.read()).toEqual(before);
      expect(await w.inbox(inserted.id)).toMatchObject({ state: "parked", attempts: 1, lastError: "payment not found yet", factsJson: JSON.stringify(fact), nextAttemptAt: T0 + 30_000 });
    });

    test.each([
      { providerId: "another-provider" },
      { providerAccountId: "another-account" },
    ])("a correlation id cannot cross provider ownership: %j", async (paymentScope) => {
      const w = await ingestWorld(kind);
      await w.insertPayment(paymentScope);
      const before = await w.read();
      const inserted = await w.insertInbox({ providerEventId: fact.providerEventId, fact });
      expect(await createInboxWorker(w, { alerts: w.alerts }).runOnce({ limit: 10 }))
        .toEqual({ seen: 1, applied: 0, parked: 0, dead: 1, quarantined: 1 });
      const after = await w.read();
      expect(after.payment).toEqual(before.payment);
      expect(after.evidence).toEqual([]);
      expect(after.outbox).toEqual([]);
      expect(after.quarantine).toEqual([expect.objectContaining({ workspaceId: "ws", mode: "test", paymentId: null, reason: "scope-mismatch", evidenceJson: JSON.stringify(fact.evidence) })]);
      expect(await w.inbox(inserted.id)).toMatchObject({ state: "dead", factsJson: JSON.stringify(fact) });
      expect(w.alerts.raised.map((alert) => [alert.kind, alert.paymentId])).toEqual([["inbox-dead-letter", null]]);
    });

    test.each([
      ["an acknowledgement write failure", "markInboxApplied", "apply threw RangeError"],
      ["a payment vanishing before its locked read", "lockPayment", "payment vanished under its lock"],
    ] as const)("%s preserves the money and retries the kept fact exactly once", async (_label, failedMethod, lastError) => {
      const w = await ingestWorld(kind);
      await w.insertPayment();
      const inserted = await w.insertInbox({ providerEventId: fact.providerEventId, fact });
      const before = await w.read();
      // Inject a failed acknowledgement or a lookup that vanished before acquiring its lock.
      // All other ledger operations, including rollback, use the real adapter.
      const ledger: PaymentsLedger = {
        transaction: ({ fn }) => w.ledger.transaction({ fn: (tx) => fn(new Proxy(tx, {
          get(target, key) {
            if (key === failedMethod) return async () => {
              if (failedMethod === "lockPayment") return null;
              throw new RangeError("database acknowledgement failed");
            };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        })) }),
      };
      expect(await createInboxWorker({ ...w, ledger }).runOnce({ limit: 10 }))
        .toEqual({ seen: 1, applied: 0, parked: 1, dead: 0, quarantined: 0 });
      expect(await w.read()).toEqual(before);
      expect(await w.inbox(inserted.id)).toMatchObject({ state: "parked", factsJson: JSON.stringify(fact), lastError, nextAttemptAt: T0 + 30_000 });
      w.clock.now += 30_000;
      const worker = createInboxWorker(w);
      expect(await worker.runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 1, parked: 0, dead: 0, quarantined: 0 });
      expect(await worker.runOnce({ limit: 10 })).toEqual({ seen: 0, applied: 0, parked: 0, dead: 0, quarantined: 0 });
      const after = await w.read();
      expect(after.payment).toMatchObject({ currency: "USD", capturedMinor: 10_000, status: "succeeded" });
      expect(after.evidence).toEqual([expect.objectContaining({ source: "webhook", inboxId: inserted.id, amountMinor: 10_000, currency: "USD" })]);
      expect(after.outbox.map((row) => row.topic)).toEqual(["payment.succeeded"]);
      expect(await w.inbox(inserted.id)).toMatchObject({ state: "applied", factsJson: null });
    });
  });
}

describe("id-only event context failures", () => {
  test.each([
    [new TypeError("credential secret"), "retrieve threw TypeError"],
    [null, "retrieve threw a non-error"],
  ])("a context exception %j parks the fact and keeps provider text out of the error", async (error, lastError) => {
    const w = await ingestWorld();
    const inserted = await w.insertInbox({ providerEventId: "evt_ids", fact: { providerEventId: "evt_ids", providerRef: "ch_1" } });
    const worker = createInboxWorker({ ...w, contexts: { resolve: async () => { throw error; } } });
    expect(await worker.runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 0, parked: 1, dead: 0, quarantined: 0 });
    expect(await w.inbox(inserted.id)).toMatchObject({ ...SCOPE, state: "parked", attempts: 1, lastError, nextAttemptAt: T0 + 30_000 });
  });
});
