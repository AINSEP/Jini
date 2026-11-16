/** Metadata for a single stored blob. */
export interface BlobFileMeta {
  /** Path relative to the namespace root. Always uses forward slashes. */
  path: string;
  /** Total size in bytes. */
  size: number;
  /** Unix epoch milliseconds of last modification. */
  mtimeMs: number;
}

/** The narrow contract every blob storage backend implements. */
export interface BlobStorage<Bytes extends Uint8Array = Uint8Array> {
  /** Reads `<namespace>/<relpath>` into bytes. Throws a `StorageError('NOT_FOUND', ...)` when missing. */
  readFile(namespace: string, relpath: string): Promise<Bytes>;
  /** Writes `<namespace>/<relpath>`, creating parent directories/prefixes as needed. */
  writeFile(namespace: string, relpath: string, body: Bytes): Promise<BlobFileMeta>;
  /**
   * Lists every file under `<namespace>/` recursively. The order is implementation-defined;
   * callers that need deterministic order sort by `path`.
   */
  listFiles(namespace: string): Promise<BlobFileMeta[]>;
  /** Deletes a single file under `<namespace>/`. Idempotent — missing files do not throw. */
  deleteFile(namespace: string, relpath: string): Promise<void>;
  /** Reports metadata for a single file without reading its bytes. Returns `null` when missing. */
  statFile(namespace: string, relpath: string): Promise<BlobFileMeta | null>;
}

/** Error thrown by {@link BlobStorage} implementations, distinguishing not-found/traversal/IO failures. */
export class StorageError extends Error {
  readonly code: 'NOT_FOUND' | 'TRAVERSAL' | 'IO';
  constructor(code: 'NOT_FOUND' | 'TRAVERSAL' | 'IO', message: string) {
    super(message);
    this.code = code;
    this.name = 'StorageError';
  }
}
