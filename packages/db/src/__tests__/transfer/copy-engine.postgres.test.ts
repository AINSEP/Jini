import assert from "node:assert/strict";
import { test, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import * as transfer from "../../transfer/index.js";
import type { CopyResult, TransferTable } from "../../transfer/index.js";
import { connectionFor, dropDatabase, recreateDatabase, sql } from "../../testing/transfer-pg-test-db.js";
import { sqliteSnapshotClient } from "../../testing/sqlite-snapshot-client.js";

// Engine cases moved from host; schema and exclusions are explicit fixture policy, never library defaults.
const FIXTURE_DB = `jini_transfer_fixture_${process.pid}`;
const CONNECTION = connectionFor(FIXTURE_DB);
const SITE = "fixture";
const naming = { defaultSchema: "tovu", markerTable: "_tovu_transfer", unvalidatedTable: "pg_temp._tovu_unvalidated", schemaPrefix: "tovu_" };
const TARGET = () => transfer.createPsqlPostgresTarget({ connectionString: CONNECTION });
const inspectTarget = (target: transfer.PostgresTargetPort, site: string) => transfer.inspectTarget({ target, site, naming });
const openSqliteSnapshotSource = (bytes: Buffer) => transfer.openSqliteSnapshotSource({ bytes }, { open: (data, options) => sqliteSnapshotClient({ db: new Database(data, options) }) });
const siteSchemaName = (site: string) => transfer.siteSchemaName({ site, naming });
function migratedDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE menus (id TEXT PRIMARY KEY, workspace_id TEXT, slug TEXT, title TEXT, status TEXT, doc_json TEXT, locations_json TEXT, updated_at TEXT, version INTEGER);
    CREATE TABLE posts (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, slug TEXT, status TEXT, body_json TEXT, updated_at TEXT, version INTEGER, overrides_theme_page INTEGER);
    CREATE TABLE identity_users (principal_id TEXT PRIMARY KEY, workspace_id TEXT, username TEXT, password_hash TEXT);`);
  return db;
}
function fixtureSnapshot(extra?: (db: Database.Database) => void): Buffer {
  const db = migratedDb();
  try {
    extra?.(db);
    db.exec(`INSERT INTO menus VALUES ('menu-1', 'ws', 'main', 'Main', 'published', '{}', '[]', 'x', 1), ('menu-2', 'ws', 'footer', 'Footer', 'draft', '{}', '[]', 'x', 2);
      INSERT INTO posts VALUES ('post-1', 'ws', 'Hello', 'hello', 'draft', '{}', 'x', 1, 1);
      INSERT INTO identity_users VALUES ('p1', 'ws', 'owner', 'hash');`);
    return db.serialize();
  } finally { db.close(); }
}
function collectTransferTables(): TransferTable[] {
  const source = openSqliteSnapshotSource(fixtureSnapshot());
  try { return ["menus", "posts"].map(name => {
    const table = transfer.introspectedTable({ name, layout: source.layout(name)! });
    return { ...table, columns: table.columns.map(column => column.name === "doc_json" ? { ...column, sqlType: "jsonb" } : column) };
  }); } finally { source.close(); }
}
const countSourceRows = (source: transfer.TransferSource, tables: readonly TransferTable[]) => transfer.countSourceRows({ source, tables });
function runCopy(input: { source: transfer.TransferSource; target: transfer.PostgresTargetPort; tables: readonly TransferTable[]; counts: readonly transfer.TableCount[]; schema: string; marker: transfer.CopyMarker; replaceExisting: boolean }) {
  return transfer.runCopy({ sources: [{ name: "fixture", source: input.source, tables: input.tables, counts: input.counts, leftOut: [{ table: "identity_users", reason: "fixture exclusion" }] }], target: input.target, naming, schema: input.schema, marker: input.marker, replaceExisting: input.replaceExisting });
}
async function copyAs(site: string, snapshotAt: string, bytes = fixtureSnapshot()): Promise<{ schema: string; result: CopyResult }> {
  const inspected = await inspectTarget(TARGET(), site);
  assert.ok(inspected.ok && inspected.schema !== null, JSON.stringify(inspected));
  const source = openSqliteSnapshotSource(bytes);
  try {
    const tables = collectTransferTables();
    return { schema: inspected.schema, result: await runCopy({ source, target: TARGET(), tables, counts: countSourceRows(source, tables), schema: inspected.schema, marker: { site, snapshotAt }, replaceExisting: inspected.lastCopy !== null }) };
  } finally { source.close(); }
}
async function copyInto(schema: string, site: string): Promise<CopyResult> {
  const source = openSqliteSnapshotSource(fixtureSnapshot());
  try { const tables = collectTransferTables(); return await runCopy({ source, target: TARGET(), tables, counts: countSourceRows(source, tables), schema, marker: { site, snapshotAt: "x" }, replaceExisting: false }); }
  finally { source.close(); }
}
async function count(table: string, schema: string) { return Number(await sql(FIXTURE_DB, `SELECT count(*) FROM "${schema}"."${table}"`)); }
beforeEach(() => recreateDatabase(FIXTURE_DB));
afterAll(() => dropDatabase(FIXTURE_DB));

test("a re-copy replaces the site's own copy and never appends", async () => {
  const initial = await copyAs(SITE, "original");
  assert.ok(initial.result.ok, JSON.stringify(initial.result));
  const { schema, result } = await copyAs(SITE, "2026-09-27T13:00:00.000Z");
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(schema, "tovu");
  assert.equal(await count("menus", "tovu"), 2);
  assert.equal(await sql(FIXTURE_DB, `SELECT count(*) FROM tovu._tovu_transfer`), "1");
});


test("cross-site wipe regression: a copy aimed at a schema holding ANOTHER site's copy is refused inside the transaction", async () => {
  const initial = await copyAs(SITE, "original");
  assert.ok(initial.result.ok, JSON.stringify(initial.result));
  const refused = await copyInto("tovu", "intruder-site");
  assert.deepEqual(refused, {
    ok: false,
    code: "TARGET_NOT_OURS",
    message: "the destination already has a 'tovu' area that holds other data. Nothing was written, and it was left untouched.",
  });
  assert.equal(await count("menus", "tovu"), 2, "the other site's copy must survive");
  assert.equal(await sql(FIXTURE_DB, `SELECT site FROM tovu._tovu_transfer`), SITE);
});


test("a schema someone else made (no marker) is refused and left untouched, and a new site is given its own schema instead", async () => {
  const initial = await copyAs(SITE, "original");
  assert.ok(initial.result.ok, JSON.stringify(initial.result));
  await sql(FIXTURE_DB, `CREATE SCHEMA tovu_someone; CREATE TABLE tovu_someone.theirs (v text); INSERT INTO tovu_someone.theirs VALUES ('keep me');`);
  const refused = await copyInto("tovu_someone", "someone");
  assert.equal(!refused.ok && refused.code, "TARGET_NOT_OURS");
  assert.equal(await sql(FIXTURE_DB, `SELECT v FROM tovu_someone.theirs`), "keep me");
  assert.equal(await sql(FIXTURE_DB, `SELECT to_regclass('tovu_someone.menus') IS NULL`), "t");

  const inspected = await inspectTarget(TARGET(), "someone");
  assert.equal(inspected.ok && inspected.schemaState, "absent");
  assert.match(inspected.ok ? String(inspected.schema) : "", /^tovu_someone_[0-9a-f]{8}$/, "the readable name is taken, so the hashed one is used");
});


test("two sites share one database: the second gets `tovu_<site>`, each re-copy replaces only its own, and a site keeps its schema after `tovu` frees up", async () => {
  const initial = await copyAs(SITE, "original");
  assert.ok(initial.result.ok, JSON.stringify(initial.result));
  const b = await copyAs("other-site", "2026-09-27T14:00:00.000Z");
  assert.ok(b.result.ok, JSON.stringify(b.result));
  assert.equal(b.schema, "tovu_other_site");
  assert.equal(await count("menus", "tovu_other_site"), 2);

  await sql(FIXTURE_DB, `INSERT INTO tovu_other_site.menus (id, workspace_id, slug, title, status, doc_json, locations_json, updated_at, version) VALUES ('only-in-b', 'ws', 'b', 'B', 'draft', '{}', '[]', 'x', 1)`);
  const a = await copyAs(SITE, "2026-09-27T15:00:00.000Z");
  assert.ok(a.result.ok);
  assert.equal(a.schema, "tovu");
  assert.equal(await count("menus", "tovu_other_site"), 3, "re-copying site A must not touch site B's schema");

  await sql(FIXTURE_DB, `DROP SCHEMA tovu CASCADE`);
  const again = await inspectTarget(TARGET(), "other-site");
  assert.deepEqual(again.ok && [again.schemaState, again.schema, again.lastCopy], ["ours", "tovu_other_site", { site: "other-site", snapshotAt: "2026-09-27T14:00:00.000Z" }]);
});


test("a row Postgres rejects rolls the whole copy back and names only the table", async () => {
  const c = migratedDb();
  let bytes: Buffer;
  try {
    c.prepare("INSERT INTO menus (id, workspace_id, slug, title, status, doc_json, locations_json, updated_at, version) VALUES ('m', 'ws', 's', 't', 'draft', 'not json SECRET-ROW-VALUE', '[]', 'x', 1)").run();
    bytes = c.serialize();
  } finally {
    c.close();
  }
  const { schema, result } = await copyAs("bad-row", "x", bytes);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "COPY_FAILED");
  assert.match(!result.ok ? result.message : "", /menus/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET-ROW-VALUE/);
  assert.equal(await sql(FIXTURE_DB, `SELECT to_regnamespace('${schema}') IS NULL`), "t", "nothing may be left behind");
});


test("a count mismatch or rejected replacement preserves the earlier rows and marker", async () => {
  const original = await copyAs(SITE, "original");
  assert.ok(original.result.ok, JSON.stringify(original.result));
  await sql(FIXTURE_DB, "UPDATE tovu.menus SET title = 'original sentinel' WHERE id = 'menu-1'");
  const replacement = fixtureSnapshot();
  const source = openSqliteSnapshotSource(replacement);
  const tables = collectTransferTables();
  try {
    const counts = countSourceRows(source, tables).map((entry) => entry.table.name === "menus" ? { ...entry, rows: entry.rows + 1 } : entry);
    const result = await runCopy({ source, target: TARGET(), tables, counts, schema: "tovu", marker: { site: SITE, snapshotAt: "replacement" }, replaceExisting: true });
    assert.equal(!result.ok && result.code, "COUNT_MISMATCH");
    assert.match(!result.ok ? result.message : "", /menus/);
  } finally {
    source.close();
  }
  assert.equal(await sql(FIXTURE_DB, "SELECT title FROM tovu.menus WHERE id = 'menu-1'"), "original sentinel");
  assert.equal(await sql(FIXTURE_DB, "SELECT snapshot_at FROM tovu._tovu_transfer"), "original");

  const invalid = fixtureSnapshot((c) => {
    c.prepare("INSERT INTO menus (id, workspace_id, slug, title, status, doc_json, locations_json, updated_at, version) VALUES ('bad', 'ws', 'bad', 'bad', 'draft', 'not json', '[]', 'x', 1)").run();
  });
  const refused = await copyAs(SITE, "rejected", invalid);
  assert.equal(!refused.result.ok && refused.result.code, "COPY_FAILED");
  assert.equal(await count("menus", "tovu"), 2);
  assert.equal(await sql(FIXTURE_DB, "SELECT title FROM tovu.menus WHERE id = 'menu-1'"), "original sentinel");
  assert.equal(await sql(FIXTURE_DB, "SELECT snapshot_at FROM tovu._tovu_transfer"), "original");
});



test("an unconfirmed first-copy plan cannot overwrite a copy created since planning", async () => {
  const original = await copyAs(SITE, "first-copy-sentinel");
  assert.equal(original.result.ok, true);
  const result = await copyInto(original.schema, SITE);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "COPY_FAILED");
  assert.equal(await sql(FIXTURE_DB, "SELECT snapshot_at FROM tovu._tovu_transfer"), "first-copy-sentinel");
  assert.equal(await count("menus", "tovu"), 2);
});
