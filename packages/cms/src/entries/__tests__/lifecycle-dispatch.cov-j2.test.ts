import assert from "node:assert/strict";
import { test } from "vitest";

import { ENTRY_LIFECYCLE_OPS, parseEntryLifecycleOp } from "../lifecycle-dispatch.js";
import { InMemoryEntryRepo } from "../repo.memory.js";
import type { EntryRecord } from "../types.js";

/**
 * @file Each entry of the closed entry-lifecycle dispatch table runs its own status transition
 * with the dispatcher's deps and input threaded through.
 */

const NOW = "2026-07-15T00:00:00.000Z";

async function dispatchHarness(status: EntryRecord["status"]) {
  const entryRepo = new InMemoryEntryRepo();
  await entryRepo.save({
    id: "entry-1", workspaceId: "ws-1", type: "recipe", slug: "chili", status, title: "Chili",
    fieldsJson: { ext: { site: {} } }, bodyJson: null, publishedAt: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", version: 2,
  });
  const events: unknown[] = [];
  const deps = {
    entryRepo,
    contentTypeRepo: { findByKey: async () => ({ workspaceId: "ws-1", key: "recipe", status: "active" as const, fields: [] }) },
    clock: { nowMs: () => Date.parse(NOW) },
    authorize: async () => ({ allowed: true, reason: "matched" }),
    outbox: { enqueue: async (event: unknown) => { events.push(event); } },
  };
  return { entryRepo, deps, events };
}

function dispatch(op: string, deps: Awaited<ReturnType<typeof dispatchHarness>>["deps"]) {
  const parsed = parseEntryLifecycleOp({ op });
  assert.ok(parsed, `'${op}' must parse`);
  return ENTRY_LIFECYCLE_OPS[parsed]({ deps, input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", expectedVersion: 2 } });
}

test("dispatching 'publish' flips draft -> published, stamps publishedAt, and enqueues entry.published", async () => {
  const h = await dispatchHarness("draft");

  const result = await dispatch("publish", h.deps);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.entry.status, "published");
  assert.equal(result.value.entry.publishedAt, NOW);
  assert.equal((await h.entryRepo.findById({ workspaceId: "ws-1", id: "entry-1" }))?.version, 3);
  assert.deepEqual(h.events, [{ name: "entry.published", payload: { workspaceId: "ws-1", entryId: "entry-1" } }]);
});

test("dispatching 'unpublish' flips published -> unpublished and enqueues entry.unpublished", async () => {
  const h = await dispatchHarness("published");

  const result = await dispatch("unpublish", h.deps);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.entry.status, "unpublished");
  assert.equal((await h.entryRepo.findById({ workspaceId: "ws-1", id: "entry-1" }))?.status, "unpublished");
  assert.deepEqual(h.events, [{ name: "entry.unpublished", payload: { workspaceId: "ws-1", entryId: "entry-1" } }]);
});
