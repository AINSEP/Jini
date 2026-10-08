/**
 * Swappable blob-storage port for uploads and generated assets. See index.ts for capability-provider ownership and adoption scope.
 *
 * This file defines the port's stable interface/type surface and nothing else —
 * it has no imports at all, so a consumer implementing `StorageProvider`
 * themselves installs nothing. The one real, production-quality adapter
 * (`BlobStorageProvider`, delegating to `@jini-ai/platform`'s `BlobStorage`)
 * lives at the separate `@jini-ai/capability-providers/adapters/blob-storage`
 * entry point; the non-production in-memory reference stub
 * (`createInMemoryStorageProvider`) lives under `src/unsafe-reference/`,
 * exported only from `@jini-ai/capability-providers/unsafe-reference`.
 */

export interface StorageObjectMeta {
  readonly key: string;
  readonly size: number;
  readonly contentType?: string;
  readonly updatedAt: number;
}

export interface StoragePutOptions {
  readonly contentType?: string;
}

export interface StorageProvider {
  /** Writes `data` at `key`, overwriting any existing object. */
  put(required: { key: string; data: Uint8Array }, options?: StoragePutOptions): Promise<StorageObjectMeta>;
  /** Reads the object at `key`, or `null` if it doesn't exist. */
  get(required: { key: string }): Promise<Uint8Array | null>;
  /** Deletes the object at `key`. A no-op if it doesn't exist. */
  delete(required: { key: string }): Promise<void>;
  /** Lists objects whose key starts with `prefix` (all objects when `prefix` is omitted), sorted by key. */
  list(required: Record<string, never>, optional?: { prefix?: string }): Promise<StorageObjectMeta[]>;
}
