/**
 * @file Domain types + typed errors for the `media` library (ADR-027).
 *
 * Purpose:
 * `MediaRecord` is the editorial half of a media asset; `AssetBlobRecord` and
 * `AssetRenditionRecord` are the two core-owned operational sidecars ADR-027
 * §2 specifies.
 *
 * SCOPE NOTE (disclosed, not a silent deviation): ADR-027 describes media as a
 * seeded `entries` content-type entry (ADR-022) — editorial fields live under
 * `bodyJson.$.source`/`fields.ext.media.*` on a generic entry row, with
 * revisions/taxonomy/`entry_refs` for free. That generic `entries` model does
 * not exist as running code in the host that first built this yet (ADR-022 is
 * ACCEPTED design only; `post` itself is still a bespoke first-class table,
 * not a generic entry). `MediaRecord` below is therefore built the same way a
 * bespoke `post`-style record is built: a bespoke record with its editorial
 * fields inlined directly. When a generic entries system ships, `media`
 * should migrate onto it the same way `post` eventually will — this file is
 * not a competing permanent design, it is that pattern applied to media.
 *
 * The two sidecars (`AssetBlobRecord`, `AssetRenditionRecord`) ARE built as
 * ADR-027 §2 describes — they were always meant to be core-owned tables
 * independent of the entries model, so no scope adjustment was needed there.
 */
import type { ISODateTime, UUID } from "../core/ports.js";

/** Deletion ladder status (ADR-027 §5, mirrored from `navigation`'s menu ladder). */
export type MediaStatus = "active" | "trashed";

/**
 * Write-once source binding — the edge from a media record to its bytes.
 * ADR-027 §2: "settable-once-from-absent" (absent -> set exactly once, then
 * immutable). In this bespoke-table build every `MediaRecord` gets its
 * `source` set at creation time by `uploadMedia` (never a row without bytes,
 * ADR-027 §5 ordering), so in practice the absent state is transient/internal
 * to `uploadMedia`, not something the write-once guard needs to police at the
 * repo/API boundary. The guard exists anyway (`assertSourceUnchanged` in
 * `media-service.ts`) as the enforced invariant for any future write path.
 */
export interface MediaSource {
  sha256: string;
}

export interface MediaRecord {
  id: UUID;
  workspaceId: UUID;
  title: string;
  alt: string;
  caption: string;
  credit: string;
  /** Write-once (see {@link MediaSource} doc). Always set by the time a row exists. */
  source: MediaSource;
  status: MediaStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

/**
 * Blob-GC lifecycle status (ADR-027 §5 INV-1's two-phase journaled protocol,
 * implemented in `blob-gc.ts`). `active` — has at least one live reference as
 * of the last check (or has never been checked). `tombstoned` — the
 * tombstone-pass found it unreferenced and is waiting out `gc_grace` before
 * the delete-pass may remove the row; a dedup upload observing `tombstoned`
 * resurrects it back to `active` in the same locked section instead of
 * writing a duplicate blob.
 */
export type AssetBlobStatus = "active" | "tombstoned";

/**
 * `asset_blobs` sidecar (ADR-027 §2/§3): physical bytes metadata. Identity is
 * `(workspaceId, sha256)` — dedup is per-workspace, no cross-tenant byte
 * sharing (ADR-027 §3).
 */
export interface AssetBlobRecord {
  id: UUID;
  workspaceId: UUID;
  sha256: string;
  storageKey: string;
  /** Required attribution (ADR-027 §2 — machine writes still stamp a principal). */
  createdByPrincipal: string;
  createdAt: ISODateTime;
  /** See {@link AssetBlobStatus}. Always `"active"` for a freshly written blob. */
  status: AssetBlobStatus;
  /** Set only while `status === "tombstoned"`; cleared (undefined) on resurrect. */
  tombstonedAt?: ISODateTime | undefined;
}

/**
 * `blob_gc_journal` sidecar (ADR-027 §5 INV-1's two-phase protocol,
 * `blob-gc.ts`): written by the delete-pass in the same locked step as the
 * `asset_blobs` row deletion, drained by the unlink-pass. This is what makes
 * the unlink crash-safe/retriable instead of "delete row, hope the unlink
 * happens" — a journal entry surviving between the two passes is the seam a
 * crash-recovery sweep would resume from. (This build's journal is an
 * in-memory table like every other `media` repo in this pass — it does not
 * survive a process restart; see `repo.memory.ts` file header for the
 * standing disclosed precedent.)
 */
export interface BlobGcJournalEntry {
  id: UUID;
  workspaceId: UUID;
  sha256: string;
  storageKey: string;
  journaledAt: ISODateTime;
}

/**
 * `asset_renditions` sidecar (ADR-027 §2): derived variants. This build has no
 * real transform pipeline (deferred — see `media-service.ts` file header); the
 * only rendition ever created is the trivial "original" passthrough written by
 * `uploadMedia`.
 */
export interface AssetRenditionRecord {
  id: UUID;
  workspaceId: UUID;
  assetId: UUID;
  transformName: string;
  version: number;
  storageKey: string;
  createdAt: ISODateTime;
}

export class MediaNotFoundError extends Error {}
export class MediaValidationError extends Error {}
export class MediaConflictError extends Error {}

/**
 * The write-once source guard rejected an attempt to change an
 * already-set `source.sha256` (ADR-027 §2 "settable-once-from-absent").
 */
export class MediaSourceImmutableError extends MediaValidationError {}

/**
 * The 409-style purge rejection (ADR-027 §5 deletion ladder, mirrors
 * `MenuLocationBoundError`). `referencing` is a human-readable stand-in list —
 * see `media-service.ts` file header for the disclosed simplification (no real
 * `entry_refs` where-used index exists yet).
 */
export class MediaStillReferencedError extends MediaConflictError {
  readonly referencing: readonly string[];

  constructor(message: string, referencing: readonly string[]) {
    super(message);
    this.referencing = referencing;
  }
}
