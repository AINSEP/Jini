/**
 * @file Neutral DTOs for the fenced content-addressed blob GC protocol: the per-storage-key fence
 * every byte writer and every unlinker shares, the provenance a tombstone carries, the durable
 * unlink journal row, the host-supplied ownership probes and the GC policy.
 *
 * Types only. The protocol itself lives with its storage owner (a CMS media module); hosts
 * implement the journal, the probes and the transaction/lock port against their own database.
 */

/** Why a blob row was tombstoned. A row with no reason is a legacy tombstone and is never unlinked. */
export type BlobPurgeReason = "owner-purge" | "trash-ttl" | "upload-rollback";

/** What kind of bytes a fenced write or unlink addresses. */
export type BlobWriteKind = "original" | "rendition" | "restore" | "hydrate" | "replace" | "import" | "staging";

/** The narrowest database port the fence needs: one transaction and one key lock inside it. */
export interface BlobFenceKernelPort {
  /** Runs `fn` inside one database transaction (SQLite `BEGIN IMMEDIATE`, Postgres transaction). */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** Inside a transaction: blocks every other transaction that locks the same key until this one ends. */
  lockKey(key: string): Promise<void>;
}

/** One fenced write request: the exact storage key the bytes will occupy. */
export interface BlobClaimTarget {
  readonly workspaceId: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly kind: BlobWriteKind;
}

/** One durable pending unlink, keyed by exact storage key. */
export interface BlobUnlinkJournalRow {
  readonly workspaceId: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly kind: "original" | "rendition";
  readonly reason: BlobPurgeReason;
  /** When the owning row was tombstoned; retention is re-checked against this before unlink. */
  readonly tombstonedAt: string;
  readonly journaledAt: string;
  readonly attempts: number;
  readonly lastError?: string | undefined;
  /** Earliest time the unlink pass retries this row after a storage failure. */
  readonly nextAttemptAt?: string | undefined;
}

/** Identity every ownership probe receives. `consumingJobId` excludes only that job from its own probe. */
export interface BlobOwnershipQuery {
  readonly workspaceId: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly consumingJobId?: string | undefined;
}

/**
 * Host-owned ownership evidence. Every probe is required on the unlink path: an absent or throwing
 * probe means "unknown", and unknown keeps the bytes.
 */
export interface BlobOwnershipProbes {
  /** Live content references (entry refs) naming these bytes. */
  hasLiveEntryRefs(query: BlobOwnershipQuery): Promise<boolean>;
  /** Age in ms of the oldest retained recovery copy (snapshot/backup) that may name these bytes, or null when none. */
  oldestRetainedRecoveryAgeMs(query: BlobOwnershipQuery): Promise<number | null>;
  /** Ids of pending jobs (forms outbox, publish staging) that still need these bytes. */
  pendingJobOwners(query: BlobOwnershipQuery): Promise<readonly string[]>;
}

/** GC policy. Defaults fail closed: 30-day grace, Trash-TTL purges are not eligible for unlink. */
export interface BlobGcPolicy {
  readonly graceMs: number;
  readonly allowTrashTtl: boolean;
}

/** Outcome of one fenced unlink attempt. `kept` = someone owns it; `deferred` = unknown or failed, retried later. */
export interface BlobUnlinkOutcome {
  readonly storageKey: string;
  readonly status: "unlinked" | "absent" | "kept" | "deferred";
  readonly reason: string;
}
