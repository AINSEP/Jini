import os from "node:os";
/**
 * @file Minimal `psql` shell-out helper for tests that prove semantics against a real, local
 * Postgres server.
 *
 * Why shell out rather than use a driver: no `pg`/`postgres` npm package is installed in this repo
 * yet (`src/platform/db/postgres/db-ops.ts` is explicitly evaluation-only per its own header — see the
 * postgres-supabase-database-backend-spec.md architecture doc). Adding one is a real dependency
 * decision this task was explicitly told not to make unilaterally. `psql` is already on the host
 * running these tests, so it is the only way to prove behavior against a live server without adding
 * a new runtime dependency mid-task. This file is TEST INFRASTRUCTURE ONLY — nothing in
 * `manifest.ts`/`verify.ts` depends on it, and it must never be imported from product code.
 */
import { spawnSync } from "node:child_process";

/** Defaults match the fixture Postgres this repo's dispatch brief describes: Homebrew Postgres 14
 * listening on the Unix socket in `/tmp`, role `la`, no password (peer/trust auth on the socket).
 * `PGHOST`/`PGPORT`/`PGUSER` (standard libpq env var names) override these defaults so CI can point
 * this at a TCP service container instead of a developer's local socket. When unset, behavior is
 * byte-for-byte identical to before this file read the environment — every local dev run is
 * unaffected. `PGPASSWORD`, if set, needs no code here: `spawnSync` inherits the parent process's
 * environment by default, and `psql` itself already honors `PGPASSWORD` natively.
 *
 * Deliberately NOT overridable via env: `ADMIN_DATABASE` below stays a hardcoded `"postgres"` so a
 * stray or misconfigured env var can never redirect the *admin* connection target. Only the *server*
 * address (host/port/user) is configurable here — never which database on that server gets dropped by
 * `recreateDatabase()`/`dropDatabase()` (that's always the caller-supplied `database` argument, e.g.
 * the distinctively-named `migration_fixture`, not this constant). */
const PG_HOST = process.env.PGHOST ?? "/tmp";
const PG_USER = process.env.PGUSER ?? os.userInfo().username;
const PG_PORT = process.env.PGPORT;
const ADMIN_DATABASE = "postgres";

export interface PsqlResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs one `-c` command against `database` via `psql`. Uses `ON_ERROR_STOP=1` so a failing
 * statement inside a multi-statement `-c` string aborts rather than continuing past it, and reports
 * failure via `ok: false` rather than throwing — callers proving a REJECTION (e.g. "int4 must refuse
 * 2147483648") need the failure as a value, not an exception to catch.
 */
export function psql(database: string, sql: string): PsqlResult {
  // `-q` (quiet) suppresses command-completion tags ("INSERT 0 1", "CREATE TABLE", …) that would
  // otherwise interleave with `-t -A`'s unaligned tuple output and corrupt a caller's parse of the
  // actual returned value(s).
  const result = spawnSync(
    "psql",
    ["-h", PG_HOST, "-U", PG_USER, ...(PG_PORT ? ["-p", PG_PORT] : []), "-d", database, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql],
    { encoding: "utf8" }
  );
  if (result.error) {
    throw new Error(
      `psql could not be run (${result.error.message}). This test suite requires a local psql binary on PATH ` +
        `and a Postgres server reachable at host "${PG_HOST}" as role "${PG_USER}" — see this file's own doc.`
    );
  }
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Drops (if present) and recreates `database` against the admin connection, so fixture tests are
 * repeatable regardless of what a previous run left behind. */
export function recreateDatabase(database: string): void {
  const drop = psql(ADMIN_DATABASE, `DROP DATABASE IF EXISTS ${database};`);
  if (!drop.ok) throw new Error(`failed to drop fixture database "${database}": ${drop.stderr}`);
  const create = psql(ADMIN_DATABASE, `CREATE DATABASE ${database};`);
  if (!create.ok) throw new Error(`failed to create fixture database "${database}": ${create.stderr}`);
}

export function dropDatabase(database: string): void {
  const drop = psql(ADMIN_DATABASE, `DROP DATABASE IF EXISTS ${database};`);
  if (!drop.ok) throw new Error(`failed to drop fixture database "${database}": ${drop.stderr}`);
}
