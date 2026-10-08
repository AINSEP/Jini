import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryEventBus } from "./eventing.fixture.js";

// PARITY
test("catch-all subscribers receive record events in batch order until unsubscribed", async () => {
  const bus = new InMemoryEventBus();
  const received: string[] = [];
  const unsubscribe = await bus.subscribeAll({ handler: async (event) => { received.push(event.id); } });
  const event = { id: "first", name: "fixture.event", occurredAt: "2026-10-02T00:00:00.000Z", workspaceId: "workspace", payload: { value: 1 } };
  await bus.publishBatch({ events: [event, { ...event, id: "second" }] });
  assert.deepEqual(received, ["first", "second"]);
  await unsubscribe();
  await bus.publish(event);
  assert.deepEqual(received, ["first", "second"]);
});

// REGRESSION: fails if the hasRecordPayload guard is removed from publish.
test("catch-all subscribers reject non-record payloads before invoking the handler", async () => {
  const bus = new InMemoryEventBus();
  let calls = 0;
  const unsubscribe = await bus.subscribeAll({ handler: async () => { calls++; } });
  for (const payload of ["text", 1, null, [1]]) {
    await assert.rejects(bus.publish({ id: "event", name: "fixture.event", occurredAt: "2026-10-02T00:00:00.000Z", workspaceId: "workspace", payload }), TypeError);
  }
  assert.equal(calls, 0);
  await unsubscribe();
  await assert.doesNotReject(bus.publish({ id: "event", name: "fixture.event", occurredAt: "2026-10-02T00:00:00.000Z", workspaceId: "workspace", payload: "text" }));
});
