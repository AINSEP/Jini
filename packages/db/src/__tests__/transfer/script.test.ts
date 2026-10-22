/** Generic SQL generation evidence; host naming must never rewrite source identifiers or defaults. */
import { expect, it } from "vitest";
import { runCopy, reseedIdentitySql, constraintSql, type TransferSource, type TransferTable, type TransferNaming } from "../../transfer/index.js";
import type { PostgresTargetPort } from "../../transfer/postgres-target.js";
const naming: TransferNaming = { defaultSchema: "copy", markerTable: "copy_marker", schemaPrefix: "copy_", unvalidatedTable: "pg_temp.unchecked", sqlTag: "host" };
const table = (name: string): TransferTable => ({ name, columns: [{ name: "id", sqlType: "bigint", notNull: true }], primaryKey: ["id"], indexes: [], foreignKeys: [], checks: [] });
const source = (names: string[]): TransferSource => ({ tableNames: () => names, layout: () => null, columns: () => ["id"], countRows: () => 1, rows: () => [[1]], close: () => {} });
const marker = { site: "example", snapshotAt: "2026-10-02" };
it("quotes exception literals and preserves caller table order through all CREATEs then all COPYs", async () => {
  let script = "";
  const tables = [table("child's $transfer$"), table("parent")];
  const target: PostgresTargetPort = { describe: () => ({ host: "localhost", port: "5432", database: "disposable", user: "owner" }), query: async () => ({ ok: true, value: [["[]"]] }), runScript: async chunks => { for await (const chunk of chunks) script += chunk; return { ok: true, value: null }; } };
  const result = await runCopy({ sources: [{ name: "content", source: source(tables.map(t => t.name)), tables, leftOut: [] }], naming, target, schema: "copy", marker, replaceExisting: false });
  expect(result.ok).toBe(true);
  expect(script).toContain(`RAISE EXCEPTION 'TRANSFER_COUNT_MISMATCH child''s $transfer$'`);
  expect(script).toContain('DO $host$');
  expect(script).toContain('COPY "copy"."child\'s $transfer$"');
  expect(script.indexOf('CREATE TABLE "copy"."parent"')).toBeLessThan(script.indexOf('COPY "copy"."child'));
  expect(script.indexOf('COPY "copy"."child')).toBeLessThan(script.indexOf('COPY "copy"."parent"'));
});
it("the compatibility dollar tag changes delimiters, never matching text inside identifiers", () => {
  const item = { ...table("$transfer$"), columns: [{ name: "id", sqlType: "bigint", notNull: true, identity: "ALWAYS" as const }], checks: [{ name: "$transfer$_positive", sql: '"id" > 0' }] };
  expect(reseedIdentitySql({ schema: "copy", table: item }, { sqlTag: "host" })).toContain('"copy"."$transfer$"');
  const sql = constraintSql({ schema: "copy", tables: [item], unvalidatedTable: "pg_temp.unchecked" }, { sqlTag: "host" });
  expect(sql).toContain('DO $host$');
  expect(sql).toContain('"$transfer$_positive"');
});
it("rejects invalid counts, duplicate targets, marker collisions and forbidden schemas before any target effect", async () => {
  let effects = 0;
  const target: PostgresTargetPort = { describe: () => ({ host: "localhost", port: "5432", database: "disposable", user: "owner" }), query: async () => { effects++; return { ok: true, value: [] }; }, runScript: async () => { effects++; return { ok: true, value: null }; } };
  const item = table("rows");
  const planned = { name: "content", source: source(["rows"]), tables: [item], leftOut: [] };
  const input = { sources: [planned], target, naming, schema: "copy", marker, replaceExisting: false };
  await expect(runCopy({ ...input, sources: [{ ...planned, counts: [{ table: item, rows: -1 }] }] })).rejects.toThrow(/counts/);
  await expect(runCopy({ ...input, sources: [planned, { ...planned, name: "chat" }] })).rejects.toThrow(/same target table/);
  await expect(runCopy({ ...input, naming: { ...naming, markerTable: "rows" } })).rejects.toThrow(/marker/);
  await expect(runCopy({ ...input, schema: "public" })).rejects.toThrow(/schema/);
  await expect(runCopy({ ...input, naming: { ...naming, sqlTag: "bad$tag" } })).rejects.toThrow(/tag/);
  expect(effects).toBe(0);
});
