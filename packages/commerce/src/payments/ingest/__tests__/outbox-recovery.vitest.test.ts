import { describe, expect, test } from "vitest";
import { createOutboxRelay, type PaymentsOutboxMessage } from "../outbox-relay.js";
import { SCOPE, T0, ingestWorld, type LedgerKind } from "./harness.js";

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`outbox delivery recovery on ${kind}`, () => {
    test("a published message whose acknowledgement fails is replayed with its original id before later events", async () => {
      const w = await ingestWorld(kind);
      await w.insertPayment();
      await w.tx(async (tx) => {
        for (const [id, topic] of [["z_first", "payment.succeeded"], ["a_second", "refund.succeeded"]] as const) {
          await tx.enqueueOutbox({ message: {
            id, workspaceId: SCOPE.workspaceId, mode: SCOPE.mode, topic, aggregateId: "pay_1",
            payloadJson: JSON.stringify({ paymentId: "pay_1", amountMinor: 37, currency: "USD" }), createdAt: T0,
          } });
        }
      });
      const sent: PaymentsOutboxMessage[] = [];
      const publish = { publish: async ({ message }: { message: PaymentsOutboxMessage }) => { sent.push(message); } };
      // A fractional host timestamp makes the real ledger reject the acknowledgement write.
      // The bus has already accepted the first message, so its id must survive the retry.
      const invalidClock = createOutboxRelay({ ledger: w.ledger, publish, now: () => T0 + 0.5 });
      await expect(invalidClock.runOnce({ limit: 10 })).rejects.toThrow(TypeError);
      expect(sent).toEqual([{
        id: "z_first", workspaceId: "ws", mode: "test", topic: "payment.succeeded", aggregateId: "pay_1",
        payload: { paymentId: "pay_1", amountMinor: 37, currency: "USD" }, createdAt: T0,
      }]);
      expect((await w.tx((tx) => tx.listPendingOutbox({ limit: 10 }))).map((row) => [row.id, row.publishedAt]))
        .toEqual([["z_first", null], ["a_second", null]]);
      const healthy = createOutboxRelay({ ledger: w.ledger, publish, now: w.now });
      expect(await healthy.runOnce({ limit: 10 })).toEqual({ published: 2, stopped: false });
      expect(sent.map((message) => [message.id, message.topic])).toEqual([
        ["z_first", "payment.succeeded"], ["z_first", "payment.succeeded"], ["a_second", "refund.succeeded"],
      ]);
      expect(sent[1]).toEqual(sent[0]);
      expect(await w.tx((tx) => tx.listPendingOutbox({ limit: 10 }))).toEqual([]);
      expect(await healthy.runOnce({ limit: 10 })).toEqual({ published: 0, stopped: false });
      expect(sent).toHaveLength(3);
    });

    test("a message stays pending until its publisher has resolved", async () => {
      const w = await ingestWorld(kind);
      await w.insertPayment();
      await w.tx((tx) => tx.enqueueOutbox({ message: {
        id: "waiting", workspaceId: "ws", mode: "test", topic: "payment.succeeded", aggregateId: "pay_1",
        payloadJson: JSON.stringify({ paymentId: "pay_1", amountMinor: 10_000, currency: "USD" }), createdAt: T0,
      } }));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let announce!: () => void;
      const started = new Promise<void>((resolve) => { announce = resolve; });
      const delivered: PaymentsOutboxMessage[] = [];
      const relay = createOutboxRelay({ ledger: w.ledger, now: w.now, publish: {
        publish: async ({ message }) => {
          announce();
          await gate;
          delivered.push(message);
        },
      } });
      const run = relay.runOnce({ limit: 1 });
      await started;
      try {
        expect(delivered).toEqual([]);
        expect((await w.tx((tx) => tx.listPendingOutbox({ limit: 10 }))).map((row) => [row.id, row.publishedAt]))
          .toEqual([["waiting", null]]);
      } finally {
        release();
      }
      expect(await run).toEqual({ published: 1, stopped: false });
      expect(delivered).toEqual([{
        id: "waiting", workspaceId: "ws", mode: "test", topic: "payment.succeeded", aggregateId: "pay_1",
        payload: { paymentId: "pay_1", amountMinor: 10_000, currency: "USD" }, createdAt: T0,
      }]);
      expect(await w.tx((tx) => tx.listPendingOutbox({ limit: 10 }))).toEqual([]);
    });
  });
}
