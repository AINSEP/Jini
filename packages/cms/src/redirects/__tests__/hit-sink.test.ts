import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryEventBus } from "./support/events.fixture.js";
import { RedirectHitSinkImpl, registerRedirectHitOutboxHandler } from "../hit-sink.js";
import type { RedirectHitEvent } from "../ports.js";

/**
 * @file T010 (AC-26, REQ-21) — `hit-sink.ts`: `record`/`getStats`/`listStats`;
 * a forced throw in `record()` does not affect an already-returned redirect
 * response (AC-26) — proven here by asserting the outbox subscriber swallows
 * the failure rather than rethrowing.
 */

const WORKSPACE_ID = "workspace-1";

test("record increments hitCount and sets lastHitAt", async () => {
  const sink = new RedirectHitSinkImpl();
  await sink.record({ workspaceId: WORKSPACE_ID, redirectId: "r-1", at: "2026-07-13T00:00:00.000Z" });
  await sink.record({ workspaceId: WORKSPACE_ID, redirectId: "r-1", at: "2026-07-13T00:01:00.000Z" });

  const stats = await sink.getStats({ workspaceId: WORKSPACE_ID, redirectId: "r-1" });
  assert.equal(stats?.hitCount, 2);
  assert.equal(stats?.lastHitAt, "2026-07-13T00:01:00.000Z");
});

test("getStats returns null for a redirect with no recorded hits", async () => {
  const sink = new RedirectHitSinkImpl();
  const stats = await sink.getStats({ workspaceId: WORKSPACE_ID, redirectId: "never-hit" });
  assert.equal(stats, null);
});

test("getStats returns null for a different workspace", async () => {
  const sink = new RedirectHitSinkImpl();
  await sink.record({ workspaceId: WORKSPACE_ID, redirectId: "r-1", at: "2026-07-13T00:00:00.000Z" });
  const stats = await sink.getStats({ workspaceId: "other-workspace", redirectId: "r-1" });
  assert.equal(stats, null);
});

test("listStats returns all recorded stats for a workspace", async () => {
  const sink = new RedirectHitSinkImpl();
  await sink.record({ workspaceId: WORKSPACE_ID, redirectId: "r-1", at: "2026-07-13T00:00:00.000Z" });
  await sink.record({ workspaceId: WORKSPACE_ID, redirectId: "r-2", at: "2026-07-13T00:00:00.000Z" });
  await sink.record({ workspaceId: "other-workspace", redirectId: "r-3", at: "2026-07-13T00:00:00.000Z" });

  const stats = await sink.listStats({ workspaceId: WORKSPACE_ID });
  assert.equal(stats.length, 2);
  assert.deepEqual(
    stats.map((s) => s.redirectId).sort(),
    ["r-1", "r-2"]
  );
});

test("AC-26: a forced throw in record() does not propagate out of the outbox subscriber", async () => {
  const sink = new RedirectHitSinkImpl();
  const originalRecord = sink.record.bind(sink);
  sink.record = async () => {
    throw new Error("simulated storage failure");
  };

  const bus = new InMemoryEventBus();
  await registerRedirectHitOutboxHandler({ bus, hitSink: sink });

  const event: RedirectHitEvent = {
    id: "evt-1",
    name: "redirect.hit",
    occurredAt: "2026-07-13T00:00:00.000Z",
    workspaceId: WORKSPACE_ID,
    payload: { workspaceId: WORKSPACE_ID, redirectId: "r-1", at: "2026-07-13T00:00:00.000Z" },
  };

  // publish() must not throw even though the subscribed handler's record() call fails.
  await assert.doesNotReject(() => bus.publish(event));

  // restore and sanity-check the real implementation still works.
  sink.record = originalRecord;
  await sink.record({ workspaceId: WORKSPACE_ID, redirectId: "r-1", at: "2026-07-13T00:00:00.000Z" });
  const stats = await sink.getStats({ workspaceId: WORKSPACE_ID, redirectId: "r-1" });
  assert.equal(stats?.hitCount, 1);
});

test("registerRedirectHitOutboxHandler subscribes record() to the redirect.hit event", async () => {
  const sink = new RedirectHitSinkImpl();
  const bus = new InMemoryEventBus();
  await registerRedirectHitOutboxHandler({ bus, hitSink: sink });

  const event: RedirectHitEvent = {
    id: "evt-2",
    name: "redirect.hit",
    occurredAt: "2026-07-13T00:00:00.000Z",
    workspaceId: WORKSPACE_ID,
    payload: { workspaceId: WORKSPACE_ID, redirectId: "r-9", at: "2026-07-13T00:00:00.000Z" },
  };
  await bus.publish(event);

  const stats = await sink.getStats({ workspaceId: WORKSPACE_ID, redirectId: "r-9" });
  assert.equal(stats?.hitCount, 1);
  assert.deepEqual(stats, { workspaceId: WORKSPACE_ID, redirectId: "r-9", hitCount: 1, lastHitAt: "2026-07-13T00:00:00.000Z" });

  await bus.publish({ ...event, id: "ignored", name: "post.created", payload: { ...event.payload, redirectId: "ignored" } });
  assert.equal(await sink.getStats({ workspaceId: WORKSPACE_ID, redirectId: "ignored" }), null);
  await bus.publish({
    ...event, id: "other-hit", workspaceId: "other-workspace",
    payload: { workspaceId: "other-workspace", redirectId: "r-other", at: "2026-07-13T00:01:00.000Z" },
  });
  assert.deepEqual(await sink.getStats({ workspaceId: "other-workspace", redirectId: "r-other" }), {
    workspaceId: "other-workspace", redirectId: "r-other", hitCount: 1, lastHitAt: "2026-07-13T00:01:00.000Z",
  });
  assert.deepEqual(await sink.listStats({ workspaceId: WORKSPACE_ID }), [stats]);
});
