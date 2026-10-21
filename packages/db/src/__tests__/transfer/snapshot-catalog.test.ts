/**
 * The SQLite snapshot's declared layout (`openSqliteSnapshotSource`) and how the table catalog turns it
 * into copied tables and left-out reasons (`introspectedTable`, `planSnapshotTables`). Layouts are read
 * from a real in-memory better-sqlite3 database through the structural snapshot port.
 */
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { introspectedTable, LEFT_OUT_REASON, openSqliteSnapshotSource, planSnapshotTables, type SnapshotClient, type SnapshotTablePolicy, type SourceTableLayout, type TransferSource, type TransferTable } from "../../transfer/index.js";
import { sqliteSnapshotClient } from "../../testing/sqlite-snapshot-client.js";

const open: TransferSource[] = [];
afterEach(() => { for (const source of open.splice(0)) source.close(); });

function snapshotOf(sql: string): TransferSource {
  const original = new Database(":memory:");
  try {
    original.exec(sql);
    const source = openSqliteSnapshotSource({ bytes: original.serialize() }, { open: (bytes, options) => sqliteSnapshotClient({ db: new Database(bytes, options) }) });
    open.push(source);
    return source;
  } finally { original.close(); }
}

const SCHEMA = `
  CREATE TABLE parents (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE);
  CREATE TABLE pairs (a TEXT, b TEXT, PRIMARY KEY (b, a));
  CREATE TABLE children (
    id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id) ON DELETE CASCADE, a TEXT, b TEXT,
    FOREIGN KEY (a, b) REFERENCES pairs ON UPDATE SET NULL
  );
  CREATE INDEX children_parent ON children(parent_id);
  CREATE INDEX children_partial ON children(a) WHERE a IS NOT NULL;
  CREATE INDEX children_expr ON children(lower(b));
  CREATE VIRTUAL TABLE search USING fts5(body);
  INSERT INTO parents VALUES (1, 'one'), (2, 'two'), (3, 'three');
`;

it("reads a table's declared columns, grouped foreign keys and every index kind", () => {
  const source = snapshotOf(SCHEMA);
  const children = source.layout("children")!;
  expect(children.virtual).toBe(false);
  expect(children.columns).toEqual([
    { name: "id", declaredType: "INTEGER", notNull: false, defaultSql: null, primaryKeyPosition: 1 },
    { name: "parent_id", declaredType: "INTEGER", notNull: false, defaultSql: null, primaryKeyPosition: 0 },
    { name: "a", declaredType: "TEXT", notNull: false, defaultSql: null, primaryKeyPosition: 0 },
    { name: "b", declaredType: "TEXT", notNull: false, defaultSql: null, primaryKeyPosition: 0 },
  ]);
  expect(children.foreignKeys).toEqual(expect.arrayContaining([
    { columns: ["parent_id"], foreignTable: "parents", foreignColumns: ["id"], onDelete: "CASCADE", onUpdate: "NO ACTION" },
    { columns: ["a", "b"], foreignTable: "pairs", foreignColumns: [null, null], onDelete: "NO ACTION", onUpdate: "SET NULL" },
  ]));
  expect(children.foreignKeys).toHaveLength(2);
  const byName = new Map(children.indexes.map(index => [index.name, index]));
  expect(byName.get("children_parent")).toEqual({ name: "children_parent", unique: false, origin: "c", partial: false, columns: ["parent_id"] });
  expect(byName.get("children_partial")).toMatchObject({ partial: true, columns: ["a"] });
  expect(byName.get("children_expr")).toMatchObject({ partial: false, columns: [null] });
  expect(source.layout("pairs")!.indexes).toEqual([{ name: "sqlite_autoindex_pairs_1", unique: true, origin: "pk", partial: false, columns: ["b", "a"] }]);
  expect(source.layout("parents")!.indexes).toEqual([{ name: "sqlite_autoindex_parents_1", unique: true, origin: "u", partial: false, columns: ["code"] }]);
});

it("reports a virtual table without keys or indexes, and no layout or columns for a missing table", () => {
  const source = snapshotOf(SCHEMA);
  expect(source.layout("search")).toEqual({ virtual: true, columns: [{ name: "body", declaredType: "", notNull: false, defaultSql: null, primaryKeyPosition: 0 }], foreignKeys: [], indexes: [] });
  expect(source.layout("missing")).toBeNull();
  expect(source.columns("missing")).toBeNull();
});

it("counts every row, or only the rows a trusted keep predicate selects", () => {
  const source = snapshotOf(SCHEMA);
  expect(source.countRows("parents")).toBe(3);
  expect(source.countRows("parents", "id > 1")).toBe(2);
  expect([...source.rows("parents", ["code"], "id = 2")]).toEqual([["two"]]);
});

it("treats a table whose stored definition is absent as an ordinary (non-virtual) table", () => {
  // The structural port may answer `sql: null`; only a CREATE VIRTUAL TABLE statement marks a virtual table.
  const client: SnapshotClient = {
    prepare: sql => ({
      all: () => sql.startsWith("PRAGMA table_info") ? [{ name: "id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 }] : [],
      get: () => ({ sql: null }), raw() { return this; }, safeIntegers() { return this; }, iterate: () => [],
    }),
    close: () => {},
  };
  const source = openSqliteSnapshotSource({ bytes: Buffer.alloc(32) }, { open: () => client });
  expect(source.layout("legacy")).toEqual({ virtual: false, columns: [{ name: "id", declaredType: "INTEGER", notNull: true, defaultSql: null, primaryKeyPosition: 1 }], foreignKeys: [], indexes: [] });
});

it("introspects a snapshot table into Postgres columns, keys and indexes", () => {
  const source = snapshotOf(SCHEMA);
  expect(introspectedTable({ name: "children", layout: source.layout("children")! })).toEqual({
    name: "children",
    columns: [
      { name: "id", sqlType: "bigint", notNull: true, identity: "BY DEFAULT" },
      { name: "parent_id", sqlType: "bigint", notNull: false },
      { name: "a", sqlType: "text", notNull: false },
      { name: "b", sqlType: "text", notNull: false },
    ],
    primaryKey: ["id"],
    // The partial and the expression index stay behind: Postgres cannot rebuild them from this layout.
    indexes: [{ name: "children_parent", columns: ["parent_id"], unique: false }],
    foreignKeys: expect.arrayContaining([
      { name: "children_parent_id_fkey", columns: ["parent_id"], foreignTable: "parents", foreignColumns: ["id"], onDelete: "cascade", onUpdate: "no action" },
      { name: "children_a_b_fkey", columns: ["a", "b"], foreignTable: "pairs", foreignColumns: null, onDelete: "no action", onUpdate: "set null" },
    ]),
    checks: [],
  } satisfies TransferTable);
  const pairs = introspectedTable({ name: "pairs", layout: source.layout("pairs")! });
  expect(pairs.primaryKey).toEqual(["b", "a"]);
  expect(pairs.indexes).toEqual([]);
  expect(pairs.columns.every(column => column.identity === undefined && column.notNull)).toBe(true);
  expect(introspectedTable({ name: "parents", layout: source.layout("parents")! }).indexes).toEqual([{ name: "parents_code_key", columns: ["code"], unique: true }]);
});

it("maps declared types by SQLite affinity and keeps only plain literal defaults", () => {
  const column = (name: string, declaredType: string, defaultSql: string | null) => ({ name, declaredType, notNull: false, defaultSql, primaryKeyPosition: 0 });
  const layout: SourceTableLayout = { virtual: false, foreignKeys: [], indexes: [], columns: [
    column("big", "unsigned big int", "-12"), column("name", "VARCHAR(20)", "'it''s'"), column("body", "CLOB", "upper('x')"),
    column("blob", "BLOB", "x'00'"), column("ratio", "REAL", "1.5"), column("f", "FLOAT", null), column("d", "DOUBLE", null),
    column("plain", "", "CURRENT_TIMESTAMP"), column("numeric", "NUMERIC", " 7 "),
  ] };
  expect(introspectedTable({ name: "t", layout }).columns).toEqual([
    { name: "big", sqlType: "bigint", notNull: false, default: "-12" },
    { name: "name", sqlType: "text", notNull: false, default: "'it''s'" },
    { name: "body", sqlType: "text", notNull: false },
    { name: "blob", sqlType: "bytea", notNull: false },
    { name: "ratio", sqlType: "double precision", notNull: false, default: "1.5" },
    { name: "f", sqlType: "double precision", notNull: false },
    { name: "d", sqlType: "double precision", notNull: false },
    { name: "plain", sqlType: "text", notNull: false },
    { name: "numeric", sqlType: "text", notNull: false, default: "7" },
  ]);
  // A single primary key declared BIGINT (int affinity, but not exactly INTEGER) is no rowid alias: no identity.
  const bigintKey: SourceTableLayout = { ...layout, columns: [{ ...column("id", "BIGINT", null), primaryKeyPosition: 1 }] };
  expect(introspectedTable({ name: "t", layout: bigintKey }).columns).toEqual([{ name: "id", sqlType: "bigint", notNull: true }]);
});

const core: TransferTable = { name: "parents", columns: [{ name: "id", sqlType: "bigint", notNull: true }], primaryKey: ["id"], indexes: [], foreignKeys: [], checks: [] };
const policy: SnapshotTablePolicy = {
  coreTables: [core], coreNames: new Set(["parents"]), excludedTables: { logins: "sign-ins stay behind" },
  derivedNames: new Set(["search_cache"]), migrationLedgers: new Set(["schema_migrations"]), bookkeepingPrefixes: ["sqlite_", "_internal"],
  // The global flag is stripped before testing, so repeated tests never skip a match through lastIndex.
  secretColumnPattern: /token|password/gi,
};

it("sorts every snapshot table into copied or left out with its reason, core tables first", () => {
  const source = snapshotOf(`${SCHEMA}
    CREATE TABLE logins (id INTEGER PRIMARY KEY);
    CREATE TABLE schema_migrations (version TEXT);
    CREATE TABLE _internal_jobs (id INTEGER);
    CREATE TABLE search_cache (id INTEGER);
    CREATE TABLE api_keys (id INTEGER, Token TEXT);
    CREATE TABLE users (id INTEGER, password_hash TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
  `);
  const plan = planSnapshotTables({ source, policy });
  expect(plan.tables.map(table => table.name)).toEqual(["parents", "children", "notes", "pairs"]);
  expect(plan.tables[0]).toBe(core);
  expect(plan.leftOut).toEqual([
    { table: "_internal_jobs", reason: LEFT_OUT_REASON.bookkeeping },
    { table: "api_keys", reason: LEFT_OUT_REASON.secret },
    { table: "logins", reason: "sign-ins stay behind" },
    { table: "schema_migrations", reason: LEFT_OUT_REASON.bookkeeping },
    { table: "search", reason: LEFT_OUT_REASON.derived },
    { table: "search_cache", reason: LEFT_OUT_REASON.derived },
    { table: "search_config", reason: LEFT_OUT_REASON.derived },
    { table: "search_content", reason: LEFT_OUT_REASON.derived },
    { table: "search_data", reason: LEFT_OUT_REASON.derived },
    { table: "search_docsize", reason: LEFT_OUT_REASON.derived },
    { table: "search_idx", reason: LEFT_OUT_REASON.derived },
    { table: "users", reason: LEFT_OUT_REASON.secret },
  ]);
});

it("skips a listed table the source cannot describe, without copying or reporting it", () => {
  const source: TransferSource = {
    tableNames: () => ["ghost", "notes"],
    layout: table => table === "ghost" ? null : { virtual: false, columns: [{ name: "id", declaredType: "INTEGER", notNull: false, defaultSql: null, primaryKeyPosition: 1 }], foreignKeys: [], indexes: [] },
    columns: () => null, countRows: () => 0, rows: () => [], close: () => {},
  };
  const plan = planSnapshotTables({ source, policy });
  expect(plan.tables.map(table => table.name)).toEqual(["parents", "notes"]);
  expect(plan.leftOut).toEqual([]);
});
