import assert from "node:assert/strict";
import { sql } from "kysely";
import { test } from "vitest";

import { type ContentKernel, describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import type { TrashEntityType } from "../ports.js";
import type { TrashEntry, TrashRegistry } from "../registry-types.js";
import { entryWhere, isTrashedRecord, loose, notTrashed, readLiveSnapshot } from "../sql/index.js";

/**
 * @file The Trash SQL kit on every dialect: `notTrashed` as a real `WHERE` per marker kind (a timestamp marker, a status
 * marker, hidden-with-parent over a live, trashed and NULL parent), its flat-record twin `isTrashedRecord`,
 * `readLiveSnapshot` (a live row, never a trashed one) and `entryWhere`'s fixed scope predicate. Registry entries are plain
 * data, so each test builds the ones it needs over its own tables.
 */

const entry = (over: Partial<TrashEntry> & Pick<TrashEntry, "entityType" | "table" | "marker">): TrashEntry =>
  ({ label: over.entityType, permission: "x.delete", idColumn: "id", workspaceColumn: "workspace_id", display: { title: `${over.table}.id` }, ...over });

const STATUS = { kind: "status", column: "status", trashed: "trash", restoreFallback: "active" } as const;
const timestamp = entry({ entityType: "form", table: "t_ts", marker: { kind: "timestamp", column: "deleted_at" } });
const status = entry({ entityType: "menu", table: "t_st", marker: STATUS });
const child = entry({ entityType: "term", table: "t_child", marker: STATUS, hiddenWithParent: { parentTable: "t_parent", parentIdColumn: "parent_id", parentPkColumn: "id", parentMarker: STATUS } });
const widget = entry({ entityType: "widget", table: "t_items", marker: { kind: "timestamp", column: "deleted_at" }, versionColumn: "version",
  scope: { column: "kind", equals: "widget" }, display: { title: "t_items.title", subtitle: "t_items.slug" } });
const registry: TrashRegistry = new Map<TrashEntityType, TrashEntry>([["form", timestamp], ["menu", status], ["term", child], ["widget", widget]]);

async function createTables(kernel: ContentKernel): Promise<void> {
  for (const statement of [
    "CREATE TABLE t_ts (id TEXT PRIMARY KEY, workspace_id TEXT, deleted_at TEXT)",
    "CREATE TABLE t_st (id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT)",
    "CREATE TABLE t_parent (id TEXT PRIMARY KEY, status TEXT)",
    "CREATE TABLE t_child (id TEXT PRIMARY KEY, workspace_id TEXT, parent_id TEXT, status TEXT)",
    "CREATE TABLE t_items (id TEXT PRIMARY KEY, workspace_id TEXT, kind TEXT, title TEXT, slug TEXT, version INTEGER, deleted_at TEXT)",
  ]) await kernel.execute(sql.raw(statement));
}

describeEachDialect<ContentKernel>({ title: "trash sql kit", options: { tables: ["t_ts", "t_st", "t_parent", "t_child", "t_items"], createTables, make: (kernel) => kernel }, body: (make) => {
  const ids = (kernel: ContentKernel, table: string, type: TrashEntityType) =>
    kernel.run((db) => loose(db).selectFrom(table).select(`${table}.id`).where((eb) => notTrashed({ entityType: type, registry })(eb)).orderBy(`${table}.id`).execute()).then((rows) => rows.map((row) => String(row.id)));

  test("notTrashed, as a real WHERE: a timestamp marker, a status marker, and hidden-with-parent over a live, trashed and NULL parent", async () => {
    const kernel = make();
    await kernel.execute(sql.raw("INSERT INTO t_ts VALUES ('live', 'w', NULL), ('gone', 'w', '2026-10-09')"));
    await kernel.execute(sql.raw("INSERT INTO t_st VALUES ('live', 'w', 'draft'), ('gone', 'w', 'trash')"));
    await kernel.execute(sql.raw("INSERT INTO t_parent VALUES ('p-live', 'active'), ('p-gone', 'trash')"));
    await kernel.execute(sql.raw("INSERT INTO t_child VALUES ('c-live', 'w', 'p-live', 'active'), ('c-own', 'w', 'p-live', 'trash'), ('c-orphan', 'w', 'p-gone', 'active'), ('c-null', 'w', NULL, 'active')"));
    assert.deepEqual(await ids(kernel, "t_ts", "form"), ["live"]);
    assert.deepEqual(await ids(kernel, "t_st", "menu"), ["live"]);
    // A NULL parent id has no parent row, so `NOT EXISTS` is true: the child reads as live.
    assert.deepEqual(await ids(kernel, "t_child", "term"), ["c-live", "c-null"]);
  });

  test("readLiveSnapshot returns a live row's title, subtitle and version, and null for a trashed row or another workspace", async () => {
    const kernel = make();
    await kernel.execute(sql.raw("INSERT INTO t_items VALUES ('live', 'w', 'widget', 'Title live', 'slug-live', 3, NULL), ('gone', 'w', 'widget', 'Title gone', 'slug-gone', 1, '2026-10-09')"));
    assert.deepEqual(await readLiveSnapshot({ entry: widget, workspaceId: "w", entityId: "live" }, { kernel, registry }), { title: "Title live", subtitle: "slug-live", version: 3 });
    assert.equal(await readLiveSnapshot({ entry: widget, workspaceId: "w", entityId: "gone" }, { kernel, registry }), null);
    assert.equal(await readLiveSnapshot({ entry: widget, workspaceId: "w2", entityId: "live" }, { kernel, registry }), null);
  });

  test("entryWhere keeps the entry's fixed scope: a widget entry cannot address a row of another kind by id", async () => {
    const kernel = make();
    await kernel.execute(sql.raw("INSERT INTO t_items VALUES ('w1', 'w', 'widget', 'a', 'a', 1, NULL), ('r1', 'w', 'recipe', 'b', 'b', 1, NULL)"));
    assert.equal(await readLiveSnapshot({ entry: widget, workspaceId: "w", entityId: "r1" }, { kernel, registry }), null);
    const hits = await kernel.run((db) => loose(db).selectFrom("t_items").select("t_items.id").where((eb) => entryWhere({ eb, entry: widget, workspaceId: "w", entityId: "r1" })).execute());
    assert.deepEqual(hits, []);
  });

  test("a joined snapshot omits undeclared fields and hides the child of a timestamp-trashed parent", async () => {
    const kernel = make();
    const joined = entry({ entityType: "term", table: "t_child", marker: STATUS,
      display: { title: "t_ts.id", join: { table: "t_ts", on: ["t_ts.id", "t_child.parent_id"] } },
      hiddenWithParent: { parentTable: "t_ts", parentIdColumn: "parent_id", parentPkColumn: "id", parentMarker: { kind: "timestamp", column: "deleted_at" } },
    });
    const localRegistry: TrashRegistry = new Map([["term", joined]]);
    await kernel.execute(sql.raw("INSERT INTO t_ts VALUES ('parent-live', 'w', NULL), ('parent-trashed', 'w', '2026-10-09')"));
    await kernel.execute(sql.raw("INSERT INTO t_child VALUES ('live', 'w', 'parent-live', 'active'), ('hidden', 'w', 'parent-trashed', 'active'), ('missing-parent', 'w', 'absent', 'active')"));
    const snapshot = (entityId: string) => readLiveSnapshot({ entry: joined, workspaceId: "w", entityId }, { kernel, registry: localRegistry });
    assert.deepEqual(await snapshot("live"), { title: "parent-live" });
    assert.equal(await snapshot("hidden"), null);
    assert.equal(await snapshot("missing-parent"), null);
  });
} });

test("flat records use the registry's camelCase timestamp or exact status marker", () => {
  assert.equal(isTrashedRecord({ entityType: "form", record: { deletedAt: "2026-09-29T00:00:00Z" }, registry }), true);
  assert.equal(isTrashedRecord({ entityType: "form", record: { deletedAt: null, status: "trash" }, registry }), false);
  assert.equal(isTrashedRecord({ entityType: "form", record: {}, registry }), false);
  assert.equal(isTrashedRecord({ entityType: "menu", record: { status: "trash", deletedAt: null }, registry }), true);
  assert.equal(isTrashedRecord({ entityType: "menu", record: { status: "draft", deletedAt: "timestamp" }, registry }), false);
  assert.equal(isTrashedRecord({ entityType: "term", record: { status: "active", parentId: "trashed-parent" }, registry }), false, "flat records report their own marker only");
});

test("an unregistered entity is a composition error for both SQL conditions and flat records", () => {
  const empty: TrashRegistry = new Map();
  const expected = { message: "trash: 'form' has no TRASHABLE registry entry — register it in registry.ts first." };
  assert.throws(() => notTrashed({ entityType: "form", registry: empty }), expected);
  assert.throws(() => isTrashedRecord({ entityType: "form", record: {}, registry: empty }), expected);
});
