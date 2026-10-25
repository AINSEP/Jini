import { describe, expect, it } from "vitest";
import { introspectedTable } from "../table-catalog.js";

/** L2 §4 table-catalog: SQLite affinity → Postgres type per rule, literal-default grammar (anchored),
 *  bytea defaults skipped, single-INTEGER-PK identity, index filtering and FK null-column handling. */
const col = (name: string, declaredType: string, extra: Partial<{ notNull: boolean; defaultSql: string | null; primaryKeyPosition: number }> = {}) =>
  ({ name, declaredType, notNull: false, defaultSql: null, primaryKeyPosition: 0, ...extra });
const table = (columns: ReturnType<typeof col>[], rest: Partial<{ indexes: unknown[]; foreignKeys: unknown[] }> = {}) =>
  introspectedTable({ name: "t", layout: { virtual: false, columns, indexes: [], foreignKeys: [], ...rest } as never });

describe("type mapping", () => {
  it.each([
    ["INTEGER", "bigint"], ["bigint", "bigint"], ["POINT", "bigint"], ["VARCHAR(10)", "text"], ["NCHAR", "text"], ["CLOB", "text"], ["text", "text"],
    ["BLOB", "bytea"], ["REAL", "double precision"], ["FLOAT", "double precision"], ["DOUBLE", "double precision"], ["NUMERIC", "text"], ["", "text"], ["DATETIME", "text"],
  ])("%j → %s", (declared, expected) => {
    expect(table([col("c", declared)]).columns[0]!.sqlType).toBe(expected);
  });
});

describe("literal defaults", () => {
  it.each([["0", "0"], ["-12", "-12"], ["3.14", "3.14"], ["  7 ", "7"], ["'x'", "'x'"], ["'it''s'", "'it''s'"], ["''", "''"]])("keeps %j as %j", (defaultSql, expected) => {
    expect(table([col("c", "TEXT", { defaultSql })]).columns[0]!.default).toBe(expected);
  });
  it.each(["CURRENT_TIMESTAMP", "1.", ".5", "1e3", "'a' || 'b'", "'unterminated", "x'7'", "'a''", "(1)", "1 2"])("drops non-literal %j", (defaultSql) => {
    expect(table([col("c", "TEXT", { defaultSql })]).columns[0]).not.toHaveProperty("default");
  });
  it("never carries a default for bytea", () => {
    expect(table([col("c", "BLOB", { defaultSql: "'00'" })]).columns[0]).not.toHaveProperty("default");
  });
});

describe("keys and identity", () => {
  it("a single INTEGER primary key becomes an identity column and NOT NULL", () => {
    const t = table([col("id", "integer", { primaryKeyPosition: 1 }), col("x", "TEXT")]);
    expect(t.primaryKey).toEqual(["id"]);
    expect(t.columns[0]).toEqual({ name: "id", sqlType: "bigint", notNull: true, identity: "BY DEFAULT" });
    expect(t.columns[1]).toEqual({ name: "x", sqlType: "text", notNull: false });
  });
  it("a composite or non-INTEGER key gets no identity; key order follows primaryKeyPosition", () => {
    const composite = table([col("b", "INTEGER", { primaryKeyPosition: 2 }), col("a", "INTEGER", { primaryKeyPosition: 1 })]);
    expect(composite.primaryKey).toEqual(["a", "b"]);
    expect(composite.columns.some(c => "identity" in c)).toBe(false);
    expect(table([col("id", "BIGINT", { primaryKeyPosition: 1 })]).columns[0]).not.toHaveProperty("identity");
  });
});

describe("indexes and foreign keys", () => {
  it("drops pk-origin, partial and expression indexes; renames UNIQUE constraints", () => {
    const t = table([col("a", "TEXT"), col("b", "TEXT")], { indexes: [
      { name: "pk", unique: true, origin: "pk", partial: false, columns: ["a"] },
      { name: "part", unique: false, origin: "c", partial: true, columns: ["a"] },
      { name: "expr", unique: false, origin: "c", partial: false, columns: ["a", null] },
      { name: "ix_b", unique: false, origin: "c", partial: false, columns: ["b"] },
      { name: "sqlite_autoindex_t_1", unique: true, origin: "u", partial: false, columns: ["a", "b"] },
    ] });
    expect(t.indexes).toEqual([{ name: "ix_b", columns: ["b"], unique: false }, { name: "t_a_b_key", columns: ["a", "b"], unique: true }]);
  });
  it("names FKs, lowercases actions, and nulls foreignColumns when ANY parent column is implicit", () => {
    const t = table([col("p", "INTEGER"), col("q", "INTEGER")], { foreignKeys: [
      { columns: ["p"], foreignTable: "parent", foreignColumns: ["id"], onDelete: "CASCADE", onUpdate: "NO ACTION" },
      { columns: ["p", "q"], foreignTable: "parent", foreignColumns: ["a", null], onDelete: "SET NULL", onUpdate: "RESTRICT" },
    ] });
    expect(t.foreignKeys).toEqual([
      { name: "t_p_fkey", columns: ["p"], foreignTable: "parent", foreignColumns: ["id"], onDelete: "cascade", onUpdate: "no action" },
      { name: "t_p_q_fkey", columns: ["p", "q"], foreignTable: "parent", foreignColumns: null, onDelete: "set null", onUpdate: "restrict" },
    ]);
    expect(t.checks).toEqual([]);
  });
});
