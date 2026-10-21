import os from "node:os";
import { createPgFixture, type PgFixtureOptions, type PsqlResult } from "../pg-fixture.js";
export type { PsqlResult } from "../pg-fixture.js";

/** The positional helpers the internal Postgres tests call. */
export interface LegacyPgHelpers {
  psql(database: string, sql: string): PsqlResult;
  recreateDatabase(database: string): void;
  dropDatabase(database: string): void;
}

/**
 * The fixture these helpers drive, chosen as libpq chooses: `PGHOST` (default the `/tmp` socket
 * dir), `PGUSER` (default the OS user) and `PGPORT` (default libpq's).
 * @complexity O(1).
 */
export function pgFixtureFromEnv(
  required: { env: Readonly<Record<string, string | undefined>>; username: string },
  optional: PgFixtureOptions = {}
): ReturnType<typeof createPgFixture> {
  const { env, username } = required;
  return createPgFixture({ host: env.PGHOST ?? "/tmp", user: env.PGUSER ?? username, port: env.PGPORT }, optional);
}

/**
 * Positional adapters over `fixture`'s object-style methods.
 * @complexity O(1) to build; each call is one fixture call.
 */
export function legacyPgHelpers({ fixture }: { fixture: ReturnType<typeof createPgFixture> }, _optional: Record<string, never> = {}): LegacyPgHelpers {
  return {
    psql: (database, sql) => fixture.psql({ database, sql }),
    recreateDatabase: (database) => fixture.recreateDatabase({ database }),
    dropDatabase: (database) => fixture.dropDatabase({ database }),
  };
}

// Compatibility for existing internal test helpers; all execution belongs to the public fixture.
export const { psql, recreateDatabase, dropDatabase } = legacyPgHelpers({
  fixture: pgFixtureFromEnv({ env: process.env, username: os.userInfo().username }),
});
