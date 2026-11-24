import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainEvent } from "@jini-ai/core/contracts/events";
import { InMemoryEventBus, InMemoryOutbox } from "../memory-bus.js";
import { processDomainOutbox, toEnqueueOnlyDomainOutbox } from "../domain-outbox.js";


/**
 * @file `toEnqueueOnlyDomainOutbox`: the outbox view for a process that must write events but never
 * deliver them (the agent daemon, 2026-09-14).
 */

const clock = { nowMs: () => Date.now() };
const scheduler = { schedule: () => ({ cancel: () => {} }) };
const logger = { error: () => {} };

function makeEvent(id: string): DomainEvent {
  return { id, name: "entry.updated", occurredAt: "2026-01-01T00:00:00.000Z", workspaceId: "ws-enqueue-only", payload: {} };
}

test("enqueue passes through to the real outbox", async () => {
  const inner = new InMemoryOutbox();
  const view = toEnqueueOnlyDomainOutbox({ outbox: inner });

  await view.enqueue(makeEvent("through-1"));

  const claimed = await inner.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" });
  assert.deepEqual(claimed.map((row) => row.id), ["through-1"]);
});

test("a drain through the view claims and publishes nothing, leaving the row pending for the real owner", async () => {
  const inner = new InMemoryOutbox();
  const view = toEnqueueOnlyDomainOutbox({ outbox: inner });
  const bus = new InMemoryEventBus();
  const received: string[] = [];
  await bus.subscribe({ eventName: "entry.updated", handler: async (event) => {
    received.push(event.id);
  } });
  await view.enqueue(makeEvent("owned-elsewhere-1"));

  assert.equal(await processDomainOutbox({ outbox: view, bus, clock, scheduler, logger }), 0);
  assert.deepEqual(received, []);

  assert.equal(await processDomainOutbox({ outbox: inner, bus, clock, scheduler, logger }), 1, "the owning process must still find the row pending");
  assert.deepEqual(received, ["owned-elsewhere-1"]);
});

test("markDelivered and markFailed reject, naming the row, because this view never hands out a claim", async () => {
  const view = toEnqueueOnlyDomainOutbox({ outbox: new InMemoryOutbox() });

  await assert.rejects(view.markDelivered({ id: "row-1" }), {
    message: "enqueue-only outbox: markDelivered('row-1') was called, but this process never claims outbox rows",
  });
  await assert.rejects(view.markFailed({ id: "row-2", error: "boom", nextAttemptAt: "2026-01-01T00:00:00.000Z", nextStatus: "pending" }), {
    message: "enqueue-only outbox: markFailed('row-2') was called, but this process never claims outbox rows",
  });
});
