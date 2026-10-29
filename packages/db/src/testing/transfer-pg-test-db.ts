import { createPsqlPostgresTarget, type PostgresTargetPort } from "../transfer/postgres-target.js";

/**
 * @file Throwaway-database helpers for this feature's live-Postgres tests, built on the feature's own
 * `psql` target (the shared `platform/db/migration/pg-fixture.ts` is fenced to `platform/db/__tests__`).
 * Local default: Homebrew Postgres 14 on localhost:5432 as role `la`; `PGHOST`/`PGPORT`/`PGUSER`
 * override it for CI. The admin database is always `postgres`; only the caller's own distinctively
 * named database is ever dropped.
 */

export interface TransferPgTestDb {
  connectionFor(database: string, password?: string): string;
  /** Runs one statement; rows joined by newlines, cells by tabs. Throws on any error. */
  sql(database: string, statement: string): Promise<string>;
  recreateDatabase(database: string): Promise<void>;
  dropDatabase(database: string): Promise<void>;
}

/** The psql adapter for one connection string; the helpers' default target. */
function psqlTarget(connectionString: string): PostgresTargetPort {
  return createPsqlPostgresTarget({ connectionString });
}

/**
 * Binds the helpers to one environment and target factory. The module's own exports below are this
 * factory over `process.env` (read once, at import) and the psql adapter.
 * @complexity O(1) per helper call plus one target query.
 */
export function createTransferPgTestDb(
  { env }: { env: Readonly<Record<string, string | undefined>> },
  { target = psqlTarget }: { target?: (connectionString: string) => PostgresTargetPort } = {},
): TransferPgTestDb {
  const user = env.PGUSER ?? "la";
  const port = env.PGPORT ?? "5432";
  const host = env.PGHOST;
  const connectionFor = (database: string, password?: string): string => {
    const auth = password === undefined ? user : `${user}:${password}`;
    const query = host === undefined ? "" : "?host=" + encodeURIComponent(host);
    return `postgresql://${auth}@localhost:${port}/${database}${query}`;
  };
  const sql = async (database: string, statement: string): Promise<string> => {
    const result = await target(connectionFor(database)).query(statement);
    if (!result.ok) throw new Error(`${database}: ${result.error}`);
    return result.value.map((row) => row.join("\t")).join("\n");
  };
  return {
    connectionFor,
    sql,
    async recreateDatabase(database) {
      await sql("postgres", `DROP DATABASE IF EXISTS ${database}`);
      await sql("postgres", `CREATE DATABASE ${database}`);
    },
    async dropDatabase(database) {
      await sql("postgres", `DROP DATABASE IF EXISTS ${database}`);
    },
  };
}

export const { connectionFor, sql, recreateDatabase, dropDatabase } = createTransferPgTestDb({ env: process.env });
