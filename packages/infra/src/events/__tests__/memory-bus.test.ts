import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryEventBus, InMemoryOutbox } from "../memory-bus.js";

test("unknown outbox updates leave the real pending row claimable and acknowledgements stay terminal", async () => {
  const outbox = new InMemoryOutbox({ claimLeaseMs: 100 });
  const nowIso = "2026-02-21T00:00:00.000Z";
  const event = { id: "evt-held", name: "entry.published", workspaceId: "workspace-1", occurredAt: nowIso, payload: { value: 3 } };
  await outbox.enqueue(event);
  await outbox.markDelivered({ id: "missing" });
  await outbox.markFailed({ id: "missing", error: "unrelated", nextAttemptAt: nowIso, nextStatus: "failed" });
  assert.deepEqual(await outbox.claimPending({ batchSize: 5, nowIso }), [{
    id: "evt-held", event, status: "processing", attempts: 1, nextAttemptAt: nowIso, createdAt: nowIso,
  }]);
  await outbox.markDelivered({ id: "evt-held" });
  assert.deepEqual(await outbox.claimPending({ batchSize: 5, nowIso: "2026-02-21T00:00:01.000Z" }), []);
});


test("subscribeAll delivers events of several different names to one handler", async () => {
  const bus = new InMemoryEventBus();
  const seen: string[] = [];

  await bus.subscribeAll({ handler: async (event) => {
    seen.push(event.name);
  } });

  await bus.publish({
    id: "evt-1",
    name: "workspace.created",
    occurredAt: "2026-02-21T00:00:00.000Z",
    workspaceId: "workspace-1",
    payload: {},
  });
  await bus.publish({
    id: "evt-2",
    name: "entry.published",
    occurredAt: "2026-02-21T00:00:01.000Z",
    workspaceId: "workspace-1",
    payload: {},
  });

  assert.deepEqual(seen, ["workspace.created", "entry.published"]);
});

test("subscribeAll's unsubscriber stops delivery", async () => {
  const bus = new InMemoryEventBus();
  let count = 0;

  const unsubscribe = await bus.subscribeAll({ handler: async () => {
    count += 1;
  } });

  await bus.publish({
    id: "evt-1",
    name: "workspace.created",
    occurredAt: "2026-02-21T00:00:00.000Z",
    workspaceId: "workspace-1",
    payload: {},
  });
  assert.equal(count, 1);

  await unsubscribe();

  await bus.publish({
    id: "evt-2",
    name: "workspace.created",
    occurredAt: "2026-02-21T00:00:01.000Z",
    workspaceId: "workspace-1",
    payload: {},
  });
  assert.equal(count, 1);
});

test("subscribeAll handlers run alongside per-name subscribe handlers", async () => {
  const bus = new InMemoryEventBus();
  const order: string[] = [];

  await bus.subscribe({ eventName: "workspace.created", handler: async () => {
    order.push("named");
  } });
  await bus.subscribeAll({ handler: async () => {
    order.push("all");
  } });

  await bus.publish({
    id: "evt-1",
    name: "workspace.created",
    occurredAt: "2026-02-21T00:00:00.000Z",
    workspaceId: "workspace-1",
    payload: {},
  });

  assert.deepEqual(order, ["named", "all"]);
});

test("publishBatch delivers every event, in order, to a subscribeAll handler", async () => {
  const bus = new InMemoryEventBus();
  const seen: string[] = [];

  await bus.subscribeAll({ handler: async (event) => {
    seen.push(event.name);
  } });

  await bus.publishBatch({ events: [
    {
      id: "evt-1",
      name: "workspace.created",
      occurredAt: "2026-02-21T00:00:00.000Z",
      workspaceId: "workspace-1",
      payload: {},
    },
    {
      id: "evt-2",
      name: "entry.published",
      occurredAt: "2026-02-21T00:00:01.000Z",
      workspaceId: "workspace-1",
      payload: {},
    },
    {
      id: "evt-3",
      name: "entry.unpublished",
      occurredAt: "2026-02-21T00:00:02.000Z",
      workspaceId: "workspace-1",
      payload: {},
    },
  ] });

  assert.deepEqual(seen, ["workspace.created", "entry.published", "entry.unpublished"]);
});

test("publishBatch on an empty array delivers nothing", async () => {
  const bus = new InMemoryEventBus();
  let calls = 0;

  await bus.subscribeAll({ handler: async () => {
    calls += 1;
  } });

  await bus.publishBatch({ events: [] });

  assert.equal(calls, 0);
});

test("subscribe's unsubscriber removes only that handler, leaving a second handler on the same event name intact", async () => {
  const bus = new InMemoryEventBus();
  const firstSeen: string[] = [];
  const secondSeen: string[] = [];

  const unsubscribeFirst = await bus.subscribe({ eventName: "workspace.created", handler: async (event) => {
    firstSeen.push(event.name);
  } });
  await bus.subscribe({ eventName: "workspace.created", handler: async (event) => {
    secondSeen.push(event.name);
  } });

  await unsubscribeFirst();

  await bus.publish({
    id: "evt-1",
    name: "workspace.created",
    occurredAt: "2026-02-21T00:00:00.000Z",
    workspaceId: "workspace-1",
    payload: {},
  });

  assert.deepEqual(firstSeen, [], "the unsubscribed handler must not run");
  assert.deepEqual(secondSeen, ["workspace.created"], "the still-subscribed handler must still run");
});

test("named subscriptions deliver only the matching name", async () => {
  const bus = new InMemoryEventBus();
  const seen: string[] = [];
  for (const eventName of ["workspace.created", "entry.published"]) {
    await bus.subscribe({ eventName, handler: async (event) => { seen.push(`${eventName}:${event.id}`); } });
  }
  await bus.publish({ id: "evt-a", name: "workspace.created", occurredAt: "2026-02-21T00:00:00.000Z", workspaceId: "workspace-1", payload: {} });
  assert.deepEqual(seen, ["workspace.created:evt-a"]);
  await bus.publish({ id: "evt-b", name: "entry.published", occurredAt: "2026-02-21T00:00:01.000Z", workspaceId: "workspace-1", payload: {} });
  assert.deepEqual(seen, ["workspace.created:evt-a", "entry.published:evt-b"]);
});

test("a handler failure is reported by publish for the outbox to retry", async () => {
  const bus = new InMemoryEventBus();
  const failure = new Error("consumer failed");
  await bus.subscribe({ eventName: "entry.published", handler: async () => { throw failure; } });
  await assert.rejects(bus.publish({ id: "evt", name: "entry.published", occurredAt: "2026-02-21T00:00:00.000Z", workspaceId: "workspace-1", payload: {} }), (error) => error === failure);
});

test("unsubscribing repeatedly preserves other wildcard handlers and later named subscriptions", async () => {
  const bus = new InMemoryEventBus();
  const seen: string[] = [];
  const removed = await bus.subscribeAll({ handler: async () => { seen.push("removed"); } });
  await bus.subscribeAll({ handler: async event => { seen.push(`all:${event.id}`); } });
  const named = await bus.subscribe({ eventName: "entry.published", handler: async () => { seen.push("old"); } });
  await removed();
  await removed();
  await named();
  await named();
  await bus.subscribe({ eventName: "entry.published", handler: async event => { seen.push(`new:${event.id}`); } });
  await bus.publish({ id: "evt", name: "entry.published", occurredAt: "2026-02-21T00:00:00.000Z", workspaceId: "workspace-1", payload: {} });
  assert.deepEqual(seen, ["new:evt", "all:evt"]);
});
