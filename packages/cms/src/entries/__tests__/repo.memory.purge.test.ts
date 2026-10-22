import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryEntryRepo } from "../repo.memory.js";
import type { EntryRecord } from "../types.js";

test("memory purge respects workspace ownership, removes the slug holder, and permits recreating its id", async () => {
  const repo = new InMemoryEntryRepo();
  const row: EntryRecord = { id: "entry-1", workspaceId: "ws-1", type: "widget", slug: "cleanup", title: "Cleanup",
    fieldsJson: {}, bodyJson: null, status: "draft", publishedAt: null, version: 1, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
  await repo.save(row);
  await repo.save({ ...row, id: "keep", slug: "keep" });
  await repo.hardDelete({ workspaceId: "ws-2", id: row.id });
  assert.deepEqual(await repo.findById({ workspaceId: "ws-1", id: row.id }), row);
  await repo.hardDelete({ workspaceId: "ws-1", id: row.id });
  assert.equal(await repo.findBySlug({ workspaceId: "ws-1", type: "widget", slug: "cleanup" }), null);
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-1" })).map(entry => entry.id), ["keep"]);
  await repo.hardDelete({ workspaceId: "ws-1", id: row.id });
  await repo.save(row, { expectedVersion: null });
  assert.deepEqual(await repo.findById({ workspaceId: "ws-1", id: row.id }), row);
});
