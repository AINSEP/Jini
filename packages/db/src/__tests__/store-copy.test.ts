/** Scope/transaction evidence over real kernels; no host schema or driver copy is selected by the copier. */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import { expect, it } from "vitest";
import { openPgliteKernel } from "../kernel/pglite/index.js";
import { assertLedgersAgree, copyPgStore, nonEmptyTables, StoreCopyError, type StoreCopyScope } from "../kernel/store-copy.js";
const scope: StoreCopyScope = { schemas: ["catalog", "history"], ledgers: [{ schema: "catalog", name: "applied" }, { schema: "history", name: "applied" }] };
async function fixtures() {
  const source = openPgliteKernel({ PGlite });
  const target = openPgliteKernel({ PGlite });
  try {
    for (const kernel of [source, target]) {
      for (const schema of scope.schemas) {
        await kernel.execute(sql.raw(`CREATE SCHEMA ${schema}`));
        await kernel.execute(sql.raw(`CREATE TABLE ${schema}.applied (id TEXT PRIMARY KEY, checksum TEXT)`));
        await kernel.execute(sql.raw(`INSERT INTO ${schema}.applied VALUES ('step', 'same')`));
      }
      await kernel.execute(sql.raw("CREATE TABLE catalog.parent (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label TEXT DEFAULT 'new')"));
      await kernel.execute(sql.raw("CREATE TABLE history.child (id TEXT PRIMARY KEY, parent_id BIGINT REFERENCES catalog.parent(id))"));
      await kernel.execute(sql.raw("CREATE TABLE public.outside_scope (id TEXT PRIMARY KEY)"));
      await kernel.execute(sql.raw("INSERT INTO public.outside_scope VALUES ('leave-me')"));
    }
    for (const statement of ["INSERT INTO catalog.parent OVERRIDING SYSTEM VALUE VALUES (7, 'saved')", "INSERT INTO history.child VALUES ('child', 7)", "CREATE TABLE catalog.extra (id TEXT PRIMARY KEY, value BYTEA, absent BYTEA, payload JSONB, tags INTEGER[])", "INSERT INTO catalog.extra VALUES ('extra', '\\x00ff', NULL, '{\"label\":\"saved\",\"count\":2}', ARRAY[3, 7])"]) {
      await source.execute(sql.raw(statement));
    }
    return { source, target };
  } catch (error) {
    await source.close();
    await target.close();
    throw error;
  }
}
it("injected schemas/ledgers select only their tables, preserve ledgers, validate links and reseed ids; borrowed kernels stay open", async () => {
  const { source, target } = await fixtures();
  try {
    await assertLedgersAgree({ source, target, scope });
    expect(await nonEmptyTables({ kernel: target, scope })).toEqual([]);
    const report = await copyPgStore({ source, target, scope });
    expect(report).toEqual([{ table: "catalog.extra", rows: 1, created: true }, { table: "catalog.parent", rows: 1, created: false }, { table: "history.child", rows: 1, created: false }]);
    const extra = await target.query<{ id: string; value: string; absent: null; payload: string; tags: number[] }>(
      sql`SELECT id, encode(value, 'hex') AS value, absent, payload, tags FROM catalog.extra`,
    );
    expect(extra.map(({ payload, ...row }) => ({ ...row, payload: JSON.parse(payload) }))).toEqual([
      { id: "extra", value: "00ff", absent: null, payload: { label: "saved", count: 2 }, tags: [3, 7] },
    ]);
    expect(await target.query(sql`SELECT label FROM catalog.parent`)).toEqual([{ label: "saved" }]);
    expect(await target.query(sql`SELECT id FROM public.outside_scope`)).toEqual([{ id: "leave-me" }]);
    expect(await target.query(sql`SELECT id, checksum FROM history.applied`)).toEqual([{ id: "step", checksum: "same" }]);
    expect(await target.query(sql`INSERT INTO catalog.parent DEFAULT VALUES RETURNING id`)).toEqual([{ id: 8 }]);
    await expect(target.execute(sql`INSERT INTO history.child VALUES ('orphan', 999)`)).rejects.toThrow();
    expect(await source.query(sql`SELECT id FROM history.child`)).toEqual([{ id: "child" }]);
  } finally { await source.close(); await target.close(); }
}, 60_000);
it("a late fault rolls back copied rows and recreated tables, and a ledger mismatch refuses before copying", async () => {
  const { source, target } = await fixtures();
  try {
    await expect(copyPgStore({ source, target, scope }, { onCopied: async () => { throw new Error("late fault"); } })).rejects.toThrow("late fault");
    expect(await nonEmptyTables({ kernel: target, scope })).toEqual([]);
    expect(await target.query(sql`SELECT to_regclass('catalog.extra') AS extra`)).toEqual([{ extra: null }]);
    await target.execute(sql`UPDATE history.applied SET checksum = 'different'`);
    await expect(copyPgStore({ source, target, scope })).rejects.toBeInstanceOf(StoreCopyError);
    expect(await target.query(sql`SELECT count(*)::int AS n FROM catalog.parent`)).toEqual([{ n: 0 }]);
  } finally { await source.close(); await target.close(); }
}, 60_000);
