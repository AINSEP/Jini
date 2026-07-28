/**
 * `StorageProvider` — a swappable blob-storage port (file uploads, generated
 * assets). Speculative port-design exploration (see `source-map.md`) — no OD
 * source; the shape is the object-storage capability Zana's `app-chassis`
 * (`packages/storage`) and Tovu-Runner's ports layer both name explicitly.
 *
 * This file defines the port's stable interface/type surface, plus one real,
 * production-quality adapter (`BlobStorageProvider`, added 2026-07-21 — see
 * `source-map.md`'s dated section). The in-memory reference implementation
 * (`createInMemoryStorageProvider`) is a separate, non-production stub that
 * lives under `src/unsafe-reference/`, exported only from the separate
 * `@injini/capability-providers/unsafe-reference` entry point — see that
 * directory's `index.ts` header for the full warning.
 */
import type { BlobFileMeta, BlobStorage } from '@injini/platform';
import { StorageError as BlobStorageError } from '@injini/platform';

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
  put(key: string, data: Uint8Array, options?: StoragePutOptions): Promise<StorageObjectMeta>;
  /** Reads the object at `key`, or `null` if it doesn't exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Deletes the object at `key`. A no-op if it doesn't exist. */
  delete(key: string): Promise<void>;
  /** Lists objects whose key starts with `prefix` (all objects when `prefix` is omitted), sorted by key. */
  list(prefix?: string): Promise<StorageObjectMeta[]>;
}

export interface BlobStorageProviderOptions {
  /**
   * The `BlobStorage` namespace this provider scopes every `StorageProvider` key under (see
   * `BlobStorage`'s own module doc: "a tenant id, a workspace id, a project id, whatever the
   * host application scopes storage by"). `StorageProvider`'s `key` maps 1:1 onto `BlobStorage`'s
   * `relpath` within this fixed namespace — this adapter does not expose namespace switching,
   * matching `StorageProvider`'s single flat `key` surface (bind a separate `BlobStorageProvider`
   * per namespace if a host needs more than one).
   */
  readonly namespace: string;
}

/**
 * `StorageProvider` adapter that delegates to an injected `BlobStorage` instance
 * (`@injini/platform`'s real, tested port — `LocalBlobStorage` or `S3BlobStorage`). A thin
 * method-shape mapping, not a reimplementation: every operation is one `BlobStorage` call plus
 * field renaming (`path`→`key`, `mtimeMs`→`updatedAt`).
 *
 * Known limitation: `BlobFileMeta` (the metadata `BlobStorage` actually persists) has no
 * `contentType` field, so `StoragePutOptions.contentType` cannot be durably stored — `put()`
 * echoes it straight back in the `StorageObjectMeta` it returns (matching the option the caller
 * just passed), but a later `get`-equivalent lookup (`list()`) can never recover it, since
 * nothing under `../platform` persists it. `StorageObjectMeta.contentType` is optional
 * specifically so an adapter is free to omit it when the backing store can't carry it — this is
 * a deliberate, documented adapter-level gap, not a `StorageProvider` interface change.
 */
export class BlobStorageProvider implements StorageProvider {
  constructor(
    private readonly blobStorage: BlobStorage,
    private readonly options: BlobStorageProviderOptions,
  ) {
    if (!options.namespace) {
      throw new Error('BlobStorageProvider requires a non-empty options.namespace');
    }
  }

  async put(key: string, data: Uint8Array, options: StoragePutOptions = {}): Promise<StorageObjectMeta> {
    const meta = await this.blobStorage.writeFile(this.options.namespace, key, Buffer.from(data));
    return this.toObjectMeta(meta, options.contentType);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await this.blobStorage.readFile(this.options.namespace, key);
    } catch (err) {
      if (err instanceof BlobStorageError && err.code === 'NOT_FOUND') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    // `BlobStorage.deleteFile` is already documented idempotent (missing files don't throw),
    // matching `StorageProvider.delete`'s "no-op if it doesn't exist" contract directly.
    await this.blobStorage.deleteFile(this.options.namespace, key);
  }

  async list(prefix = ''): Promise<StorageObjectMeta[]> {
    const files = await this.blobStorage.listFiles(this.options.namespace);
    return files
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => this.toObjectMeta(file))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  private toObjectMeta(meta: BlobFileMeta, contentType?: string): StorageObjectMeta {
    return {
      key: meta.path,
      size: meta.size,
      updatedAt: meta.mtimeMs,
      ...(contentType !== undefined ? { contentType } : {}),
    };
  }
}
