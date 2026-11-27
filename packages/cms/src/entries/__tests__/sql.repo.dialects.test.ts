import assert from "node:assert/strict";
import { sql } from "kysely";
import { test } from "vitest";

import { type ContentKernel, describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import type { CollectionListQuery } from "../../widgets/resolvers/ports.js";
import { EntrySlugConflictError, VersionConflictError } from "../errors.js";
import { SqlEntryRepo } from "../sql/index.js";
import type { EntryRecord } from "../types.js";
import { ENTRY_TABLES, createTables, jsonPortFor } from "./support/entry-tables.fixture.js";

/**
 * @file The entry SQL repo on every dialect through the kernel's matrix: one query body serves SQLite and PGlite.
 * Covers workspace scoping, the revision trail, the transaction, the Trash, the slug conflict, both compare-and-set
 * forms, `listPublishedForDisplay`'s `where` / `sort` / `offset`, and the write-settled hook the host binds.
 */

const NOW = "2026-09-23T00:00:00.000Z";
const WS = "ws-1";

function entry(id: string, overrides: Partial<EntryRecord> = {}, site: Record<string, unknown> = {}): EntryRecord {
  return { id, workspaceId: WS, type: "recipe", slug: id, status: "published", title: id, bodyJson: null, fieldsJson: { ext: { site } }, publishedAt: NOW, createdAt: NOW, updatedAt: NOW, version: 1, ...overrides };
}

const query = (overrides: Partial<CollectionListQuery>): CollectionListQuery => ({ type: "recipe", where: [], sort: { by: "title", dir: "asc" }, limit: 10, ...overrides });
const ids = (rows: EntryRecord[]) => rows.map((row) => row.id);

interface Bundle { kernel: ContentKernel; repo: SqlEntryRepo; settled: object[] }

function bundleFor(kernel: ContentKernel): Bundle {
  const settled: object[] = [];
  const repo = new SqlEntryRepo({ kernel, tables: ENTRY_TABLES, json: jsonPortFor(kernel), onWriteSettled: ({ repo: written }) => { settled.push(written); } }, {});
  return { kernel, repo, settled };
}

/** The Trash marker is set by the Trash, not by this repo, so the test sets it directly. */
function trash(kernel: ContentKernel, id: string): Promise<void> {
  return kernel.execute(sql`UPDATE entries SET deleted_at = '2026-09-23T01:00:00.000Z' WHERE id = ${id}`);
}

describeEachDialect<Bundle>({ title: "entry repo", options: { tables: ["entries", "entry_revisions"], createTables, make: bundleFor }, body: (make) => {
  test("save round-trips every field and the reads are scoped to the workspace", async () => {
    const { repo } = make();
    const saved = entry("e1", { bodyJson: { type: "doc" }, status: "draft", publishedAt: null }, { chef: "Ana" });
    await repo.save(saved);
    await repo.save(entry("e2", { workspaceId: "ws-2", slug: "e1", id: "e2" }));
    assert.deepEqual(await repo.findById({ workspaceId: WS, id: "e1" }), saved);
    assert.deepEqual(await repo.findBySlug({ workspaceId: WS, type: "recipe", slug: "e1" }), saved);
    assert.equal(await repo.findById({ workspaceId: "ws-2", id: "e1" }), null);
    assert.equal((await repo.findBySlug({ workspaceId: "ws-2", type: "recipe", slug: "e1" }))?.id, "e2");
    assert.deepEqual((await repo.findAnyById({ workspaceId: WS, id: "e1" })), { ...saved, deletedAt: null });
    assert.equal(await repo.findAnyById({ workspaceId: "ws-2", id: "e1" }), null);
    assert.equal(await repo.findAnyBySlug({ workspaceId: "ws-2", type: "recipe", slug: "absent" }), null);
  });

  test("a second plain save replaces the row", async () => {
    const { repo } = make();
    await repo.save(entry("e1"));
    await repo.save(entry("e1", { title: "Changed", version: 2 }));
    assert.equal((await repo.findById({ workspaceId: WS, id: "e1" }))?.title, "Changed");
    assert.deepEqual(ids(await repo.listByWorkspace({ workspaceId: WS })), ["e1"]);
  });

  test("Trash: reads hide a trashed row, findAny* see it, a plain save never revives it, its slug blocks a new entry", async () => {
    const { repo, kernel } = make();
    await repo.save(entry("t1"));
    await repo.save(entry("live"));
    await trash(kernel, "t1");
    assert.equal(await repo.findById({ workspaceId: WS, id: "t1" }), null);
    assert.equal(await repo.findBySlug({ workspaceId: WS, type: "recipe", slug: "t1" }), null);
    assert.deepEqual(ids(await repo.listByWorkspace({ workspaceId: WS })), ["live"]);
    assert.equal((await repo.findAnyById({ workspaceId: WS, id: "t1" }))?.deletedAt, "2026-09-23T01:00:00.000Z");
    assert.equal((await repo.findAnyBySlug({ workspaceId: WS, type: "recipe", slug: "t1" }))?.id, "t1");
    await repo.save(entry("t1", { title: "revived", version: 2 }));
    assert.equal((await repo.findAnyById({ workspaceId: WS, id: "t1" }))?.title, "t1");
    await assert.rejects(repo.save(entry("other", { slug: "t1" })), (error: unknown) => error instanceof EntrySlugConflictError && /is in the Trash/.test((error as Error).message));
  });

  test("a compare-and-set save lands on the matching version and refuses a stale, trashed or missing row", async () => {
    const { repo, kernel } = make();
    await repo.save(entry("e1"));
    await repo.save(entry("e1", { title: "First", version: 2 }), { expectedVersion: 1 });
    await assert.rejects(repo.save(entry("e1", { title: "Stale", version: 2 }), { expectedVersion: 1 }), (error: unknown) => error instanceof VersionConflictError && (error as Error).message === "expected version 1 for entry 'e1', found 2");
    await assert.rejects(repo.save(entry("nope"), { expectedVersion: 1 }), { message: "expected version 1 for entry 'nope', found none" });
    await trash(kernel, "e1");
    await assert.rejects(repo.save(entry("e1", { version: 3 }), { expectedVersion: 2 }), VersionConflictError);
    assert.equal((await repo.findAnyById({ workspaceId: WS, id: "e1" }))?.title, "First");
  });

  test("a create-only save (expectedVersion: null) lands only when the id is free and tells the two refusals apart", async () => {
    const { repo, kernel } = make();
    await repo.save(entry("e1"), { expectedVersion: null });
    await assert.rejects(repo.save(entry("e1", { title: "Again" }), { expectedVersion: null }), { message: "expected no entry 'e1', found 1" });
    await trash(kernel, "e1");
    await assert.rejects(repo.save(entry("e1"), { expectedVersion: null }), VersionConflictError);
    await assert.rejects(repo.save(entry("e3", { slug: "e1" }), { expectedVersion: null }), EntrySlugConflictError);
  });

  test("a database failure is propagated unchanged rather than translated into a slug conflict", async () => {
    const { kernel } = make();
    const failure = new Error("database connection closed");
    const broken = new SqlEntryRepo({ kernel: { ...kernel, run: async () => { throw failure; } }, tables: ENTRY_TABLES, json: jsonPortFor(kernel), onWriteSettled: () => undefined }, {});
    await assert.rejects(broken.save(entry("e1")), (error) => error === failure);
  });

  test("appendRevision persists the full audit payload", async () => {
    const { repo, kernel } = make();
    await repo.appendRevision({ entryId: "e1", workspaceId: WS, op: "create", stateJson: entry("e1"), actorId: "a", delegatedByWorkspaceId: "dw", delegatedById: "di", recordedAt: NOW });
    const rows = await kernel.run((db) => db.withTables<Record<string, { entry_id: string; op: string; state_json: string; actor_id: string; delegated_by_workspace_id: string | null; delegated_by_id: string | null; recorded_at: string }>>().selectFrom(ENTRY_TABLES.revisions).selectAll().execute());
    assert.deepEqual(rows.map((row) => [row.entry_id, row.op, JSON.parse(row.state_json), row.actor_id, row.delegated_by_workspace_id, row.delegated_by_id, row.recorded_at]), [["e1", "create", entry("e1"), "a", "dw", "di", NOW]]);
  });

  test("a transaction's save rolls back as a whole; a nested one joins", async () => {
    const { repo } = make();
    await assert.rejects(repo.transaction({ fn: async () => { await repo.save(entry("t1")); await repo.transaction({ fn: async () => repo.save(entry("t2")) }); throw new Error("boom"); } }), /boom/);
    assert.deepEqual(await repo.listByWorkspace({ workspaceId: WS }), []);
    await repo.transaction({ fn: async () => repo.transaction({ fn: async () => repo.save(entry("t3")) }) });
    assert.deepEqual(ids(await repo.listByWorkspace({ workspaceId: WS })), ["t3"]);
  });

  test("onWriteSettled gets the repository after every save and transaction, success or failure, and never on a read", async () => {
    const { repo, settled } = make();
    await repo.save(entry("e1"));
    assert.deepEqual(settled, [repo]);
    await assert.rejects(repo.save(entry("e1", { version: 2 }), { expectedVersion: 9 }), VersionConflictError);
    assert.equal(settled.length, 2);
    await repo.transaction({ fn: async () => "ok" });
    await assert.rejects(repo.transaction({ fn: async () => { throw new Error("boom"); } }), /boom/);
    assert.equal(settled.length, 4);
    await repo.findById({ workspaceId: WS, id: "e1" });
    await repo.listByWorkspace({ workspaceId: WS });
    assert.equal(settled.length, 4);
    assert.ok(settled.every((written) => written === repo));
  });

  test("workspace lists narrow by type, order by updatedAt, honour status and limit; excluded types go before the limit", async () => {
    const { repo } = make();
    await repo.save(entry("early", { updatedAt: "2026-09-22T00:00:00.000Z" }));
    await repo.save(entry("late", { updatedAt: "2026-09-24T00:00:00.000Z" }));
    await repo.save(entry("draft", { status: "draft", updatedAt: "2026-09-25T00:00:00.000Z" }));
    await repo.save(entry("w1", { type: "widget", updatedAt: "2026-09-26T00:00:00.000Z" }));
    assert.deepEqual(ids(await repo.listByWorkspace({ workspaceId: WS }, { type: "recipe", status: "published", orderBy: "updatedAt" })), ["late", "early"]);
    assert.deepEqual(ids(await repo.listByWorkspace({ workspaceId: WS }, { type: "recipe", orderBy: "updatedAt", limit: 1 })), ["draft"]);
    assert.deepEqual(ids(await repo.listByWorkspaceExcludingTypes({ workspaceId: WS, excludeTypes: ["widget"], status: "published", orderBy: "updatedAt", orderDirection: "asc", limit: 1 })), ["early"]);
    assert.deepEqual(await repo.listByWorkspace({ workspaceId: WS }, { type: "absent" }), []);
    assert.deepEqual(ids(await repo.listByWorkspace({ workspaceId: "ws-2" })), []);
  });

  test("an empty type exclusion leaves workspace types intact and applies explicit ascending order", async () => {
    const { repo } = make();
    await repo.save(entry("later-recipe", { updatedAt: "2026-09-26T00:00:00Z" }));
    await repo.save(entry("earlier-widget", { type: "widget", updatedAt: "2026-09-24T00:00:00Z" }));
    await repo.save(entry("elsewhere", { workspaceId: "ws-2", updatedAt: "2026-09-23T00:00:00Z" }));
    const filters = { workspaceId: WS, orderBy: "updatedAt", orderDirection: "asc" } as const;
    assert.deepEqual(ids(await repo.listByWorkspaceExcludingTypes({ ...filters, excludeTypes: [] })), ["earlier-widget", "later-recipe"]);
    assert.deepEqual(ids(await repo.listByWorkspaceExcludingTypes({ ...filters, excludeTypes: ["widget"] })), ["later-recipe"]);
  });

  test("listPublishedForDisplay: where equality matches string, number and boolean values and nothing else", async () => {
    const { repo } = make();
    await repo.save(entry("a", {}, { chef: "Ana", prep: 10, veg: true }));
    await repo.save(entry("b", {}, { chef: "Bo", prep: 9, veg: false }));
    await repo.save(entry("c", { status: "draft" }, { chef: "Ana" }));
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ where: [{ field: "chef", value: "Ana" }] }) })), ["a"]);
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ where: [{ field: "prep", value: 10 }] }) })), ["a"]);
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ where: [{ field: "veg", value: false }] }) })), ["b"]);
    assert.deepEqual(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ where: [{ field: "prep", value: "10" }] }) }), []);
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ where: [{ field: "chef", value: "O'Neil" }] }) })), []);
  });

  test("listPublishedForDisplay: sorts a numeric field numerically, missing first ascending and last descending, ties by id", async () => {
    const { repo } = make();
    await repo.save(entry("r-10", {}, { prep: 10 }));
    await repo.save(entry("r-2", {}, { prep: 2 }));
    await repo.save(entry("r-9", {}, { prep: 9 }));
    await repo.save(entry("r-none", {}, {}));
    const sorted = (dir: "asc" | "desc") => repo.listPublishedForDisplay({ workspaceId: WS, query: query({ sort: { by: { field: "prep" }, dir } }) }).then(ids);
    assert.deepEqual(await sorted("asc"), ["r-none", "r-2", "r-9", "r-10"]);
    assert.deepEqual(await sorted("desc"), ["r-10", "r-9", "r-2", "r-none"]);
    for (const id of ["z-2", "z-1"]) await repo.save(entry(id, { title: "Same" }));
    assert.deepEqual((await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ sort: { by: "title", dir: "asc" }, where: [] }) })).filter((row) => row.title === "Same").map((row) => row.id), ["z-1", "z-2"]);
  });

  test("listPublishedForDisplay: built-in sort keys, the limit and an explicit offset after stable ordering", async () => {
    const { repo } = make();
    await repo.save(entry("r-1", { title: "B", publishedAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z" }));
    await repo.save(entry("r-2", { title: "A", publishedAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" }));
    await repo.save(entry("r-3", { title: "C", publishedAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }));
    const by = (key: "published" | "updated" | "title", dir: "asc" | "desc") => repo.listPublishedForDisplay({ workspaceId: WS, query: query({ sort: { by: key, dir } }) }).then(ids);
    assert.deepEqual(await by("published", "asc"), ["r-3", "r-1", "r-2"]);
    assert.deepEqual(await by("updated", "desc"), ["r-1", "r-2", "r-3"]);
    assert.deepEqual(await by("title", "desc"), ["r-3", "r-1", "r-2"]);
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ limit: 2 }) })), ["r-2", "r-1"]);
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ offset: 1, limit: 1 }) })), ["r-1"]);
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ offset: 0, limit: 1 }) })), ["r-2"]);
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ offset: 5 }) })), []);
  });

  test("listPublishedForDisplay: excludes drafts, trashed rows, other types and other workspaces", async () => {
    const { repo, kernel } = make();
    await repo.save(entry("ok"));
    await repo.save(entry("draft", { status: "draft" }));
    await repo.save(entry("gone"));
    await repo.save(entry("other-type", { type: "widget" }));
    await repo.save(entry("foreign", { workspaceId: "ws-2" }));
    await trash(kernel, "gone");
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({}) })), ["ok"]);
  });

  test("listPublishedForDisplay: a field name that cannot be a path key matches nothing and sorts as nothing, without throwing", async () => {
    const { repo } = make();
    await repo.save(entry("a", {}, { "a-b": "v" }));
    await repo.save(entry("b", {}, {}));
    assert.deepEqual(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ where: [{ field: "a-b", value: "v" }] }) }), []);
    assert.deepEqual(ids(await repo.listPublishedForDisplay({ workspaceId: WS, query: query({ sort: { by: { field: "a-b'; DROP TABLE entries; --" }, dir: "asc" } }) })), ["a", "b"]);
  });
} });
