import { sql, type Kysely } from 'kysely';
import type { StorageKernel } from './port.js';

interface SessionDatabase { database: Kysely<unknown>; poolMax?: number }
const databases = new WeakMap<StorageKernel<unknown>, SessionDatabase>();

/** Private driver registration, kept separate from run() so the callback owns no transaction scope. */
export function registerKernelSessionDatabase({ kernel, database, poolMax }: {
  kernel: StorageKernel<unknown>; database: Kysely<unknown>; poolMax?: number;
}, _optional: Record<string, never> = {}): void { databases.set(kernel, { database, ...(poolMax === undefined ? {} : { poolMax }) }); }

/** A schema wrapper uses the same pool and therefore the same database ownership scope. */
export function inheritKernelSessionDatabase({ from, to }: {
  from: StorageKernel<unknown>; to: StorageKernel<unknown>;
}, _optional: Record<string, never> = {}): void {
  const database = databases.get(from);
  if (database) databases.set(to, database);
}

/**
 * Run one background owner under a dedicated PostgreSQL session advisory lock.
 * A competing owner returns acquired:false. The callback uses normal kernel transactions:
 * a durable dispatch snapshot commits before provider HTTP, unlike a transaction advisory lock.
 * The session is always unlocked/released after callback success or failure.
 * The pool needs a spare connection (max >= 2) for callback transactions.
 * assertOwned probes the held session before the next background cycle.
 * @throws For non-pooled kernels, unknown wrappers, a pool smaller than two, or an existing transaction scope.
 * @complexity Two O(1) lock queries and one reserved pool connection for the callback lifetime.
 */
export async function withKernelSessionLock<T>({ kernel, key, run }: {
  kernel: StorageKernel<unknown>; key: string; run: (lease: { assertOwned(): Promise<void> }) => Promise<T>;
}, _optional: Record<string, never> = {}): Promise<{ acquired: false } | { acquired: true; value: T }> {
  if (kernel.transport !== 'node-postgres') throw new Error('A database session lock requires the pooled PostgreSQL transport.');
  if (kernel.inTransaction()) throw new Error('A database session owner cannot start inside a transaction.');
  const registered = databases.get(kernel);
  if (!registered) throw new Error('A database session lock requires a kernel built by buildKernel.');
  if (registered.poolMax !== undefined && registered.poolMax < 2) throw new Error('A database session owner requires a PostgreSQL pool with at least 2 connections.');
  await kernel.ready;
  return registered.database.connection().execute(async connection => {
    const result = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS locked`.execute(connection);
    if (result.rows[0]?.locked !== true) return { acquired: false as const };
    try { return { acquired: true as const, value: await run({ assertOwned: async () => { await sql`SELECT 1`.execute(connection); } }) }; }
    finally { await sql`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`.execute(connection); }
  });
}
