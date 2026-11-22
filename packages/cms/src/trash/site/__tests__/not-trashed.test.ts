import assert from "node:assert/strict";
import { test } from "vitest";
import { buildTrashRegistry } from "../registry.js";
import type { TrashEntityType, TrashEntry, TrashRegistry } from "../../index.js";
import { isTrashedRecord, notTrashed } from "../../sql/index.js";

// F4.3: non-default timestamps and independent status distinguish marker kinds.
test("flat records use the registry's camelCase timestamp or exact status marker", () => {
  const registry = buildTrashRegistry();
  assert.equal(isTrashedRecord({ entityType: "form", record: { deletedAt: "2026-09-29T00:00:00Z" }, registry }), true);
  assert.equal(isTrashedRecord({ entityType: "form", record: { deletedAt: null, status: "trash" }, registry }), false);
  assert.equal(isTrashedRecord({ entityType: "form", record: {}, registry }), false);
  assert.equal(isTrashedRecord({ entityType: "menu", record: { status: "trash", deletedAt: null }, registry }), true);
  assert.equal(isTrashedRecord({ entityType: "menu", record: { status: "draft", deletedAt: "timestamp" }, registry }), false);
  assert.equal(isTrashedRecord({ entityType: "term", record: { status: "active", taxonomyId: "trashed-parent" }, registry }), false, "flat records deliberately report their own marker only");
});

test("an unregistered entity is a composition error for both SQL conditions and flat records", () => {
  const registry = new Map();
  const expected = { message: "trash: 'form' has no TRASHABLE registry entry — register it in registry.ts first." };
  assert.throws(() => notTrashed({ entityType: "form", registry }), expected);
  assert.throws(() => isTrashedRecord({ entityType: "form", record: {}, registry }), expected);
});

test("a parent with a timestamp marker hides its children the moment the parent's timestamp is set", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { Kysely, SqliteDialect } = await import("kysely");
  const base = buildTrashRegistry().get("term")!;
  // A registry entry is plain data: the same term shape, but over a parent soft-deleted by timestamp.
  const registry: TrashRegistry = new Map<TrashEntityType, TrashEntry>([["term", {
    ...base,
    hiddenWithParent: { ...base.hiddenWithParent!, parentMarker: { kind: "timestamp", column: "deleted_at" } },
  }]]);
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE taxonomies (id TEXT PRIMARY KEY, deleted_at TEXT);
    CREATE TABLE terms (id TEXT PRIMARY KEY, taxonomy_id TEXT, status TEXT);
    INSERT INTO taxonomies VALUES ('live-tax', NULL), ('gone-tax', '2026-10-09T00:00:00Z');
    INSERT INTO terms VALUES ('t-live', 'live-tax', 'active'), ('t-orphaned', 'gone-tax', 'active'), ('t-own-trash', 'live-tax', 'trash');`);
  const db = new Kysely<Record<string, Record<string, unknown>>>({ dialect: new SqliteDialect({ database: sqlite }) });
  const rows = await db.selectFrom("terms").select("terms.id").where((eb) => notTrashed({ entityType: "term", registry })(eb)).orderBy("terms.id").execute();
  assert.deepEqual(rows.map((row) => row.id), ["t-live"]);
  await db.destroy();
});
