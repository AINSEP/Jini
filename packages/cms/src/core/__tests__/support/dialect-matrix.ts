import { afterAll, describe } from "vitest";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import type BetterSqlite3 from "better-sqlite3";
import { sql } from "kysely";
import { sqliteKernel, type SqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { openPgliteKernel, type PgKernel } from "@jini-ai/db/kernel/pglite";
import type { StorageDialect, StorageKernel } from "@jini-ai/db/kernel";

/**
 * @file The contract-test matrix: run one suite against the domain fixture on EVERY embedded dialect,
 * so a converted repo is proven on SQLite and PGlite by the same assertions (idea from EmDash's
 * `describeEachDialect`). PGlite needs no server, so nothing is gated on an env var.
 *
 * Usage, in a `*.test.ts`:
 *
 * ```ts
 * describeEachDialect({ title: "PostRepoPort", options: {
 *   tables: ["posts", "post_revisions"],
 *   make: (kernel) => postRepoFor(kernel),
 *   createTables: (kernel, dialect) => createPostTables(kernel, dialect),
 * }, body: (makeRepo) => {
 *   test("saves", async () => { const repo = makeRepo(); … });
 * } }, {});
 * ```
 *
 * Or {@link eachDialect} for suites that already loop over an adapter list.
 *
 * - SQLite: every `make()` opens a fresh in-memory database (the domain's DDL applied), as the
 *   existing suites do.
 * - PGlite: ONE in-memory instance per DDL fixture per test file (instance + DDL cost seconds), with `tables`
 *   emptied before the repo's first call. Suites must make their repo before using it and run
 *   their tests one after another (Vitest's sequential default inside a file). Closed after the file.
 */

export type ContentKernel<DB = unknown> = StorageKernel<DB>;
export type SqliteContentKernel<DB = unknown> = SqliteKernel<DB>;
export type PgContentKernel<DB = unknown> = PgKernel<DB>;

export interface DialectOptions<R, DB = unknown> {
  /** Content tables the suite writes; emptied (PGlite) before each `make()`. */
  tables: readonly string[];
  /** One factory for every dialect — the point of a single query body. */
  make: (kernel: ContentKernel<DB>) => R;
  /** Required domain-owned DDL; this helper never imports a product's migrations. */
  createTables: (kernel: StorageKernel<DB>, dialect: StorageDialect) => void | Promise<void>;
}

export interface DialectCase<R> {
  /** `sqlite` or `pglite`: the label a suite prints. */
  name: string;
  dialect: StorageDialect;
  make: () => R;
}

const require = createRequire(new URL('../../../../package.json', import.meta.url));
const Database = require('better-sqlite3') as typeof BetterSqlite3;
// The DDL owner is the cache key: two domains in one test file must never share a schema by accident.
const sharedPg = new Map<unknown, PgContentKernel>();
const sqliteConnections: BetterSqlite3.Database[] = [];

// Registered at import (file level): an `after` registered inside a test would run after THAT test.
afterAll(async () => {
  try {
    for (const kernel of sharedPg.values()) await kernel.close();
  } finally {
    for (const db of sqliteConnections) db.close();
    sharedPg.clear();
    sqliteConnections.length = 0;
  }
});

/** `kernel` with every call held until `pending` settles (the per-test table reset).
 * @param required.kernel the real driver; required.pending schema creation or reset.
 * @returns A kernel whose query, execute, run and transaction calls await that work.
 * @complexity O(1) setup and space; call cost is the underlying driver cost.
 * @example heldUntil({ kernel, pending: createTables(kernel, kernel.dialect) }, {});
 */
export function heldUntil<DB>(
  { kernel, pending }: { kernel: StorageKernel<DB>; pending: Promise<void> },
  _optional: Record<string, never> = {},
): StorageKernel<DB> {
  return {
    ...kernel,
    ready: pending,
    run: async (fn) => (await pending, kernel.run(fn)),
    transaction: async (fn) => (await pending, kernel.transaction(fn)),
    query: async (statement) => (await pending, kernel.query(statement)),
    execute: async (statement) => (await pending, kernel.execute(statement)),
  };
}

/** The file's shared in-memory PGlite content kernel, with the fixture's DDL applied
 * before its first call. Schema failures propagate through heldUntil's ready/calls.
 * @complexity O(1) lookup; first use adds the fixture's DDL cost.
 */
function sharedPgContentKernel<R, DB>(options: DialectOptions<R, DB>): PgContentKernel<DB> {
  let kernel = sharedPg.get(options.createTables) as PgContentKernel<DB> | undefined;
  if (kernel === undefined) {
    const base = openPgliteKernel<DB>({ PGlite }, {});
    const created = base.ready.then(() => options.createTables(base, "postgres"));
    created.catch(() => {});
    kernel = heldUntil({ kernel: base, pending: created }, {});
    sharedPg.set(options.createTables, kernel as PgContentKernel);
  }
  return kernel;
}

/** A fresh in-memory SQLite database (domain DDL applied) behind its kernel.
 * @complexity O(1) setup plus the domain's DDL cost; connections close after the file.
 */
function freshSqliteContentKernel<R, DB>(options: DialectOptions<R, DB>): SqliteContentKernel<DB> {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // SPEC-033 — defense in depth: the original content connection retries a second connection's lock.
  db.pragma("busy_timeout = 5000");
  sqliteConnections.push(db);
  const base = sqliteKernel<DB>(db);
  const created = base.ready.then(() => options.createTables(base, "sqlite"));
  created.catch(() => {});
  return heldUntil({ kernel: base, pending: created }, {});
}

/** The shared PGlite content kernel with `tables` emptied before its first call.
 * @complexity O(tables) statement construction, plus the driver's truncate cost.
 */
function emptiedPgContentKernel<R, DB>(options: DialectOptions<R, DB>): PgContentKernel<DB> {
  const base = sharedPgContentKernel(options);
  if (options.tables.length === 0) return base;
  // CASCADE: a suite that writes a parent table (`workspaces`) also empties the rows that reference it.
  const pending = base.execute(sql`TRUNCATE ${sql.join(options.tables.map((table) => sql.table(table)))} CASCADE`);
  pending.catch(() => {});
  return heldUntil({ kernel: base, pending }, {});
}

/** Return factories with identical assertions over SQLite and PGlite.
 * @param options the required tables, repo factory and domain-owned DDL.
 * @returns Two synchronous factories; each kernel holds its calls until async setup finishes.
 * @complexity O(1) setup; each make inherits schema/reset and driver costs.
 * @example eachDialect({ tables: ["comments"], make: commentRepoFor, createTables }, {});
 */
export function eachDialect<R, DB = unknown>(
  options: DialectOptions<R, DB>,
  _optional: Record<string, never> = {},
): DialectCase<R>[] {
  return [
    { name: "sqlite", dialect: "sqlite", make: () => options.make(freshSqliteContentKernel(options)) },
    { name: "pglite", dialect: "postgres", make: () => options.make(emptiedPgContentKernel(options)) },
  ];
}

/** Register the same sequential suite for each embedded dialect.
 * @param required the title, domain fixture options and test-registration body.
 * @returns Nothing; registers Vitest suites and file-level driver cleanup.
 * @complexity O(1) registration plus the test body's registration cost.
 * @example describeEachDialect({ title: "Comments", options, body: registerTests }, {});
 */
export function describeEachDialect<R, DB = unknown>(
  { title, options, body }: {
    title: string;
    options: DialectOptions<R, DB>;
    body: (make: () => R, dialect: StorageDialect) => void;
  },
  _optional: Record<string, never> = {},
): void {
  for (const each of eachDialect(options, {})) {
    describe(`${title} [${each.name}]`, () => body(each.make, each.dialect));
  }
}
