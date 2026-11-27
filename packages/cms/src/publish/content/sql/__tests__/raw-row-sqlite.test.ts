import { BackstopRefusal } from "../../backstop-refusal.js";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRawRowSqlitePort } from "../raw-row-sqlite.js";

let sqlite: Database.Database;
let db: Kysely<unknown>;
let joined: boolean;
let checked: number;
let checkedTransaction: Parameters<typeof createRawRowSqlitePort>[0]["checkedTransaction"];
beforeEach(() => {
  sqlite = new Database(":memory:");
  db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE parent(id TEXT PRIMARY KEY); CREATE TABLE child(id TEXT PRIMARY KEY, parent TEXT REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)");
  joined = false; checked = 0;
  checkedTransaction = async ({ work, onViolation }) => {
    checked++; sqlite.exec("BEGIN"); joined = true;
    try {
      const result = await work();
      const violation = sqlite.prepare("PRAGMA foreign_key_check").get() as { table: string; rowid: unknown; parent: string } | undefined;
      if (violation) throw onViolation({ violation });
      sqlite.exec("COMMIT"); return result;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; } finally { joined = false; }
  };
});
afterEach(async () => { await db.destroy(); });

function port(checkTable = (_input: { table: string; columns: readonly string[] }): string | undefined => undefined) {
  const tableInfo = vi.fn<Parameters<typeof createRawRowSqlitePort>[0]["tableInfo"]>(async ({ table }) => sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; pk: number; notnull: number }[]);
  const execute = vi.fn(async ({ statement }: Parameters<Parameters<typeof createRawRowSqlitePort>[0]["kernel"]["execute"]>[0]) => { await statement.execute(db); });
  const rows = createRawRowSqlitePort({ kernel: {
    dialect: "sqlite", inTransaction: () => joined,
    query: async <Row>({ statement }: Parameters<Parameters<typeof createRawRowSqlitePort>[0]["kernel"]["query"]>[0]) => (await db.executeQuery<Row>(statement.compile(db))).rows,
    execute,
  }, tableInfo, checkedTransaction, checkTable,
  copy: { notSqlite: "SQLite required", foreignKeyViolation: ({ table }) => `FK: ${table}` } });
  return { rows, tableInfo, execute };
}

it("nested mutation joins one checked transaction and the outer refusal rolls it back", async () => {
  const { rows } = port();
  await expect(rows.transaction({ work: () => rows.transaction({ work: async () => {
    await rows.upsert({ table: "child", pk: { id: "a" }, values: { id: "a", parent: "missing" } });
    expect(sqlite.prepare("SELECT count(*) AS n FROM child").get()).toEqual({ n: 1 });
  } }) })).rejects.toThrow("FK: child");
  expect(checked).toBe(1);
  expect(sqlite.prepare("SELECT count(*) AS n FROM child").get()).toEqual({ n: 0 });
});

it("a denied table never reaches introspection", async () => {
  const { rows, tableInfo, execute } = port(() => "denied");
  await expect(rows.columns({ table: "child" })).rejects.toThrow("denied");
  expect(tableInfo).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
});

it("incomplete identity never mutates a row", async () => {
  const { rows, execute } = port();
  await expect(rows.upsert({ table: "child", pk: {}, values: { id: "a", parent: null } })).rejects.toThrow("complete primary key");
  expect(execute).not.toHaveBeenCalled();
  expect(sqlite.prepare("SELECT count(*) AS n FROM child").get()).toEqual({ n: 0 });
});

it("round-trips BLOB, REAL and NULL values, then removes only the selected composite key", async () => {
  const { rows } = port();
  sqlite.exec("CREATE TABLE notes(site TEXT, id TEXT, body BLOB, score REAL, comment TEXT, PRIMARY KEY(site,id))");
  const a = { table: "notes", pk: { site: "west", id: "a" } };
  const b = { table: "notes", pk: { site: "east", id: "a" } };
  await rows.upsert({ ...a, values: { ...a.pk, body: { blobBase64: "AP+A" }, score: 1.25, comment: null } });
  await rows.upsert({ ...b, values: { ...b.pk, body: { blobBase64: "eA==" }, score: 3.75, comment: "other" } });
  expect((await rows.read(a))?.values).toEqual({ ...a.pk, body: { blobBase64: "AP+A" }, score: 1.25, comment: null });
  expect(sqlite.prepare("SELECT hex(body) AS body, score, comment FROM notes WHERE site = 'west'").get()).toEqual({
    body: "00FF80", score: 1.25, comment: null,
  });
  await rows.removeCreated(a);
  expect(await rows.read(a)).toBeNull();
  expect((await rows.read(b))?.values).toEqual({ ...b.pk, body: { blobBase64: "eA==" }, score: 3.75, comment: "other" });
});

it("returns a miss for unavailable tables and rejects choosing a row from a missing table", async () => {
  // table_info's port maps a missing table to null, not SQLite's empty pragma array.
  const { rows, tableInfo, execute } = port();
  tableInfo.mockResolvedValueOnce(null);
  expect(await rows.columns({ table: "uninstalled" })).toBeNull();
  tableInfo.mockResolvedValueOnce(null);
  await expect(rows.read({ table: "uninstalled", pk: { id: "a" } })).rejects.toThrow(new BackstopRefusal({ message: "Table 'uninstalled' does not exist." }));
  expect(execute).not.toHaveBeenCalled();
});

it("rejects a database integer too large to represent faithfully in the wire row", async () => {
  const { rows } = port();
  sqlite.exec("CREATE TABLE metrics(id TEXT PRIMARY KEY, n INTEGER); INSERT INTO metrics VALUES ('large', 9007199254740993)");
  await expect(rows.read({ table: "metrics", pk: { id: "large" } })).rejects.toThrow(
    new BackstopRefusal({ message: "This row contains a database value that cannot be sent safely." }),
  );
});

it.each<{ values: Record<string, string | null>; reason: string }>([
  { values: { id: "a" }, reason: "missing column" },
  { values: { id: "wrong", parent: null }, reason: "mismatched primary key" },
])("refuses a $reason before any upsert reaches SQLite", async ({ values }) => {
  const { rows, execute } = port();
  await expect(rows.upsert({ table: "child", pk: { id: "a" }, values })).rejects.toThrow(
    new Error("The raw row does not contain every column or its primary key."),
  );
  expect(execute).not.toHaveBeenCalled();
  expect(sqlite.prepare("SELECT id FROM child").all()).toEqual([]);
});

it("treats a repeated key-only upsert as a no-op instead of generating an invalid update clause", async () => {
  const { rows } = port();
  const record = { table: "parent", pk: { id: "sole-key" }, values: { id: "sole-key" } };
  await rows.upsert(record);
  await rows.upsert(record);
  expect(sqlite.prepare("SELECT id FROM parent").all()).toEqual([{ id: "sole-key" }]);
});
