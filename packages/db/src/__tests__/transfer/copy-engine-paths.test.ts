/**
 * `inspectTarget`'s reading of the destination (version, privilege, markers, free schema) and
 * `runCopy`'s COPY text encoding and batching, against a scripted in-memory Postgres target.
 */
import { expect, it } from "vitest";
import { inspectTarget, runCopy, siteSchemaName, type PostgresTargetPort, type TargetResult, type TransferNaming, type TransferSource, type TransferTable } from "../../transfer/index.js";

const naming: TransferNaming = { defaultSchema: "app", schemaPrefix: "app_", markerTable: "_app_copy", unvalidatedTable: "pg_temp._app_unvalidated" };
const ok = (value: string[][]): TargetResult<string[][]> => ({ ok: true, value });

interface Answers { state?: TargetResult<string[][]>; listed?: TargetResult<string[][]>; markers?: Record<string, TargetResult<string[][]>>; existing?: TargetResult<string[][]> }
function target(answers: Answers): PostgresTargetPort & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    describe: () => ({ host: "h", port: "5432", database: "d", user: "u" }),
    query: async sql => {
      queries.push(sql);
      if (sql.includes("current_setting")) return answers.state ?? ok([["160000", "t"]]);
      if (sql.includes("FROM pg_class")) return answers.listed ?? ok([]);
      const marker = /^SELECT site, snapshot_at, .* FROM "([^"]+)"\."_app_copy" ORDER BY/.exec(sql);
      if (marker) return answers.markers?.[marker[1]!] ?? ok([]);
      if (sql.includes("FROM pg_namespace")) return answers.existing ?? ok([]);
      throw new Error(`unexpected query: ${sql}`);
    },
    runScript: async () => ({ ok: true, value: null }),
  };
}
const inspect = (answers: Answers, site = "site") => inspectTarget({ target: target(answers), site, naming });

it("returns the target's error when the version, marker list or schema list cannot be read", async () => {
  expect(await inspect({ state: { ok: false, error: "unreachable" } })).toEqual({ ok: false, error: "unreachable" });
  expect(await inspect({ listed: { ok: false, error: "no catalog access" } })).toEqual({ ok: false, error: "no catalog access" });
  expect(await inspect({ existing: { ok: false, error: "namespace read failed" } })).toEqual({ ok: false, error: "namespace read failed" });
});

it("treats an empty version row as an unknown version without create privilege", async () => {
  expect(await inspect({ state: ok([]) })).toEqual({ ok: true, serverVersionNum: NaN, canCreateSchema: false, schemaState: "absent", schema: "app", lastCopy: null });
});

it("lands a re-copy in the schema whose marker names only this site", async () => {
  const t = target({
    listed: ok([["app"], ["app_site"]]),
    markers: { app: ok([["other-site", "2026-01-01", "f"]]), app_site: ok([["site", "2026-02-02", "f"]]) },
  });
  expect(await inspectTarget({ target: t, site: "site", naming })).toEqual({
    ok: true, serverVersionNum: 160000, canCreateSchema: true, schemaState: "ours", schema: "app_site", lastCopy: { site: "site", snapshotAt: "2026-02-02" },
  });
  // A site's own copy is found from its marker alone; the free-schema search never runs.
  expect(t.queries.some(sql => sql.includes("FROM pg_namespace"))).toBe(false);
});

it("never claims a marker that is mixed, empty, unreadable, unnamed or missing a cell", async () => {
  const result = await inspect({
    listed: ok([["mixed"], ["empty"], ["broken"], [], ["partial"]]),
    markers: { mixed: ok([["site", "2026-01-01", "t"]]), empty: ok([]), broken: { ok: false, error: "undefined column" }, partial: ok([["site"]]) },
    existing: ok([["app"]]),
  });
  expect(result).toEqual({ ok: true, serverVersionNum: 160000, canCreateSchema: true, schemaState: "absent", schema: siteSchemaName({ site: "site", naming }), lastCopy: null });
});

it("reports every candidate schema taken as foreign, with no schema", async () => {
  // The namespace query answers with every candidate name it asked about, so all of them are taken.
  const t = target({});
  t.query = async sql => sql.includes("current_setting") ? ok([["160000", "t"]]) : sql.includes("FROM pg_class") ? ok([])
    : ok([...sql.matchAll(/'([^']+)'/g)].map(match => [match[1]!]));
  expect(await inspectTarget({ target: t, site: "My Site!", naming })).toEqual({ ok: true, serverVersionNum: 160000, canCreateSchema: true, schemaState: "foreign", schema: null, lastCopy: null });
});

// --- COPY text encoding ---------------------------------------------------------------------------

const columns: TransferTable["columns"] = [
  { name: "id", sqlType: "bigint", notNull: true }, { name: "body", sqlType: "text", notNull: false }, { name: "blob", sqlType: "bytea", notNull: false },
];
const table: TransferTable = { name: "items", columns, primaryKey: ["id"], indexes: [], foreignKeys: [], checks: [] };
function copyOf(rows: unknown[][], tableShape: TransferTable = table) {
  const chunks: string[] = [];
  const source: TransferSource = { tableNames: () => [tableShape.name], layout: () => null, columns: () => tableShape.columns.map(column => column.name), countRows: () => rows.length, rows: () => rows, close: () => {} };
  const t: PostgresTargetPort = {
    describe: () => ({ host: "h", port: "5432", database: "d", user: "u" }),
    query: async () => ok([["[]"]]),
    runScript: async script => { for (const chunk of script) chunks.push(chunk); return { ok: true, value: null }; },
  };
  const run = runCopy({ sources: [{ name: "content", source, tables: [tableShape], leftOut: [] }], target: t, naming, schema: "app", marker: { site: "site", snapshotAt: "now" }, replaceExisting: false });
  return { run, chunks };
}

it("encodes NULL, numbers, escaped text and bytea in COPY text format", async () => {
  const { run, chunks } = copyOf([
    [1n, "tab\tnew\nline\rcr\\slash", Buffer.from([0, 255])],
    [2, null, undefined],
  ]);
  expect(await run).toMatchObject({ ok: true, tables: [{ name: "items", rows: 2 }] });
  const data = chunks.join("");
  expect(data).toContain('COPY "app"."items" ("id", "body", "blob") FROM STDIN;\n1\ttab\\tnew\\nline\\rcr\\\\slash\t\\\\x00ff\n2\t\\N\t\\N\n\\.\n');
});

it("refuses binary data bound for a non-bytea column without changing anything", async () => {
  const { run } = copyOf([[1, Buffer.from("x"), null]]);
  expect(await run).toEqual({ ok: false, code: "COPY_FAILED", message: "'items.body' holds binary data, which its Postgres column does not accept. Nothing was changed." });
});

it("streams a large table in batches of about 256 KiB, each a whole number of rows", async () => {
  const body = "x".repeat(1000);
  const { run, chunks } = copyOf(Array.from({ length: 600 }, (_, index) => [index, body, null]));
  expect(await run).toMatchObject({ ok: true, tables: [{ name: "items", rows: 600 }] });
  const start = chunks.findIndex(chunk => chunk.startsWith('COPY "app"."items"'));
  const batches = chunks.slice(start + 1, chunks.findIndex(chunk => chunk.endsWith("\\.\n")) + 1);
  expect(batches.length).toBe(3);
  expect(batches.slice(0, -1).every(batch => batch.length > 256 * 1024 && batch.endsWith("\n"))).toBe(true);
  expect(batches.join("").split("\n").filter(line => /^\d+\t/.test(line))).toHaveLength(600);
});
