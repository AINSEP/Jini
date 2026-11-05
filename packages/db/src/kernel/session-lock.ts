import { sql, type Kysely } from 'kysely';
import type { StorageKernel } from './port.js';

const databases = new WeakMap<StorageKernel<unknown>, Kysely<unknown>>();

/** Private driver registration, kept separate from run() so the callback owns no transaction scope. */
export function registerKernelSessionDatabase({ kernel, database }: {
  kernel: StorageKernel<unknown>; database: Kysely<unknown>;
}): void { databases.set(kernel, database); }

/** A schema wrapper uses the same pool and therefore the same database ownership scope. */
export function inheritKernelSessionDatabase({ from, to }: {
  from: StorageKernel<unknown>; to: StorageKernel<unknown>;
}): void {
  const database = databases.get(from);
  if (database) databases.set(to, database);
}

/**
 * Run one background owner under a dedicated PostgreSQL session advisory lock.
 * A competing owner returns acquired:false. The callback uses normal kernel transactions:
 * a durable dispatch snapshot commits before provider HTTP, unlike a transaction advisory lock.
 * The session is always unlocked/released after callback success or failure.
 * @throws For non-pooled kernels, unknown wrappers, or an existing transaction scope.
 * @complexity Two O(1) lock queries and one reserved pool connection for the callback lifetime.
 */
export async function withKernelSessionLock<T>({ kernel, key, run }: {
  kernel: StorageKernel<unknown>; key: string; run: (lease: { assertOwned(): Promise<void> }) => Promise<T>;
}, _optional: Record<string, never> = {}): Promise<{ acquired: false } | { acquired: true; value: T }> {
  if (kernel.transport !== 'node-postgres') throw new Error('A database session lock requires the pooled PostgreSQL transport.');
  if (kernel.inTransaction()) throw new Error('A database session owner cannot start inside a transaction.');
  const database = databases.get(kernel);
  if (!database) throw new Error('A database session lock requires a kernel built by buildKernel.');
  await kernel.ready;
  return database.connection().execute(async connection => {
    const result = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS locked`.execute(connection);
    if (result.rows[0]?.locked !== true) return { acquired: false as const };
    try { return { acquired: true as const, value: await run({ assertOwned: async () => { await sql`SELECT 1`.execute(connection); } }) }; }
    finally { await sql`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`.execute(connection); }
  });
}
