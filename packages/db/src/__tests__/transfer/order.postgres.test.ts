/** Real Postgres is required: script-order inspection alone cannot prove that a foreign key validates. */
import Database from "better-sqlite3";
import { afterAll, beforeEach, expect, it } from "vitest";
import { createPsqlPostgresTarget, introspectedTable, openSqliteSnapshotSource, runCopy, type TransferSource } from "../../transfer/index.js";
import { connectionFor, dropDatabase, recreateDatabase, sql } from "../../testing/transfer-pg-test-db.js";
import { sqliteSnapshotClient } from "../../testing/sqlite-snapshot-client.js";
const name = `jini_transfer_order_${process.pid}`;
const naming = { defaultSchema: "fixture", markerTable: "_fixture_copy", unvalidatedTable: "pg_temp._fixture_unvalidated", schemaPrefix: "fixture_" };
beforeEach(() => recreateDatabase(name));
afterAll(() => dropDatabase(name));
function snapshot(statement: string): TransferSource {
  const db = new Database(":memory:");
  try { db.exec(statement); return openSqliteSnapshotSource({ bytes: db.serialize() }, { open: (bytes, options) => sqliteSnapshotClient({ db: new Database(bytes, options) }) }); }
  finally { db.close(); }
}
it("copies a child before its parent and leaves the FK validated, reseeds identity, then enforces constraints on new rows", async () => {
  const source = snapshot(`CREATE TABLE parent (id INTEGER PRIMARY KEY, label TEXT DEFAULT 'new');
    CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
    CREATE UNIQUE INDEX label_key ON parent(label);
    INSERT INTO parent VALUES (7, 'old'); INSERT INTO child VALUES (3, 7);`);
  try {
    const tables = ["child", "parent"].map(name => introspectedTable({ name, layout: source.layout(name)! }));
    const result = await runCopy({ sources: [{ name: "fixture", source, tables, leftOut: [] }], target: createPsqlPostgresTarget({ connectionString: connectionFor(name) }), naming, schema: "fixture", marker: { site: "fixture", snapshotAt: "fixed" }, replaceExisting: false });
    expect(result).toEqual({ ok: true, tables: [{ name: "child", rows: 1 }, { name: "parent", rows: 1 }], unvalidatedConstraints: [] });
    expect(await sql(name, "SELECT convalidated FROM pg_constraint WHERE conname = 'child_parent_id_fkey'")).toBe("t");
    expect(await sql(name, "INSERT INTO fixture.parent DEFAULT VALUES RETURNING id, label")).toBe("8\tnew");
    await expect(sql(name, "INSERT INTO fixture.child (parent_id) VALUES (999)")).rejects.toThrow(/violates/);
    await expect(sql(name, "INSERT INTO fixture.parent (label) VALUES ('old')")).rejects.toThrow(/violates/);
  } finally { source.close(); }
});
it("copies both physical sources in one transaction and records both counts in the same marker", async () => {
  const content = snapshot("CREATE TABLE records (id TEXT PRIMARY KEY); INSERT INTO records VALUES ('content')");
  const chat = snapshot("CREATE TABLE conversations (id TEXT PRIMARY KEY); CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id)); INSERT INTO conversations VALUES ('chat'); INSERT INTO messages VALUES ('message', 'chat')");
  try {
    const sources = [["content", content], ["chat", chat]].map(([name, source]) => {
      const physical = source as TransferSource;
      return { name: name as string, source: physical, tables: physical.tableNames().map(name => introspectedTable({ name, layout: physical.layout(name)! })), leftOut: [] };
    });
    const result = await runCopy({ sources, target: createPsqlPostgresTarget({ connectionString: connectionFor(name) }), naming, schema: "fixture", marker: { site: "both", snapshotAt: "fixed" }, replaceExisting: false });
    expect(result.ok).toBe(true);
    expect(await sql(name, "SELECT (table_counts->>'records') || ',' || (table_counts->>'messages') FROM fixture._fixture_copy")).toBe("1,1");
    expect(await sql(name, "SELECT id FROM fixture.messages")).toBe("message");
  } finally { content.close(); chat.close(); }
});
