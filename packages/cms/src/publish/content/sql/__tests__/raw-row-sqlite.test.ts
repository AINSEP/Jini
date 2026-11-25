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
  const tableInfo = vi.fn(async ({ table }: { table: string }) => sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; pk: number; notnull: number }[]);
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
