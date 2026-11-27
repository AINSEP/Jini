import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import type { DomainEvent } from "@jini-ai/core/contracts/events";
import { InMemoryEventBus, InMemoryOutbox } from "../memory-bus.js";
import { computeDomainOutboxBackoffMs, outboxWorkerArgs, processDomainOutbox, trackOutboxDelivery } from "../domain-outbox.js";
import { DEFAULT_OUTBOX_DELIVERY_TIMEOUT_MS } from "../outbox/index.js";

afterEach(() => { vi.restoreAllMocks(); });

/** Records every timer request; nothing ever fires, so a drain that settles proves it cancelled its own timer. */
function recordingScheduler() {
  const calls: { delayMs: number; cancelled: boolean }[] = [];
  return { calls, scheduler: { schedule: ({ delayMs }: { delayMs: number; callback: () => void }) => {
    const call = { delayMs, cancelled: false };
    calls.push(call);
    return { cancel: () => { call.cancelled = true; } };
  } } };
}

function makeEvent(id: string, name = "entry.updated"): DomainEvent {
  return { id, name, occurredAt: "2026-01-01T00:00:00.000Z", workspaceId: "ws-domain-outbox", payload: {} };
}

test("computeOutboxBackoffMs uses host randomness when no random port is supplied", () => {
  vi.spyOn(Math, "random").mockImplementation(() => 0.25);

  assert.equal(computeDomainOutboxBackoffMs({ attempts: 1 }), 18_750);
});

test("processDomainOutbox forwards batchSize and the host retry policy, recording a failure through the domain port", async () => {
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  await bus.subscribe({ eventName: "entry.updated", handler: async () => { throw new Error("handler down"); } });
  await outbox.enqueue(makeEvent("a"));
  await outbox.enqueue(makeEvent("b"));
  const clock = { nowMs: () => Date.parse("2026-01-01T00:00:00.000Z") };
  const seen: string[] = [];
  const { scheduler } = recordingScheduler();

  const claimed = await processDomainOutbox({ outbox, bus, clock, scheduler, logger: { error: () => {} } }, {
    batchSize: 1,
    random: () => 0,
    retryPolicyForEvent: ({ event }) => { seen.push(event.name); return { maxAttempts: 1, backoffMs: () => 0 }; },
  });

  assert.equal(claimed, 1);
  assert.deepEqual(seen, ["entry.updated"]);
  const rows = await outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" });
  assert.deepEqual(rows.map((row) => row.id), ["b"], "the policy's one-attempt cap made row a terminal; row b was never claimed");
});

test("processDomainOutbox uses only the host-supplied scheduler and logger, never its own timer or console", async () => {
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  await bus.subscribe({ eventName: "entry.updated", handler: async () => { throw new Error("handler down"); } });
  await outbox.enqueue(makeEvent("a"));
  const clock = { nowMs: () => Date.parse("2026-01-01T00:00:00.000Z") };
  const { scheduler, calls } = recordingScheduler();
  const logged: { message: string }[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

  await processDomainOutbox({ outbox, bus, clock, scheduler, logger: { error: (entry) => { logged.push(entry); } } }, { random: () => 0 });

  assert.deepEqual(calls.map((call) => [call.delayMs, call.cancelled]), [[DEFAULT_OUTBOX_DELIVERY_TIMEOUT_MS, true]]);
  assert.equal(logged.length, 1, "the failed delivery is reported through the injected logger");
  assert.equal(consoleError.mock.calls.length, 0, "nothing reaches the console unless the host's logger puts it there");
  assert.equal(setTimeoutSpy.mock.calls.length, 0, "no timer other than the host scheduler's");
});

test("outboxWorkerArgs hands the host's scheduler and logger to the worker unchanged", () => {
  const { scheduler } = recordingScheduler();
  const logger = { error: () => {} };
  const args = outboxWorkerArgs({ outbox: new InMemoryOutbox(), bus: new InMemoryEventBus(), clock: { nowMs: () => 0 }, scheduler, logger });
  assert.equal(args.scheduler, scheduler);
  assert.equal(args.logger, logger);
});

test("trackOutboxDelivery traces each delivery as outbox.deliver labelled by event name only, and rethrows a failure", async () => {
  const traces: { name: string; attributes: unknown; outcome?: unknown }[] = [];
  const tracker = { trace: async ({ name, run }: { name: string; run: (span: { setOutcome: (o: unknown) => void }) => Promise<unknown> }, options: { attributes?: unknown } = {}) => {
    const entry: { name: string; attributes: unknown; outcome?: unknown } = { name, attributes: options.attributes };
    traces.push(entry);
    return run({ setOutcome: (outcome) => { entry.outcome = outcome; } });
  } } as unknown as Parameters<typeof trackOutboxDelivery>[0]["tracker"];
  const published: string[] = [];
  const bus = { publish: async ({ event }: { event: DomainEvent }) => { published.push(event.id); if (event.id === "boom") throw new Error("handler down"); } };
  const traced = trackOutboxDelivery({ bus: bus as never, tracker });

  await traced.publish({ event: makeEvent("ok", "entry.updated") });
  await assert.rejects(traced.publish({ event: makeEvent("boom", "entry.deleted") }), /handler down/);

  assert.deepEqual(published, ["ok", "boom"]);
  assert.deepEqual(traces, [
    { name: "outbox.deliver", attributes: { "event.name": "entry.updated" }, outcome: { outcome: "delivered", failed: false } },
    { name: "outbox.deliver", attributes: { "event.name": "entry.deleted" } },
  ]);
});

test("reads trace ancestry before stripping private transport fields from each delivery", async () => {
  const order: string[] = [];
  const parents: unknown[] = [];
  const delivered: DomainEvent[] = [];
  const stored = { ...makeEvent("private"), payload: { traceParent: "persisted-parent", value: 1 } };
  const failure = new Error("publish rejected");
  const tracker = { trace: async ({ run }: { run: (span: { setOutcome: () => void }) => Promise<unknown> }, options: { traceparent?: string }) => {
    parents.push(options.traceparent);
    return run({ setOutcome() {} });
  } } as unknown as Parameters<typeof trackOutboxDelivery>[0]["tracker"];
  const bus: Parameters<typeof trackOutboxDelivery>[0]["bus"] = { publish: async ({ event }) => {
    order.push("publish"); delivered.push(event); throw failure;
  } };
  const traced = trackOutboxDelivery({ bus, tracker }, {
    readParent: ({ event }) => { order.push("parent"); return String(event.payload.traceParent); },
    prepareEvent: ({ event }) => { order.push("prepare"); const { traceParent, ...payload } = event.payload; return { ...event, payload }; },
  });
  await assert.rejects(traced.publish({ event: stored }), error => error === failure);
  await assert.rejects(traced.publish({ event: stored }), error => error === failure);
  assert.deepEqual(order, ["parent", "prepare", "publish", "parent", "prepare", "publish"]);
  assert.deepEqual(parents, ["persisted-parent", "persisted-parent"]);
  assert.deepEqual(delivered.map(event => event.payload), [{ value: 1 }, { value: 1 }]);
  assert.equal(stored.payload.traceParent, "persisted-parent");
});

test("delivers a persisted event even when trace ancestry cannot be decoded", async () => {
  const event = makeEvent("delivery-no-parent", "entry.published");
  const publish = vi.fn<Parameters<typeof trackOutboxDelivery>[0]["bus"]["publish"]>(async () => {});
  const recorded: unknown[] = [];
  const tracker = { trace: async ({ name, run }: { name: string; run: (span: { setOutcome: (outcome: unknown) => void }) => Promise<unknown> }, options: unknown) => {
    recorded.push({ name, options });
    return run({ setOutcome: outcome => recorded.push(outcome) });
  } } as unknown as Parameters<typeof trackOutboxDelivery>[0]["tracker"];
  const readParent = vi.fn(() => { throw new Error("unreadable trace context"); });
  await trackOutboxDelivery({ bus: { publish }, tracker }, { readParent }).publish({ event });
  assert.deepEqual(readParent.mock.calls, [[{ event }]]);
  assert.deepEqual(publish.mock.calls, [[{ event }]]);
  assert.deepEqual(recorded, [
    { name: "outbox.deliver", options: { attributes: { "event.name": "entry.published" } } },
    { outcome: "delivered", failed: false },
  ]);
});
