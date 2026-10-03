import { createPsqlPostgresTarget } from "../transfer/postgres-target.js";

/**
 * @file Throwaway-database helpers for this feature's live-Postgres tests, built on the feature's own
 * `psql` target (the shared `platform/db/migration/pg-fixture.ts` is fenced to `platform/db/__tests__`).
 * Local default: Homebrew Postgres 14 on localhost:5432 as role `la`; `PGHOST`/`PGPORT`/`PGUSER`
 * override it for CI. The admin database is always `postgres`; only the caller's own distinctively
 * named database is ever dropped.
 */

const USER = process.env.PGUSER ?? "la";
const PORT = process.env.PGPORT ?? "5432";
const HOST = process.env.PGHOST;

export function connectionFor(database: string, password?: string): string {
  const auth = password === undefined ? USER : `${USER}:${password}`;
  return `postgresql://${auth}@localhost:${PORT}/${database}${HOST !== undefined ? `?host=${encodeURIComponent(HOST)}` : ""}`;
}

/** Runs one statement; rows joined by newlines, cells by tabs. Throws on any error. */
export async function sql(database: string, statement: string): Promise<string> {
  const result = await createPsqlPostgresTarget({ connectionString: connectionFor(database) }).query(statement);
  if (!result.ok) throw new Error(`${database}: ${result.error}`);
  return result.value.map((row) => row.join("\t")).join("\n");
}

export async function recreateDatabase(database: string): Promise<void> {
  await sql("postgres", `DROP DATABASE IF EXISTS ${database}`);
  await sql("postgres", `CREATE DATABASE ${database}`);
}

export async function dropDatabase(database: string): Promise<void> {
  await sql("postgres", `DROP DATABASE IF EXISTS ${database}`);
}
