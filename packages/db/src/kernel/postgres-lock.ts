import { type Kysely, sql } from "kysely";

/**
 * `StorageKernel.lockKey` on Postgres: a transaction-scoped advisory lock on a 64-bit hash of the
 * key, released by COMMIT/ROLLBACK. A hash collision only makes two unrelated keys wait for each
 * other, never lets two holders of one key through.
 */
export async function postgresLockKey<DB>(tx: Kysely<DB>, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(tx);
}
