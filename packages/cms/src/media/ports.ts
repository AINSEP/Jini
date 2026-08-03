/**
 * @file Port contracts for the `media` library (ADR-027).
 *
 * Ports declared here (ADR-006 rule-of-two — each has a real second adapter in
 * this build):
 *  - `MediaRepoPort` / `AssetBlobRepoPort` / `AssetRenditionRepoPort` — in-memory
 *    now; a SQLite adapter is a host concern (composition roots bind their own
 *    concrete class against this port, the same disclosed precedent several
 *    other domains follow for their own repo ports).
 *  - `BlobStorePort` — content-addressed byte storage. Adapters: local
 *    filesystem (`blob-store.fs.ts`, real for this build) + in-memory test
 *    double (`blob-store.memory.ts`).
 *
 * `BlobStorePort`'s surface is deliberately narrower than ADR-027 §1's full
 * design: no `capabilities()`/`createPresignedUpload()` (the presign surface is
 * explicitly deferred by this task's scope). It has one method beyond the
 * task's stated minimal 3 (`put`/`get`/`exists`): `remove()`. That addition is
 * necessary to implement `purgeMedia`'s explicitly-requested "best-effort blob
 * unlink" (see `media-service.ts`) — without a way to delete bytes, purge could
 * only ever delete rows, never reclaim storage. This is disclosed here, not
 * silently smuggled in: it is still far short of the real ADR-027 §5 journaled
 * GC protocol (no epochs, no `BEGIN IMMEDIATE`, no crash-safety guarantee).
 *
 * Interfaces only — no feature logic.
 */
import type { UUID } from "../core/ports.js";
import type { AssetBlobRecord, AssetRenditionRecord, BlobGcJournalEntry, MediaRecord } from "./types.js";
import type { TransformDefinitionRecord } from "./transform-types.js";

export interface MediaRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<MediaRecord | null>;
  list(required: { workspaceId: UUID }): Promise<MediaRecord[]>;
  save(record: MediaRecord): Promise<void>;
  /** Hard delete — only ever called by `purgeMedia` after the trash guard passes. */
  remove(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

export interface AssetBlobRepoPort {
  findByHash(required: { workspaceId: UUID; sha256: string }): Promise<AssetBlobRecord | null>;
  /** All blob rows in a workspace — used by `blob-gc.ts`'s batch cycle to find tombstoned candidates. */
  list(required: { workspaceId: UUID }): Promise<AssetBlobRecord[]>;
  save(record: AssetBlobRecord): Promise<void>;
  remove(required: { workspaceId: UUID; sha256: string }): Promise<void>;
}

/**
 * `blob_gc_journal` repo (ADR-027 §5 INV-1 two-phase protocol). See
 * {@link BlobGcJournalEntry} for what a row represents.
 */
export interface BlobGcJournalRepoPort {
  save(entry: BlobGcJournalEntry): Promise<void>;
  list(required: { workspaceId: UUID }): Promise<BlobGcJournalEntry[]>;
  remove(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

export interface AssetRenditionRepoPort {
  listByAsset(required: { workspaceId: UUID; assetId: UUID }): Promise<AssetRenditionRecord[]>;
  /**
   * Exact lookup by the frozen public URL contract's key (ADR-027 §4):
   * `(assetId, transformName, version)` only — `slug`/`ext` are cosmetic and
   * never participate in any lookup.
   */
  findOne(required: {
    workspaceId: UUID;
    assetId: UUID;
    transformName: string;
    version: number;
  }): Promise<AssetRenditionRecord | null>;
  save(record: AssetRenditionRecord): Promise<void>;
  removeByAsset(required: { workspaceId: UUID; assetId: UUID }): Promise<void>;
}

/**
 * `transform_registry` repo (ADR-027 §4). Append-only: `insert` must never
 * update or remove an existing `(workspaceId, name, version)` row — see
 * `InMemoryTransformDefinitionRepo` for the enforced version of that
 * contract.
 */
export interface TransformDefinitionRepoPort {
  /** All versions ever registered for `name` (any order — callers reduce for "latest"). */
  listByName(required: { workspaceId: UUID; name: string }): Promise<TransformDefinitionRecord[]>;
  findByNameVersion(required: {
    workspaceId: UUID;
    name: string;
    version: number;
  }): Promise<TransformDefinitionRecord | null>;
  /** Append-only insert. Implementations must reject a duplicate `(workspaceId, name, version)`. */
  insert(record: TransformDefinitionRecord): Promise<void>;
}

/** Input to {@link BlobStorePort.put}. */
export interface PutBlobInput {
  workspaceId: UUID;
  sha256: string;
  bytes: Uint8Array;
}

/**
 * Content-addressed byte storage (ADR-027 §1/§3). Storage keys are
 * workspace-prefixed and sha256-sharded: `ws/{workspaceId}/blobs/{sha256[0..1]}/{sha256}`
 * (see `blob-key.ts`). No per-generation epoch in this build (that machinery
 * belongs to the deferred journaled-GC protocol — see `media-service.ts`).
 */
export interface BlobStorePort {
  put(input: PutBlobInput): Promise<{ storageKey: string }>;
  get(input: { storageKey: string }): Promise<Uint8Array>;
  exists(input: { storageKey: string }): Promise<boolean>;
  /** Idempotent — removing an already-absent key is not an error. */
  remove(input: { storageKey: string }): Promise<void>;
}
