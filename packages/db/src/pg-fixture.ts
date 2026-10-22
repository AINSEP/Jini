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
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

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
// The driver-dependency rationale above records the original extraction decision. Drivers are
// now available; this explicit test entry keeps psql-based semantic proofs and cleanup ordering.
const ADMIN_DATABASE = "postgres";

export interface PsqlResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PgFixtureOptions {
  /** Replace only subprocess execution; SQL selection and cleanup still run in the real fixture. */
  spawnSync?: (binary: string, args: string[], options: { encoding: "utf8" }) =>
    Pick<SpawnSyncReturns<string>, "status" | "error"> & { stdout: string | null; stderr: string | null };
}

/**
 * Bind a test fixture to an explicit server and role. Environment selection belongs to the host;
 * the admin database stays fixed so connection configuration cannot redirect cleanup.
 * The subprocess port makes refusal and ordering paths directly assertable without a live server.
 * @complexity Construction is constant time and space; each method runs one or two subprocesses.
 */
export function createPgFixture(
  required: { host: string; user: string; port?: string | undefined },
  optional: PgFixtureOptions = {}
) {
  const { host, user, port } = required;
  const run: NonNullable<PgFixtureOptions["spawnSync"]> = optional.spawnSync ?? spawnSync;

  /**
   * Runs one `-c` command against `database` via `psql`. Uses `ON_ERROR_STOP=1` so a failing
   * statement inside a multi-statement `-c` string aborts rather than continuing past it, and reports
   * failure via `ok: false` rather than throwing — callers proving a REJECTION (e.g. "int4 must refuse
   * 2147483648") need the failure as a value, not an exception to catch.
   * Throws if the executable cannot be started; inherits libpq credentials from the environment.
   * @complexity One subprocess; output memory is proportional to the returned text.
   */
  function psql(required: { database: string; sql: string }, _optional: Record<string, never> = {}): PsqlResult {
    const { database, sql } = required;
    // `-q` (quiet) suppresses command-completion tags ("INSERT 0 1", "CREATE TABLE", …) that would
    // otherwise interleave with `-t -A`'s unaligned tuple output and corrupt a caller's parse of the
    // actual returned value(s).
    const result = run(
      "psql",
      ["-h", host, "-U", user, ...(port ? ["-p", port] : []), "-d", database, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql],
      { encoding: "utf8" }
    );
    if (result.error) {
      throw new Error(
        `psql could not be run (${result.error.message}). This test suite requires a local psql binary on PATH ` +
          `and a Postgres server reachable at host "${host}" as role "${user}" — see this file's own doc.`
      );
    }
    return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  /** Drops (if present) and recreates `database` against the admin connection, so fixture tests are
   * repeatable regardless of what a previous run left behind. A failed DROP prevents CREATE;
   * either failure throws its exact database-specific diagnostic.
   * @complexity At most two sequential subprocesses; output memory follows the command output.
   */
  function recreateDatabase(required: { database: string }, _optional: Record<string, never> = {}): void {
    const { database } = required;
    const drop = psql({ database: ADMIN_DATABASE, sql: `DROP DATABASE IF EXISTS ${database};` });
    if (!drop.ok) throw new Error(`failed to drop fixture database "${database}": ${drop.stderr}`);
    const create = psql({ database: ADMIN_DATABASE, sql: `CREATE DATABASE ${database};` });
    if (!create.ok) throw new Error(`failed to create fixture database "${database}": ${create.stderr}`);
  }

  /** Idempotent cleanup of the caller-selected database; throws when PostgreSQL refuses it.
   * @complexity One subprocess; output memory follows the command output.
   */
  function dropDatabase(required: { database: string }, _optional: Record<string, never> = {}): void {
    const { database } = required;
    const drop = psql({ database: ADMIN_DATABASE, sql: `DROP DATABASE IF EXISTS ${database};` });
    if (!drop.ok) throw new Error(`failed to drop fixture database "${database}": ${drop.stderr}`);
  }

  return { psql, recreateDatabase, dropDatabase };
}
