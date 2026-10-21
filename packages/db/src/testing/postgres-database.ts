import os from "node:os";
import { type LegacyPgHelpers, psql, recreateDatabase } from "./pg-fixture.js";
import { pgContentSchemaSql } from "./content-schema.js";

/**
 * @file A fresh database on the local Postgres server for tests that need REAL connections (two
 * independent clients, pooled transactions) — what PGlite's single connection cannot show.
 *
 * Needs the server up (`pg_ctl -D /usr/local/var/postgresql@14 start`); when it is down the suite
 * fails, it never skips. Host/user follow libpq's env vars, as `pg-fixture.ts` does.
 */

export interface PostgresDatabaseHelpers {
  freshPostgresDatabase(name: string): string;
  freshPostgresContentDatabase(name: string): string;
}

/**
 * The connection URL for database `name` over libpq's env vars: `PGHOST` (default `/tmp`),
 * `PGUSER` (default the OS user, read through `userInfo` only when `PGUSER` is unset — see
 * `pgFixtureFromEnv`) and, only when set, `PGPORT`.
 * @complexity O(length of the parts).
 */
export function postgresUrlFor(
  required: { name: string; env: Readonly<Record<string, string | undefined>>; userInfo: () => { username: string } },
  _optional: Record<string, never> = {}
): string {
  const { name, env, userInfo } = required;
  const host = env.PGHOST ?? "/tmp";
  const user = env.PGUSER ?? userInfo().username;
  const port = env.PGPORT ? `&port=${env.PGPORT}` : "";
  return `postgresql://${encodeURIComponent(user)}@/${name}?host=${encodeURIComponent(host)}${port}`;
}

/**
 * The fresh-database helpers over `helpers` (the psql fixture) and libpq's env vars.
 * @complexity O(1) to build; each call is one or two fixture calls.
 */
export function postgresDatabaseHelpers(
  required: { helpers: Pick<LegacyPgHelpers, "psql" | "recreateDatabase">; env: Readonly<Record<string, string | undefined>>; userInfo: () => { username: string } },
  _optional: Record<string, never> = {}
): PostgresDatabaseHelpers {
  const { helpers, env, userInfo } = required;
  function freshPostgresDatabase(name: string): string {
    helpers.recreateDatabase(name);
    return postgresUrlFor({ name, env, userInfo });
  }
  /** {@link freshPostgresDatabase} with the whole content schema created (`pglite/content-schema.ts`). */
  function freshPostgresContentDatabase(name: string): string {
    const url = freshPostgresDatabase(name);
    const created = helpers.psql(name, pgContentSchemaSql());
    if (!created.ok) throw new Error(`creating the content schema in "${name}" failed: ${created.stderr}`);
    return url;
  }
  return { freshPostgresDatabase, freshPostgresContentDatabase };
}

export const { freshPostgresDatabase, freshPostgresContentDatabase } = postgresDatabaseHelpers({
  helpers: { psql, recreateDatabase },
  env: process.env,
  userInfo: os.userInfo,
});
