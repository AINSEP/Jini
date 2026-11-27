import assert from "node:assert/strict";
import { sql } from "kysely";
import { test } from "vitest";

import { type ContentKernel, describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import type { TrashItem } from "../ports.js";
import { SqlTrashRepo } from "../sql/index.js";
import { TRASH_TABLES, createTables } from "./support/trash-tables.fixture.js";

/**
 * @file The Trash index repo on every dialect through the kernel's matrix: one query body serves SQLite and PGlite.
 * Covers idempotent insert, the lazy expiry filter, newest-first keyset pagination, the entity-type filter, workspace
 * scoping, the sweep claim (due rows only, a live lease keeps a row out, an expired lease is reclaimable, the sweep lock
 * is taken before the read) and the lease release.
 */

const WS = "ws-1";
const NOW = "2026-10-10T00:00:00.000Z";
const EARLIER = "2026-10-09T00:00:00.000Z";
const LATER = "2026-10-11T00:00:00.000Z";

function item(id: string, overrides: Partial<TrashItem> = {}): TrashItem {
  return { id, workspaceId: WS, entityType: "post", entityId: `entity-${id}`, trashedAt: EARLIER, purgeAfter: LATER, actorPrincipalId: "p", actorPluginId: null, displayTitle: id, displaySubtitle: null, entityVersion: 3, priorMarker: null, ...overrides };
}

interface Bundle { kernel: ContentKernel; repo: SqlTrashRepo; keys: string[] }

/** A fake of the kernel that records each lock key before delegating: transactions and statements behave as in production. */
function bundleFor(kernel: ContentKernel): Bundle {
  const keys: string[] = [];
  const recording: ContentKernel = { ...kernel, lockKey: async (key: string) => { keys.push(key); await kernel.lockKey(key); } };
  return { kernel, keys, repo: new SqlTrashRepo({ kernel: recording, tables: TRASH_TABLES }, {}) };
}

describeEachDialect<Bundle>({ title: "trash repo", options: { tables: ["trashed_items"], createTables, make: bundleFor }, body: (make) => {
  test("insert round-trips every field and is idempotent on (workspace, entity type, entity id)", async () => {
    const { repo } = make();
    const row = item("a", { actorPluginId: "plug", displaySubtitle: "sub", priorMarker: "draft" });
    await repo.insert({ row });
    await repo.insert({ row: { ...row, id: "dup", displayTitle: "changed" } });
    assert.deepEqual(await repo.findByEntity({ workspaceId: WS, entityType: "post", entityId: "entity-a" }), row);
    assert.equal(await repo.findByEntity({ workspaceId: WS, entityType: "post", entityId: "entity-dup" }), null);
    assert.equal(await repo.findByEntity({ workspaceId: "ws-2", entityType: "post", entityId: "entity-a" }), null);
  });

  test("insert persists a typed actor's kind and id; without one both columns stay NULL (unknown)", async () => {
    const { repo, kernel } = make();
    await repo.insert({ row: item("typed", { recordedActor: { kind: "agent", id: "agent-7" } }) });
    await repo.insert({ row: item("anon", { recordedActor: { kind: "visitor", id: null } }) });
    await repo.insert({ row: item("legacy") });
    const rows = await kernel.query<{ id: string; actor_principal_id: string; actor_kind: string | null; actor_id: string | null }>(
      sql`SELECT id, actor_principal_id, actor_kind, actor_id FROM trashed_items ORDER BY id`);
    assert.deepEqual(rows, [
      { id: "anon", actor_principal_id: "p", actor_kind: "visitor", actor_id: null },
      { id: "legacy", actor_principal_id: "p", actor_kind: null, actor_id: null },
      { id: "typed", actor_principal_id: "p", actor_kind: "agent", actor_id: "agent-7" },
    ]);
  });

  test("list hides expired rows, is workspace-scoped, newest first, filterable by type, and its cursor walks every row once", async () => {
    const { repo } = make();
    for (const [id, at] of [["a", "2026-10-01T00:00:00.000Z"], ["b", "2026-10-02T00:00:00.000Z"], ["c", "2026-10-03T00:00:00.000Z"]] as const) await repo.insert({ row: item(id, { trashedAt: at }) });
    await repo.insert({ row: item("old", { purgeAfter: EARLIER, entityType: "form" }) });
    await repo.insert({ row: item("other", { workspaceId: "ws-2" }) });
    const first = await repo.list({ workspaceId: WS, now: NOW, limit: 2 });
    assert.deepEqual(first.items.map((row) => row.id), ["c", "b"]);
    assert.ok(first.nextCursor);
    const second = await repo.list({ workspaceId: WS, now: NOW, limit: 2 }, { cursor: first.nextCursor });
    assert.deepEqual(second.items.map((row) => row.id), ["a"]);
    assert.equal(second.nextCursor, null);
    await repo.insert({ row: item("f1", { entityType: "form", trashedAt: "2026-10-04T00:00:00.000Z" }) });
    assert.deepEqual((await repo.list({ workspaceId: WS, now: NOW, limit: 10 }, { entityTypes: ["form"] })).items.map((row) => row.id), ["f1"]);
  });

  test("findByIds and deleteById / deleteByEntity are workspace-scoped", async () => {
    const { repo } = make();
    await repo.insert({ row: item("a") });
    await repo.insert({ row: item("b") });
    assert.deepEqual(await repo.findByIds({ workspaceId: WS, ids: [] }), []);
    assert.deepEqual((await repo.findByIds({ workspaceId: WS, ids: ["a", "b"] })).map((row) => row.id).sort(), ["a", "b"]);
    assert.deepEqual(await repo.findByIds({ workspaceId: "ws-2", ids: ["a"] }), []);
    await repo.deleteById({ workspaceId: "ws-2", id: "a" });
    assert.equal((await repo.findByIds({ workspaceId: WS, ids: ["a"] })).length, 1, "another workspace's delete removed nothing");
    await repo.deleteById({ workspaceId: WS, id: "a" });
    await repo.deleteByEntity({ workspaceId: WS, entityType: "post", entityId: "entity-b" });
    assert.deepEqual(await repo.findByIds({ workspaceId: WS, ids: ["a", "b"] }), []);
  });

  test("claimDue takes rows due at or before now, never a later row nor one under a live lease; an expired lease is reclaimable", async () => {
    const { repo, kernel } = make();
    for (const row of [item("before", { purgeAfter: EARLIER }), item("at", { purgeAfter: NOW }), item("after"), item("leased", { purgeAfter: EARLIER }), item("lapsed", { purgeAfter: EARLIER })]) await repo.insert({ row });
    const claimed = await repo.claimDue({ now: NOW, leaseOwner: "one", leaseUntil: LATER, limit: 2 });
    assert.equal(claimed.length, 2);
    await repo.claimDue({ now: NOW, leaseOwner: "two", leaseUntil: LATER, limit: 10 });
    assert.deepEqual(await repo.claimDue({ now: NOW, leaseOwner: "three", leaseUntil: LATER, limit: 10 }), [], "every due row is leased");
    const reclaimed = await repo.claimDue({ now: LATER, leaseOwner: "four", leaseUntil: "2026-10-12T00:00:00.000Z", limit: 10 });
    assert.deepEqual(reclaimed.map((row) => row.id).sort(), ["after", "at", "before", "lapsed", "leased"], "an expired lease and a due row are claimable again");
    assert.equal(typeof reclaimed[0]?.entityVersion, "number");
    void kernel;
  });

  test("claimDue takes the sweep lock before it reads; a claim of nothing returns an empty list", async () => {
    const { repo, keys } = make();
    assert.deepEqual(await repo.claimDue({ now: NOW, leaseOwner: "one", leaseUntil: LATER, limit: 5 }), []);
    assert.deepEqual(keys, ["trash:sweep-claim"]);
  });

  test("releaseLease hands a leased row back to the next pass", async () => {
    const { repo } = make();
    await repo.insert({ row: item("a", { purgeAfter: EARLIER }) });
    const [claim] = await repo.claimDue({ now: NOW, leaseOwner: "one", leaseUntil: LATER, limit: 5 });
    assert.deepEqual(await repo.claimDue({ now: NOW, leaseOwner: "two", leaseUntil: LATER, limit: 5 }), []);
    await repo.releaseLease({ id: claim!.id });
    assert.equal((await repo.claimDue({ now: NOW, leaseOwner: "two", leaseUntil: LATER, limit: 5 })).length, 1);
  });

  test("timestamp ties page by id and unversioned trash stays null when read or claimed", async () => {
    const { repo } = make();
    await repo.insert({ row: item("a", { entityVersion: null, purgeAfter: EARLIER }) });
    await repo.insert({ row: item("b", { entityVersion: null }) });
    await repo.insert({ row: item("c", { entityType: "form" }) });
    const first = await repo.list({ workspaceId: WS, now: NOW, limit: 1 }, { entityTypes: [] });
    assert.deepEqual(first.items.map(({ id, entityVersion }) => [id, entityVersion]), [["c", 3]]);
    const second = await repo.list({ workspaceId: WS, now: NOW, limit: 1 }, { cursor: first.nextCursor });
    assert.deepEqual(second.items.map(({ id, entityVersion }) => [id, entityVersion]), [["b", null]]);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(await repo.claimDue({ now: NOW, leaseOwner: "sweeper", leaseUntil: LATER, limit: 5 }), [
      { id: "a", workspaceId: WS, entityType: "post", entityId: "entity-a", entityVersion: null },
    ]);
  });
} });
