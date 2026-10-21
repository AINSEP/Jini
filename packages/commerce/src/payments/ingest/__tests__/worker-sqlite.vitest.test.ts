import { describe, expect, test } from "vitest";

import { applyPaymentEvidence } from "../../accounting/apply-evidence.js";
import type { WebhookFact } from "../../contract/evidence.js";
import { createInboxWorker } from "../worker.js";
import { USD, ingestWorld } from "./harness.js";

/**
 * @file The inbox worker on the SQL adapter (better-sqlite3, in memory): the happy path, and the
 * `LedgerConstraintError` path — the failed apply really rolls back in the database, and the
 * dead-letter + quarantine land in a SEPARATE transaction (on Postgres the first one is poisoned).
 */

describe("inbox worker on SQLite", () => {
  test("a signed charge webhook is received, applied and purged", async () => {
    const w = await ingestWorld("sqlite");
    await w.insertPayment();
    await w.charge();
    await w.deliver("charge.succeeded", "ch_1", "evt_1");
    const [due] = await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 1 }));
    const worker = createInboxWorker({ ledger: w.ledger, providers: w.providers, contexts: w.contexts, now: w.now, newId: w.newId }, { alerts: w.alerts });
    expect(await worker.runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 1, parked: 0, dead: 0, quarantined: 0 });
    const { payment, outbox, evidence } = await w.read();
    expect(payment).toMatchObject({ status: "succeeded", providerRef: "ch_1" });
    expect(outbox.map((m) => m.topic)).toEqual(["payment.succeeded"]);
    expect(evidence.map((e) => e.inboxId)).toEqual([due!.id]);
    expect(await w.inbox(due!.id)).toMatchObject({ state: "applied", factsJson: null });
  });

  test("a refund ref held by another payment: the apply rolls back, the dead letter + quarantine commit in a new transaction", async () => {
    const w = await ingestWorld("sqlite");
    await w.insertPayment({ id: "pay_1", idempotencyKey: "k1" });
    await w.insertPayment({ id: "pay_2", idempotencyKey: "k2" });
    await w.charge("pay_1");
    await w.charge("pay_2");
    const deps = { now: w.now, newId: w.newId };
    await w.tx((tx) => applyPaymentEvidence({
      tx, deps, workspaceId: "ws", mode: "test", paymentId: "pay_1", source: "response",
      evidence: { providerRef: "ch_1", status: "succeeded", amount: USD(10_000), refunds: [{ providerRefundRef: "re_x", amount: USD(1_000), status: "succeeded" }], disputes: [] },
    }));
    const before = await w.read("pay_2");
    const stolen: WebhookFact = {
      providerEventId: "evt_steal", providerRef: "ch_2",
      evidence: { providerRef: "ch_2", correlationId: "pay_2", status: "succeeded", amount: USD(10_000), refunds: [{ providerRefundRef: "re_x", amount: USD(1_000), status: "succeeded" }], disputes: [] },
    };
    const { id } = await w.insertInbox({ providerEventId: "evt_steal", fact: stolen });
    const worker = createInboxWorker({ ledger: w.ledger, providers: w.providers, contexts: w.contexts, now: w.now, newId: w.newId }, { alerts: w.alerts });

    expect(await worker.runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 0, parked: 0, dead: 1, quarantined: 1 });

    const after = await w.read("pay_2");
    expect(after.payment).toEqual(before.payment);
    expect(after.evidence).toEqual([]);
    expect(after.refunds).toEqual([]);
    expect(await w.inbox(id)).toMatchObject({ state: "dead", factsJson: null, lastError: "ledger: unique constraint violated on commerce_refunds" });
    expect(after.quarantine).toEqual([expect.objectContaining({ reason: "ref-conflict", paymentId: "pay_2" })]);
    expect(w.alerts.raised.map((a) => [a.kind, a.paymentId])).toEqual([["inbox-dead-letter", "pay_2"]]);
  });
});
