import assert from "node:assert/strict";
import { test } from "vitest";

import { CONTENT_TYPE_LIFECYCLE_OPS, parseContentTypeLifecycleOp, type LifecycleDispatchDeps } from "../lifecycle-dispatch.js";
import { InMemoryContentTypeRepo } from "../repo.memory.js";
import type { ContentTypeRecord, ContentTypeStatus } from "../types.js";

/**
 * @file Each entry of the closed lifecycle dispatch table runs its own transition with the
 * dispatcher's deps and input threaded through, and reactivate (which takes no outbox/index deps)
 * never touches either even though the dispatcher holds them.
 */

const NOW = "2026-07-15T00:00:00.000Z";

async function dispatchHarness(status: ContentTypeStatus) {
  const repo = new InMemoryContentTypeRepo();
  const seed: ContentTypeRecord = { workspaceId: "ws-1", key: "recipe", label: "Recipe", fields: [], status, version: 5, tombstonedAt: null };
  await repo.save(seed);
  const events: unknown[] = [];
  const teardowns: unknown[] = [];
  const deps: LifecycleDispatchDeps = {
    repo,
    clock: { nowMs: () => Date.parse(NOW) },
    authorize: async () => ({ allowed: true, reason: "matched" }),
    outbox: { enqueue: async (event) => { events.push(event); } },
    indexProvisioner: { tearDownAllIndexesForContentType: async (call) => { teardowns.push(call); } },
  };
  return { repo, deps, events, teardowns };
}

const input = { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 5, principalKind: "agent" as const };

function dispatch(op: string, deps: LifecycleDispatchDeps) {
  const parsed = parseContentTypeLifecycleOp({ op });
  assert.ok(parsed, `'${op}' must parse`);
  return CONTENT_TYPE_LIFECYCLE_OPS[parsed]({ deps, input });
}

test("dispatching 'deprecate' flips active -> deprecated, records the principalKind, and enqueues content_type.deprecated", async () => {
  const h = await dispatchHarness("active");

  const result = await dispatch("deprecate", h.deps);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.contentType.status, "deprecated");
  assert.equal(result.value.contentType.version, 6);
  assert.equal(h.repo.listRevisions()[0]?.principalKind, "agent");
  assert.deepEqual(h.events, [{ name: "content_type.deprecated", payload: { workspaceId: "ws-1", key: "recipe" } }]);
  assert.deepEqual(h.teardowns, []);
});

test("dispatching 'reactivate' flips deprecated -> active without enqueueing an event or touching indexes", async () => {
  const h = await dispatchHarness("deprecated");

  const result = await dispatch("reactivate", h.deps);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.contentType.status, "active");
  assert.equal((await h.repo.findByKey({ workspaceId: "ws-1", key: "recipe" }))?.status, "active");
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.teardowns, []);
});

test("dispatching 'tombstone' flips deprecated -> tombstone, tears down indexes, and enqueues content_type.tombstoned", async () => {
  const h = await dispatchHarness("deprecated");

  const result = await dispatch("tombstone", h.deps);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.contentType.status, "tombstone");
  assert.equal(result.value.contentType.tombstonedAt, NOW);
  assert.deepEqual(h.teardowns, [{ workspaceId: "ws-1", contentTypeKey: "recipe" }]);
  assert.deepEqual(h.events, [{ name: "content_type.tombstoned", payload: { workspaceId: "ws-1", key: "recipe" } }]);
});
