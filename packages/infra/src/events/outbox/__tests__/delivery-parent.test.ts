import assert from "node:assert/strict";
import { test } from "vitest";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import { InMemoryEventBus, InMemoryOutbox } from "../../memory-bus.js";
import { outboxWorkerArgs, trackOutboxDelivery } from "../../domain-outbox.js";
import { processOutbox } from "../worker.js";

/**
 * @file The delivery half of the outbox correlation seam: a background drain cannot inherit the
 * producing request's local state, so the parent comes only from the persisted envelope through the
 * host's injected reader, and reaches the tracker as a trace option, never as a span attribute.
 */

const PARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
const T0 = Date.parse("2026-01-01T00:00:00.000Z");

type TraceCall = { name: string; options: Record<string, unknown>; outcome?: unknown };

/** A tracker double recording each trace's name, full options and settled outcome. */
function recordingTracker() {
  const calls: TraceCall[] = [];
  const tracker = { trace: async ({ name, run }: { name: string; run: (span: { setOutcome: (o: unknown) => void }) => Promise<unknown> }, options: Record<string, unknown>) => {
    const call: TraceCall = { name, options };
    calls.push(call);
    return run({ setOutcome: (outcome) => { call.outcome = outcome; } });
  } } as unknown as Parameters<typeof trackOutboxDelivery>[0]["tracker"];
  return { calls, tracker };
}

const persisted: DomainEvent = {
  id: "evt-1", name: "entry.updated", occurredAt: "2026-01-01T00:00:00.000Z", workspaceId: "ws-1", payload: {}, metadata: { traceparent: PARENT },
};

test("delivery passes the persisted parent in trace options and runs the subscriber once", async () => {
  const outbox = new InMemoryOutbox();
  await outbox.enqueue(persisted);
  const bus = new InMemoryEventBus();
  const handled: string[] = [];
  let failNext = true;
  await bus.subscribe({ eventName: "entry.updated", handler: async (event) => {
    handled.push(event.id);
    if (failNext) { failNext = false; throw new Error("handler down"); }
  } });
  const { calls, tracker } = recordingTracker();
  const readParent = ({ event }: { event: DomainEvent }) => (typeof event.metadata?.traceparent === "string" ? event.metadata.traceparent : undefined);
  let now = T0;
  const args = outboxWorkerArgs({ outbox, bus, clock: { nowMs: () => now }, scheduler: { schedule: () => ({ cancel: () => {} }) }, logger: { error: () => {} } }, { random: () => 0 });
  const traced = { ...args, bus: trackOutboxDelivery({ bus: args.bus, tracker }, { readParent }) };

  assert.equal(await processOutbox(traced), 1);
  assert.deepEqual(handled, ["evt-1"], "the failing attempt invoked the subscriber exactly once");
  now = T0 + 24 * 60 * 60 * 1000;
  assert.equal(await processOutbox(traced), 1, "the failed delivery was retried");
  assert.deepEqual(handled, ["evt-1", "evt-1"], "the retry invoked the subscriber exactly once more");

  const expectedOptions = { attributes: { "event.name": "entry.updated" }, traceparent: PARENT };
  assert.deepEqual(calls, [
    { name: "outbox.deliver", options: expectedOptions },
    { name: "outbox.deliver", options: expectedOptions, outcome: { outcome: "delivered", failed: false } },
  ], "both attempts carry the same persisted parent as a trace option and never as an attribute");
});

test("an absent or unreadable parent leaves the trace options and the delivery as before", async () => {
  const { calls, tracker } = recordingTracker();
  const published: string[] = [];
  const bus = { publish: async ({ event }: { event: DomainEvent }) => { published.push(event.id); } };
  await trackOutboxDelivery({ bus, tracker }, { readParent: () => undefined }).publish({ event: persisted });
  await trackOutboxDelivery({ bus, tracker }, { readParent: () => { throw new Error("reader bug"); } }).publish({ event: persisted });
  await trackOutboxDelivery({ bus, tracker }).publish({ event: persisted });
  assert.deepEqual(published, ["evt-1", "evt-1", "evt-1"]);
  assert.deepEqual(calls.map((call) => call.options), Array(3).fill({ attributes: { "event.name": "entry.updated" } }));
});
