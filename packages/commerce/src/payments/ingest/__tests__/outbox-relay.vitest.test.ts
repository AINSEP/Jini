import { describe, expect, test } from "vitest";

import { reserveRefund } from "../../accounting/apply-evidence.js";
import type { NewOutbox } from "../../ledger/rows.js";
import { lipayFakeContext } from "../../testkit/lipay-fake.js";
import { createOutboxRelay, type OutboxPublisherPort, type PaymentsOutboxMessage } from "../outbox-relay.js";
import { createInboxWorker } from "../worker.js";
import { T0, USD, ingestWorld } from "./harness.js";

/**
 * @file The outbox relay (publish, then mark; a failure stops the batch) and the end-to-end proof
 * that signed provider webhooks, through receive → inbox worker → single writer, emit the topics
 * consumers depend on.
 */

function recordingPublisher(optional: { failOn?: (message: PaymentsOutboxMessage) => boolean } = {}): OutboxPublisherPort & { sent: PaymentsOutboxMessage[] } {
  const sent: PaymentsOutboxMessage[] = [];
  return {
    sent,
    publish: async ({ message }) => {
      if (optional.failOn?.(message)) throw new Error("bus down");
      sent.push(message);
    },
  };
}

const message = (id: string, overrides: Partial<NewOutbox> = {}): NewOutbox => ({
  id, workspaceId: "ws", mode: "test", topic: "payment.succeeded", aggregateId: "pay_1", payloadJson: JSON.stringify({ paymentId: "pay_1", n: id }), createdAt: T0, ...overrides,
});

describe("outbox relay", () => {
  test("publishes pending messages oldest first as parsed messages, then marks them published", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.tx(async (t) => {
      await t.enqueueOutbox({ message: message("m1") });
      await t.enqueueOutbox({ message: message("m2", { topic: "refund.succeeded", createdAt: T0 + 1 }) });
    });
    const publish = recordingPublisher();
    w.clock.now = T0 + 5;
    const relay = createOutboxRelay({ ledger: w.ledger, publish, now: w.now });
    expect(await relay.runOnce({ limit: 10 })).toEqual({ published: 2, stopped: false });
    expect(publish.sent).toEqual([
      { id: "m1", workspaceId: "ws", mode: "test", topic: "payment.succeeded", aggregateId: "pay_1", payload: { paymentId: "pay_1", n: "m1" }, createdAt: T0 },
      { id: "m2", workspaceId: "ws", mode: "test", topic: "refund.succeeded", aggregateId: "pay_1", payload: { paymentId: "pay_1", n: "m2" }, createdAt: T0 + 1 },
    ]);
    expect(await w.tx((t) => t.listPendingOutbox({ limit: 10 }))).toEqual([]);
    expect(await relay.runOnce({ limit: 10 })).toEqual({ published: 0, stopped: false });
  });

  test("a publish failure stops the batch and leaves it and everything after it pending, in order (at-least-once)", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.tx(async (t) => {
      for (const [i, id] of ["m1", "m2", "m3"].entries()) await t.enqueueOutbox({ message: message(id, { createdAt: T0 + i }) });
    });
    const failing = recordingPublisher({ failOn: (m) => m.id === "m2" });
    expect(await createOutboxRelay({ ledger: w.ledger, publish: failing, now: w.now }).runOnce({ limit: 10 })).toEqual({ published: 1, stopped: true });
    expect((await w.tx((t) => t.listPendingOutbox({ limit: 10 }))).map((m) => m.id)).toEqual(["m2", "m3"]);
    const healthy = recordingPublisher();
    expect(await createOutboxRelay({ ledger: w.ledger, publish: healthy, now: w.now }).runOnce({ limit: 10 })).toEqual({ published: 2, stopped: false });
    expect(healthy.sent.map((m) => m.id)).toEqual(["m2", "m3"]);
  });

  test("an unreadable payload stops the batch like a failed publish instead of crashing the relay", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.tx((t) => t.enqueueOutbox({ message: message("m1", { payloadJson: "{" }) }));
    const publish = recordingPublisher();
    expect(await createOutboxRelay({ ledger: w.ledger, publish, now: w.now }).runOnce({ limit: 10 })).toEqual({ published: 0, stopped: true });
    expect(publish.sent).toEqual([]);
  });

  test("runOnce honours its limit", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.tx(async (t) => {
      await t.enqueueOutbox({ message: message("m1") });
      await t.enqueueOutbox({ message: message("m2", { createdAt: T0 + 1 }) });
    });
    expect(await createOutboxRelay({ ledger: w.ledger, publish: recordingPublisher(), now: w.now }).runOnce({ limit: 1 })).toEqual({ published: 1, stopped: false });
  });
});

describe("end to end: signed webhooks → inbox → writer → outbox → relay", () => {
  test("payment.succeeded, refund.succeeded, refund.failed and dispute.opened all reach the bus, in order", async () => {
    const w = await ingestWorld();
    const ctx = lipayFakeContext({ now: w.now });
    const deps = { now: w.now, newId: w.newId };
    const worker = createInboxWorker({ ledger: w.ledger, providers: w.providers, contexts: w.contexts, now: w.now, newId: w.newId });
    const scope = { workspaceId: "ws", mode: "test" as const, paymentId: "pay_1" };
    /** Each step a second later, so "oldest first" is the order things happened in. */
    const step = async (type: "refund.updated" | "charge.succeeded", id: string, eventId: string) => {
      w.clock.now += 1_000;
      expect(await w.deliver(type, id, eventId)).toMatchObject({ status: 200, body: { received: 1 } });
      expect(await worker.runOnce({ limit: 10 })).toMatchObject({ applied: 1, parked: 0, dead: 0 });
    };

    await w.insertPayment();
    const ref = await w.charge();
    await step("charge.succeeded", ref, "evt_paid");

    /** Reserve (as the refund op does) and dispatch to the fake; returns the provider's refund id. */
    const refund = async (refundId: string, amountMinor: number) => {
      await w.tx((tx) => reserveRefund({ tx, deps, ...scope, refundId, amountMinor, idempotencyKey: `k_${refundId}` }));
      const sent = await w.fake.provider.refund!({ req: { providerRef: ref, amount: USD(amountMinor), idempotencyKey: `k_${refundId}`, correlationId: refundId }, ctx });
      if (sent.kind !== "ok") throw new Error("dispatch failed");
      return sent.value.providerRefundRef;
    };
    const ok = await refund("rf_ok", 3_000);
    w.fake.server.settleRefund({ refundId: ok, status: "succeeded" });
    await step("refund.updated", ok, "evt_rf_ok");

    // A refund that succeeded and then FAILED at the provider returns money consumers already counted: refund.failed.
    const reversed = await refund("rf_rev", 2_000);
    w.fake.server.settleRefund({ refundId: reversed, status: "succeeded" });
    await step("refund.updated", reversed, "evt_rf_rev_1");
    w.fake.server.settleRefund({ refundId: reversed, status: "failed" });
    await step("refund.updated", reversed, "evt_rf_rev_2");

    // The fake has no disputes; inject one into a verified charge event (the signature still checks).
    w.hooks.mutate = (fact) => ({ ...fact, evidence: { ...fact.evidence!, disputes: [{ providerDisputeRef: "dp_1", amount: USD(1_000), status: "open" }] } });
    await step("charge.succeeded", ref, "evt_dispute");

    const publish = recordingPublisher();
    const relay = createOutboxRelay({ ledger: w.ledger, publish, now: w.now });
    expect(await relay.runOnce({ limit: 100 })).toEqual({ published: 5, stopped: false });
    expect(publish.sent.map((m) => [m.topic, m.payload.refundId ?? m.payload.disputeId ?? null])).toEqual([
      ["payment.succeeded", null],
      ["refund.succeeded", "rf_ok"],
      ["refund.succeeded", "rf_rev"],
      ["refund.failed", "rf_rev"],
      ["dispute.opened", expect.any(String)],
    ]);
    expect(publish.sent.every((m) => m.aggregateId === "pay_1" && m.payload.paymentId === "pay_1")).toBe(true);
    expect(new Set(publish.sent.map((m) => m.id)).size).toBe(5);
    expect((await w.read()).payment).toMatchObject({ refundedMinor: 3_000, disputedMinor: 1_000, refundHeldMinor: 0 });
  });
});
