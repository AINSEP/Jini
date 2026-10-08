/** SQL boundary validation and opaque driver error translation. */
import type { StorageKernel, StorageTransport } from '@jini-ai/db/kernel';
import type { Kysely } from 'kysely';
import type { ChatDatabase } from './tables.js';
import type { ChatOwnerScope } from '../ports.js';
import { ChatStoreError } from '../errors.js';

/** Construction is validation-only: never query, migrate, reconfigure, open or close a kernel. */
export function validateKernel<DB>({ kernel, transports, dialect }: { kernel: StorageKernel<DB>; transports: readonly StorageTransport[]; dialect: 'sqlite' | 'postgres' }): void {
  if (!kernel || kernel.dialect !== dialect || !transports.includes(kernel.transport)) throw new ChatStoreError({ code: 'invalid-input' });
}

/** Copy primitive identity fields so subsequent caller mutation cannot rebind the store. */
export function copyScope({ scope }: { scope: ChatOwnerScope }): ChatOwnerScope {
  if (!scope || typeof scope.scopeId !== 'string' || !scope.scopeId || typeof scope.ownerId !== 'string' || !scope.ownerId || !['user', 'guest'].includes(scope.ownerKind)) {
    throw new ChatStoreError({ code: 'invalid-input' });
  }
  return { scopeId: scope.scopeId, ownerKind: scope.ownerKind, ownerId: scope.ownerId };
}

/** Preserve structured errors and causes; no driver details appear in public messages. */
export async function atStoreBoundary<T>({ operation }: { operation: () => Promise<T> }): Promise<T> {
  try { return await operation(); }
  catch (cause) {
    if (cause instanceof ChatStoreError) throw cause;
    throw new ChatStoreError({ code: 'unavailable' }, { cause });
  }
}

/** The single audited table-subset projection. Required table types are proven by DB's bound;
 * host extra tables and all transaction/locking effects stay on the original kernel object.
 * Kysely's invariant DB parameter requires this one erasure; it never bridges driver/version copies.
 * @returns The original kernel with only the required table types exposed.
 * @complexity O(1) time and space; no wrapper, connection or transaction is created.
 */
export function chatKernelTables<DB extends Tables, Tables extends ChatDatabase = ChatDatabase>(
  { kernel }: { kernel: StorageKernel<DB> }, _optional = {},
): StorageKernel<Tables> {
  return kernel as unknown as StorageKernel<Tables>;
}

/** Execute a transcript query through the shared table-subset projection. */
export function runChatQuery<DB extends ChatDatabase, T>({ kernel, body }: { kernel: StorageKernel<DB>; body: (db: Kysely<ChatDatabase>) => T | Promise<T> }): Promise<T> {
  return chatKernelTables<DB>({ kernel }, {}).run(body);
}
