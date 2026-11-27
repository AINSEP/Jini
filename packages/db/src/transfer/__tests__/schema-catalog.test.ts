import { describe, expect, it } from "vitest";
import {
  collectCatalogSchemaTables, collectCatalogTransferTables, planCatalogSnapshotTables, planIntrospectedSnapshotTables,
  type CatalogColumnConfig, type CatalogIntrospection, type CatalogSchemaPorts, type CatalogTableConfig, type SourceTableLayout, type TransferSource,
} from "../index.js";

/** A fake ORM: a "table" is just its config; "SQL" is `{ sql: string }`; no ORM library is involved. */
const sqlOf = (sql: string) => ({ __sql: sql });
const fake: CatalogIntrospection = {
  tableName: (table) => (table as CatalogTableConfig).name,
  tableConfig: (table) => table as CatalogTableConfig,
  isTable: (value) => typeof value === "object" && value !== null && "columns" in value,
  isSql: (value) => typeof value === "object" && value !== null && "__sql" in value,
  renderSql: ({ value, indexTerm }) => `${indexTerm === true ? "term:" : ""}${(value as { __sql: string }).__sql}`,
};
const column = (name: string, extra: Partial<CatalogColumnConfig> = {}): CatalogColumnConfig =>
  ({ name, sqlType: "text", notNull: false, primary: false, isUnique: false, hasDefault: false, ...extra });
const table = (name: string, extra: Partial<CatalogTableConfig> = {}): CatalogTableConfig =>
  ({ name, columns: [column("id", { primary: true })], indexes: [], uniqueConstraints: [], primaryKeys: [], foreignKeys: () => [], checks: [], ...extra });
const ports = (schema: Record<string, unknown>, extra: Partial<CatalogSchemaPorts> = {}): CatalogSchemaPorts => ({
  introspection: fake, schema, copyOrder: () => Object.keys(schema), derivedNames: new Set(), schemaLabel: "schema.fake.ts",
  partiallyExcluded: {}, excludedTables: {}, ...extra,
});

describe("column and primary-key projection", () => {
  it("renders sql, string, number and boolean defaults and identity kinds", () => {
    const [t] = collectCatalogSchemaTables({ catalog: ports({ t: table("t", { columns: [
      column("a", { hasDefault: true, default: sqlOf("now()") }), column("b", { hasDefault: true, default: "it's" }),
      column("c", { hasDefault: true, default: 7 }), column("d", { hasDefault: true, default: false }),
      column("e", { hasDefault: true }), column("f", { identity: "always", primary: true }), column("g", { identity: "byDefault" }),
    ] }) }) });
    expect(t!.columns).toEqual([
      { name: "a", sqlType: "text", notNull: false, default: "now()" }, { name: "b", sqlType: "text", notNull: false, default: "'it''s'" },
      { name: "c", sqlType: "text", notNull: false, default: "7" }, { name: "d", sqlType: "text", notNull: false, default: "false" },
      { name: "e", sqlType: "text", notNull: false }, { name: "f", sqlType: "text", notNull: false, identity: "ALWAYS" },
      { name: "g", sqlType: "text", notNull: false, identity: "BY DEFAULT" },
    ]);
    expect(t!.primaryKey).toEqual(["f"]);
  });
  it("refuses a default it cannot write, naming the host's schema label", () => {
    expect(() => collectCatalogSchemaTables({ catalog: ports({ t: table("t", { columns: [column("p", { hasDefault: true, default: {} })] }) }) }))
      .toThrow("schema.fake.ts: 'p' has a default this copier cannot write");
  });
  it("falls back to composite primary keys when no column is inline", () => {
    const [t] = collectCatalogSchemaTables({ catalog: ports({ t: table("t", { columns: [column("a"), column("b")], primaryKeys: [{ columns: ["a", "b"] }] }) }) });
    expect(t!.primaryKey).toEqual(["a", "b"]);
  });
  it("reports a missing export", () => {
    expect(() => collectCatalogSchemaTables({ catalog: ports({}, { copyOrder: () => ["gone"] }) })).toThrow("schema.fake.ts has no table exported as 'gone'; regenerate it");
  });
});

describe("index, foreign key and check projection", () => {
  it("collects declared, column-unique and constraint-unique indexes, with expressions and predicates", () => {
    const [t] = collectCatalogSchemaTables({ catalog: ports({ t: table("t", {
      columns: [column("id", { primary: true }), column("slug", { isUnique: true }), column("code", { isUnique: true, uniqueName: "code_u" })],
      indexes: [
        { name: "plain", terms: [{ kind: "column", name: "id" }], unique: false },
        { terms: [{ kind: "column", name: "slug" }, { kind: "sql", sql: sqlOf("lower(x)") }], unique: true, where: sqlOf("id > 0") },
      ],
      uniqueConstraints: [{ columns: ["id", "slug"] }, { name: "named_u", columns: ["code"] }],
    }) }) });
    expect(t!.indexes).toEqual([
      { name: "plain", columns: ["id"], unique: false },
      { name: "t_idx", columns: ["slug"], expressions: ['"slug"', "(term:lower(x))"], unique: true, where: "id > 0" },
      { name: "t_slug_unique", columns: ["slug"], unique: true }, { name: "code_u", columns: ["code"], unique: true },
      { name: "t_unique", columns: ["id", "slug"], unique: true }, { name: "named_u", columns: ["code"], unique: true },
    ]);
  });
  it("refuses an index column with no name", () => {
    expect(() => collectCatalogSchemaTables({ catalog: ports({ t: table("t", { indexes: [{ name: "bad", terms: [{ kind: "column", name: undefined }], unique: false }] }) }) }))
      .toThrow("Index bad has a column with no name");
  });
  it("defaults foreign-key actions and renders checks", () => {
    const [t] = collectCatalogSchemaTables({ catalog: ports({ t: table("t", {
      foreignKeys: () => [{ name: "fk", columns: ["a"], foreignTable: "u", foreignColumns: ["id"], onDelete: "cascade" }],
      checks: [{ name: "ck", value: sqlOf("a > 0") }],
    }) }) });
    expect(t!.foreignKeys).toEqual([{ name: "fk", columns: ["a"], foreignTable: "u", foreignColumns: ["id"], onDelete: "cascade", onUpdate: "no action" }]);
    expect(t!.checks).toEqual([{ name: "ck", sql: "a > 0" }]);
  });
});

describe("exclusions", () => {
  const schema = { users: table("users"), secrets: table("secrets"), posts: table("posts") };
  it("drops excluded tables from the transfer set but not from the full schema", () => {
    const catalog = ports(schema, { excludedTables: { secrets: "never copied" } });
    expect(collectCatalogTransferTables({ catalog }).map((t) => t.name)).toEqual(["users", "posts"]);
    expect(collectCatalogSchemaTables({ catalog }).map((t) => t.name)).toEqual(["users", "secrets", "posts"]);
  });
  it("carries a partially excluded table's keep predicate", () => {
    const catalog = ports(schema, { partiallyExcluded: { posts: { keep: "public = 1" } } });
    const posts = collectCatalogTransferTables({ catalog }).find((t) => t.name === "posts");
    expect(posts?.keep).toBe("public = 1");
    expect(collectCatalogTransferTables({ catalog }).find((t) => t.name === "users")).not.toHaveProperty("keep");
  });
});

const layout = (names: string[]): SourceTableLayout => ({ virtual: false, columns: names.map((name) => ({ name, declaredType: "TEXT", notNull: false, defaultSql: null, primaryKeyPosition: 0 })), indexes: [], foreignKeys: [] });
const sourceOf = (tables: Record<string, string[]>): TransferSource => ({
  tableNames: () => Object.keys(tables), layout: (name: string) => (tables[name] === undefined ? null : layout(tables[name])),
} as unknown as TransferSource);

describe("snapshot planning", () => {
  const policy = { migrationLedgers: new Set(["ledger"]), foreignOwnedTables: ["chats"], foreignOwnedReason: "owned elsewhere", bookkeepingPrefixes: ["sys_"], secretColumnPattern: /secret/ };
  it("plans core tables first, reports exclusions, foreign-owned and secret tables, and introspects the rest", () => {
    const catalog = ports({ users: table("users"), vault: table("vault") }, { excludedTables: { vault: "keys stay" } });
    const plan = planCatalogSnapshotTables({ catalog, policy, source: sourceOf({
      users: ["id"], vault: ["id"], chats: ["id"], ledger: ["id"], sys_x: ["id"], creds: ["secret_x"], extra: ["id"],
    }) });
    expect(plan.tables.map((t) => t.name)).toEqual(["users", "extra"]);
    expect(Object.fromEntries(plan.leftOut.map((l) => [l.table, l.reason]))).toMatchObject({ vault: "keys stay", chats: "owned elsewhere" });
    expect(plan.leftOut.map((l) => l.table).sort()).toEqual(["chats", "creds", "ledger", "sys_x", "vault"]);
  });
  it("orders an introspected database's owned tables first and copies secret-shaped columns raw", () => {
    const plan = planIntrospectedSnapshotTables({ ownedTables: ["b", "a"], migrationLedgers: new Set(["ledger"]), bookkeepingPrefixes: ["sys_"],
      source: sourceOf({ z: ["id"], a: ["secret_x"], b: ["id"], ledger: ["id"], sys_x: ["id"] }) });
    expect(plan.tables.map((t) => t.name)).toEqual(["b", "a", "z"]);
    expect(plan.leftOut.map((l) => l.table).sort()).toEqual(["ledger", "sys_x"]);
  });
});

it("planned tables ignore non-table exports and preserve an explicit foreign-key update action", () => {
  const catalog = ports({ entries: table("entries", {
    foreignKeys: () => [{ name: "entry_shared", columns: ["id"], foreignTable: "shared", foreignColumns: ["id"], onUpdate: "cascade" }],
  }), absent: null, doc: "schema helper", helper: { utility: true } }, { copyOrder: () => ["entries"] });
  const plan = planCatalogSnapshotTables({
    catalog, source: sourceOf({ entries: ["id"], shared: ["id"] }),
    policy: { migrationLedgers: new Set(), foreignOwnedTables: [], foreignOwnedReason: "other source", bookkeepingPrefixes: [], secretColumnPattern: /secret/ },
  });
  expect(plan.tables.map(value => value.name)).toEqual(["entries", "shared"]);
  expect(plan.tables.find(value => value.name === "entries")?.foreignKeys).toEqual([
    { name: "entry_shared", columns: ["id"], foreignTable: "shared", foreignColumns: ["id"], onDelete: "no action", onUpdate: "cascade" },
  ]);
  expect(plan.leftOut).toEqual([]);
});
