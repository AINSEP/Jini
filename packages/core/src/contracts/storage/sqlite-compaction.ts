/**
 * @file Ports and results for converting a stopped SQLite file to incremental auto-vacuum and for the
 * bounded daily `incremental_vacuum` step (`@jini-ai/db/sqlite` `compaction.ts`). Types only, so a host
 * can bind the marker store and filesystem port without importing the driver package.
 */

/** Where a conversion stands, as the host's marker store last recorded it for one database file. */
export type SqliteCompactionMarker =
  /** The verified recovery copy is published; the rewrite has not started. */
  | { readonly state: "copied"; readonly recoveryCopyPath: string; readonly at: number }
  /** The rewrite was started. SQLite's own journal keeps the file whole, so a retry re-reads `auto_vacuum`. */
  | { readonly state: "rewriting"; readonly recoveryCopyPath: string; readonly at: number }
  /** Done and verified for this exact file (`identity`); a replaced or restored file does not inherit it. */
  | { readonly state: "converted"; readonly recoveryCopyPath: string; readonly at: number; readonly identity: string }
  /** The rewrite ran but its check failed. Nothing retries until the owner acts; the recovery copy stays. */
  | { readonly state: "needs-attention"; readonly recoveryCopyPath: string; readonly at: number; readonly reason: string };

/** The host's per-database record (for example one entry of `ops/maintenance.json`). */
export interface SqliteCompactionMarkerStore {
  read(): Promise<SqliteCompactionMarker | undefined>;
  write(marker: SqliteCompactionMarker): Promise<void>;
}

/** Filesystem reads and the one publish step the conversion needs; injected so tests and hosts own I/O. */
export interface SqliteCompactionFs {
  /** Size in bytes; 0 when the file does not exist. */
  size(path: string): Promise<number>;
  exists(path: string): Promise<boolean>;
  /** Bytes the current user may still write on the filesystem holding `directory`. */
  freeBytes(directory: string): Promise<number>;
  /** An id that is equal for two directories on the same filesystem. */
  deviceOf(directory: string): Promise<string>;
  /** An id of this exact file (device + inode); a restore or replacement changes it. */
  identity(path: string): Promise<string>;
  /** Durably move a finished file into place (rename, then flush the folder). */
  publish(from: string, to: string): Promise<void>;
  /** Remove a file this operation itself created and did not publish. */
  removeOwn(path: string): Promise<void>;
}

/** Main-file, WAL and free-page sizes, measured before and after a step. */
export interface SqliteFileSizes {
  readonly mainBytes: number;
  readonly walBytes: number;
  readonly freePages: number;
  readonly pageSize: number;
}

/** Why a conversion or a daily step did not run now. Each reason has its own plain message. */
export type SqliteCompactionHoldReason = "running" | "busy" | "low-disk" | "not-converted" | "nothing-to-reclaim" | "needs-attention";

/** What one conversion attempt did. `message` is plain words for the owner; it never carries a driver error. */
export type SqliteConversionOutcome =
  | { readonly status: "converted"; readonly recoveryCopyPath: string; readonly before: SqliteFileSizes; readonly after: SqliteFileSizes; readonly message: string }
  | { readonly status: "already-converted"; readonly message: string }
  | { readonly status: "deferred"; readonly reason: Exclude<SqliteCompactionHoldReason, "not-converted" | "nothing-to-reclaim">; readonly message: string; readonly recoveryCopyPath?: string };

/** What one daily `incremental_vacuum` step did. */
export type SqliteVacuumStepOutcome =
  | { readonly status: "reclaimed"; readonly before: SqliteFileSizes; readonly after: SqliteFileSizes; readonly elapsedMs: number; readonly message: string }
  | { readonly status: "skipped"; readonly reason: "busy" | "not-converted" | "nothing-to-reclaim"; readonly message: string; readonly before?: SqliteFileSizes };
