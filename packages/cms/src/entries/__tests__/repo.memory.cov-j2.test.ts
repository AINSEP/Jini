import assert from "node:assert/strict";
import { test } from "vitest";

import { VersionConflictError } from "../errors.js";
import { InMemoryEntryRepo, toEntryOutbox } from "../repo.memory.js";
import type { EntryRecord } from "../types.js";

/**
 * @file The in-memory entry adapter's compare-and-set save, workspace-scoped reads, list filtering,
 * `updatedAt` ordering and limit, and the outbox adapter that widens `{name,payload}` into a full
 * domain event.
 */

function entry(overrides: Partial<EntryRecord> = {}): EntryRecord {
  return {
    id: "entry-1", workspaceId: "ws-1", type: "recipe", slug: "chili", status: "draft", title: "Chili",
    fieldsJson: { ext: { site: {} } }, bodyJson: null, publishedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", version: 1, ...overrides,
  };
}

test("save with expectedVersion=null creates only when the id is free in every workspace", async () => {
  const repo = new InMemoryEntryRepo();
  await repo.save(entry(), { expectedVersion: null });
  assert.equal((await repo.findById({ workspaceId: "ws-1", id: "entry-1" }))?.version, 1);

  await assert.rejects(
    () => repo.save(entry({ title: "dup" }), { expectedVersion: null }),
    (error: unknown) => error instanceof VersionConflictError && error.message === "expected no entry 'entry-1', found 1",
  );
  await assert.rejects(
    () => repo.save(entry({ workspaceId: "ws-2", title: "foreign" }), { expectedVersion: null }),
    (error: unknown) => error instanceof VersionConflictError && error.message === "expected no entry 'entry-1', found 1",
  );
  assert.equal((await repo.findById({ workspaceId: "ws-1", id: "entry-1" }))?.title, "Chili");
});

test("save with a numeric expectedVersion writes only over the same workspace's row at that version", async () => {
  const repo = new InMemoryEntryRepo();
  await repo.save(entry());

  await repo.save(entry({ title: "v2", version: 2 }), { expectedVersion: 1 });
  assert.equal((await repo.findById({ workspaceId: "ws-1", id: "entry-1" }))?.title, "v2");

  await assert.rejects(
    () => repo.save(entry({ title: "stale", version: 2 }), { expectedVersion: 1 }),
    (error: unknown) => error instanceof VersionConflictError && error.message === "expected version 1 for entry 'entry-1', found 2",
  );
  await assert.rejects(
    () => repo.save(entry({ workspaceId: "ws-2", title: "foreign", version: 3 }), { expectedVersion: 2 }),
    (error: unknown) => error instanceof VersionConflictError && error.message === "expected version 2 for entry 'entry-1', found none",
  );
  await assert.rejects(
    () => repo.save(entry({ id: "missing" }), { expectedVersion: 1 }),
    (error: unknown) => error instanceof VersionConflictError && error.message === "expected version 1 for entry 'missing', found none",
  );
  assert.equal((await repo.findById({ workspaceId: "ws-1", id: "entry-1" }))?.title, "v2");
});

test("findById and findBySlug are workspace-scoped and return copies", async () => {
  const repo = new InMemoryEntryRepo();
  await repo.save(entry());
  await repo.save(entry({ id: "entry-2", slug: "soup" }));

  const bySlug = await repo.findBySlug({ workspaceId: "ws-1", type: "recipe", slug: "soup" });
  assert.equal(bySlug?.id, "entry-2");
  if (bySlug) bySlug.title = "mutated";
  assert.equal((await repo.findById({ workspaceId: "ws-1", id: "entry-2" }))?.title, "Chili");

  assert.equal(await repo.findBySlug({ workspaceId: "ws-1", type: "article", slug: "soup" }), null);
  assert.equal(await repo.findBySlug({ workspaceId: "ws-2", type: "recipe", slug: "soup" }), null);
  assert.equal(await repo.findById({ workspaceId: "ws-2", id: "entry-1" }), null);
  assert.equal(await repo.findById({ workspaceId: "ws-1", id: "nope" }), null);
});

async function seededForListing() {
  const repo = new InMemoryEntryRepo();
  await repo.save(entry({ id: "a", slug: "a", updatedAt: "2026-07-02T00:00:00.000Z" }));
  await repo.save(entry({ id: "b", slug: "b", type: "article", status: "published", updatedAt: "2026-07-03T00:00:00.000Z" }));
  await repo.save(entry({ id: "c", slug: "c", status: "published", updatedAt: "2026-07-01T00:00:00.000Z" }));
  await repo.save(entry({ id: "d", slug: "d", updatedAt: "2026-07-02T00:00:00.000Z" }));
  await repo.save(entry({ id: "z", slug: "z", workspaceId: "ws-2" }));
  return repo;
}

test("listByWorkspace filters by workspace, type, and status", async () => {
  const repo = await seededForListing();

  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" })).map((row) => row.id), ["a", "b", "c", "d"]);
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" }, { type: "recipe" })).map((row) => row.id), ["a", "c", "d"]);
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" }, { status: "published" })).map((row) => row.id), ["b", "c"]);
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" }, { type: "recipe", status: "published" })).map((row) => row.id), ["c"]);
});

test("listByWorkspace orders by updatedAt (descending by default, ties keep insertion order) and applies limit last", async () => {
  const repo = await seededForListing();

  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" }, { orderBy: "updatedAt" })).map((row) => row.id), ["b", "a", "d", "c"]);
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" }, { orderBy: "updatedAt", orderDirection: "desc" })).map((row) => row.id), ["b", "a", "d", "c"]);
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" }, { orderBy: "updatedAt", orderDirection: "asc" })).map((row) => row.id), ["c", "a", "d", "b"]);
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" }, { orderBy: "updatedAt", orderDirection: "asc", limit: 2 })).map((row) => row.id), ["c", "a"]);
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" }, { limit: 0 })), []);
});

test("listByWorkspace hands out copies", async () => {
  const repo = await seededForListing();
  const [first] = await repo.listByWorkspace({ workspaceId: "ws-1" });
  first!.title = "mutated";
  assert.equal((await repo.findById({ workspaceId: "ws-1", id: "a" }))?.title, "Chili");
});

test("transaction runs the callback and resolves to its value", async () => {
  const repo = new InMemoryEntryRepo();
  assert.equal(await repo.transaction({ fn: async () => { await repo.save(entry()); return "done"; } }), "done");
  assert.ok(await repo.findById({ workspaceId: "ws-1", id: "entry-1" }));
});

test("toEntryOutbox stamps a fresh id, the bound workspace, and the clock's time onto each enqueued event", async () => {
  const delivered: unknown[] = [];
  let n = 0;
  const outbox = toEntryOutbox({
    outbox: { enqueue: async (event) => { delivered.push(event); } },
    clock: { nowMs: () => Date.parse("2026-07-15T12:00:00.000Z") },
    idGen: { newId: () => `evt-${++n}` },
    workspaceId: "ws-1",
  });

  await outbox.enqueue({ name: "entry.published", payload: { entryId: "a" } });
  await outbox.enqueue({ name: "entry.unpublished", payload: { entryId: "a" } });

  assert.deepEqual(delivered, [
    { id: "evt-1", workspaceId: "ws-1", name: "entry.published", occurredAt: "2026-07-15T12:00:00.000Z", payload: { entryId: "a" } },
    { id: "evt-2", workspaceId: "ws-1", name: "entry.unpublished", occurredAt: "2026-07-15T12:00:00.000Z", payload: { entryId: "a" } },
  ]);
});
