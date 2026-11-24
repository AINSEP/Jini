import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import type { DomainEvent } from "@jini-ai/core/contracts/events";
import { InMemoryEventBus, InMemoryOutbox } from "../memory-bus.js";
import { computeDomainOutboxBackoffMs, processDomainOutbox } from "../domain-outbox.js";

afterEach(() => { vi.restoreAllMocks(); });

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

  const claimed = await processDomainOutbox({ outbox, bus, clock }, {
    batchSize: 1,
    random: () => 0,
    retryPolicyForEvent: ({ event }) => { seen.push(event.name); return { maxAttempts: 1, backoffMs: () => 0 }; },
  });

  assert.equal(claimed, 1);
  assert.deepEqual(seen, ["entry.updated"]);
  const rows = await outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" });
  assert.deepEqual(rows.map((row) => row.id), ["b"], "the policy's one-attempt cap made row a terminal; row b was never claimed");
});
