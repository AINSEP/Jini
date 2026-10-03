/**
 * UNSAFE REFERENCE IMPLEMENTATION — not production code. See the header
 * comment in `src/unsafe-reference/index.ts` for the full warning; the
 * short version: `createInMemoryStorageProvider` has no principal/tenant/
 * ACL dimension, no quotas, and no size bounds. It exists only to prove
 * `StorageProvider` (defined in `../storage.ts`) is implementable and
 * unit-testable. Never wire this into anything that handles real user
 * data.
 *
 * A real adapter (S3, R2, Supabase Storage, local disk) implements the
 * same `StorageProvider` interface without importing this file.
 */
import type { StorageObjectMeta, StorageProvider, StoragePutOptions } from '../storage.js';

/** Creates the in-memory reference `StorageProvider`. No persistence — state is lost on process exit. */
export function createInMemoryStorageProvider(_required: Record<string, never>, optional: { now?: () => number } = {}): StorageProvider {
  const now = optional.now ?? Date.now;
  const objects = new Map<string, { data: Uint8Array; meta: StorageObjectMeta }>();

  return {
    async put({ key, data }: { key: string; data: Uint8Array }, options: StoragePutOptions = {}): Promise<StorageObjectMeta> {
      const meta: StorageObjectMeta = {
        key,
        size: data.byteLength,
        updatedAt: now(),
        ...(options.contentType !== undefined ? { contentType: options.contentType } : {}),
      };
      objects.set(key, { data: data.slice(), meta });
      return meta;
    },

    async get({ key }: { key: string }): Promise<Uint8Array | null> {
      const entry = objects.get(key);
      return entry ? entry.data.slice() : null;
    },

    async delete({ key }: { key: string }): Promise<void> {
      objects.delete(key);
    },

    async list(_required: Record<string, never>, { prefix = '' }: { prefix?: string } = {}): Promise<StorageObjectMeta[]> {
      return [...objects.values()]
        .map((entry) => entry.meta)
        .filter((meta) => meta.key.startsWith(prefix))
        .sort((a, b) => a.key.localeCompare(b.key));
    },
  };
}
