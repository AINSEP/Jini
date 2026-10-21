import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryContentTypeRepo, NoopContentTypeIndexProvisioner, toContentTypeOutbox } from "../repo.memory.js";
import type { ContentTypeRevisionInput } from "../write-service.js";
import type { ContentTypeRecord } from "../types.js";

/**
 * @file The in-memory content-type adapters the hermetic composition runs on: workspace-scoped
 * keys, copy-on-read/write isolation, the append-only revision log, the no-op index provisioner,
 * and the outbox adapter that widens `{name,payload}` into a full domain event.
 */

function record(overrides: Partial<ContentTypeRecord> = {}): ContentTypeRecord {
  return { workspaceId: "ws-1", key: "recipe", label: "Recipe", fields: [], status: "active", version: 1, ...overrides };
}

function revision(overrides: Partial<ContentTypeRevisionInput> = {}): ContentTypeRevisionInput {
  return {
    contentTypeKey: "recipe", workspaceId: "ws-1", op: "field-change", stateJson: record(), actorId: "user-1",
    principalKind: null, delegatedByWorkspaceId: null, delegatedById: null, recordedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

test("findByKey is scoped by workspace and key, returns null for a miss, and hands out copies", async () => {
  const repo = new InMemoryContentTypeRepo();
  const original = record();
  await repo.save(original);
  original.label = "mutated after save";

  const found = await repo.findByKey({ workspaceId: "ws-1", key: "recipe" });
  assert.equal(found?.label, "Recipe");
  if (found) found.label = "mutated after read";
  assert.equal((await repo.findByKey({ workspaceId: "ws-1", key: "recipe" }))?.label, "Recipe");

  assert.equal(await repo.findByKey({ workspaceId: "ws-2", key: "recipe" }), null);
  assert.equal(await repo.findByKey({ workspaceId: "ws-1", key: "other" }), null);
});

test("save replaces the row for the same (workspace, key) rather than adding a second one", async () => {
  const repo = new InMemoryContentTypeRepo();
  await repo.save(record());
  await repo.save(record({ label: "Recipe v2", version: 2 }));

  assert.deepEqual(await repo.listByWorkspace({ workspaceId: "ws-1" }), [record({ label: "Recipe v2", version: 2 })]);
});

test("listByWorkspace returns only that workspace's rows, as copies", async () => {
  const repo = new InMemoryContentTypeRepo();
  await repo.save(record({ key: "recipe" }));
  await repo.save(record({ key: "article" }));
  await repo.save(record({ workspaceId: "ws-2", key: "recipe" }));

  const rows = await repo.listByWorkspace({ workspaceId: "ws-1" });
  assert.deepEqual(rows.map((row) => row.key).sort(), ["article", "recipe"]);
  rows[0]!.label = "mutated";
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" })).map((row) => row.label), ["Recipe", "Recipe"]);
  assert.deepEqual(await repo.listByWorkspace({ workspaceId: "ws-3" }), []);
});

test("listRevisions returns appended revisions oldest-first, as copies the caller cannot use to rewrite history", async () => {
  const repo = new InMemoryContentTypeRepo();
  await repo.appendRevision(revision({ actorId: "first" }));
  await repo.appendRevision(revision({ actorId: "second", principalKind: "agent" }));

  const listed = repo.listRevisions();
  assert.deepEqual(listed.map((r) => [r.actorId, r.principalKind]), [["first", null], ["second", "agent"]]);
  listed[0]!.actorId = "rewritten";
  assert.equal(repo.listRevisions()[0]?.actorId, "first");
});

test("transaction runs the callback and resolves to its value", async () => {
  const repo = new InMemoryContentTypeRepo();
  const value = await repo.transaction({ fn: async () => { await repo.save(record()); return 42; } });
  assert.equal(value, 42);
  assert.ok(await repo.findByKey({ workspaceId: "ws-1", key: "recipe" }));
});

test("NoopContentTypeIndexProvisioner resolves every provisioning call without effect", async () => {
  const provisioner = new NoopContentTypeIndexProvisioner();
  assert.equal(await provisioner.provisionIndexesForNewContentType(), undefined);
  assert.equal(await provisioner.applyFieldIndexTransitions(), undefined);
  assert.equal(await provisioner.tearDownAllIndexesForContentType(), undefined);
});

test("toContentTypeOutbox stamps a fresh id, the bound workspace, and the clock's time onto each enqueued event", async () => {
  const delivered: unknown[] = [];
  let n = 0;
  const outbox = toContentTypeOutbox({
    outbox: { enqueue: async (event) => { delivered.push(event); } },
    clock: { nowMs: () => Date.parse("2026-07-15T12:00:00.000Z") },
    idGen: { newId: () => `evt-${++n}` },
    workspaceId: "ws-1",
  });

  await outbox.enqueue({ name: "content_type.deprecated", payload: { key: "recipe" } });
  await outbox.enqueue({ name: "content_type.tombstoned", payload: { key: "recipe" } });

  assert.deepEqual(delivered, [
    { id: "evt-1", workspaceId: "ws-1", name: "content_type.deprecated", occurredAt: "2026-07-15T12:00:00.000Z", payload: { key: "recipe" } },
    { id: "evt-2", workspaceId: "ws-1", name: "content_type.tombstoned", occurredAt: "2026-07-15T12:00:00.000Z", payload: { key: "recipe" } },
  ]);
});
