/**
 * @file Domain types + typed errors for the `media` library.
 *
 * Purpose:
 * `MediaRecord` is the editorial half of a media asset; `AssetBlobRecord` and
 * `AssetRenditionRecord` are the two core-owned operational sidecars the
 * original design specifies.
 *
 * SCOPE NOTE (disclosed, not a silent deviation): the original design describes media as a
 * seeded `entries` content-type entry — editorial fields live under
 * `bodyJson.$.source`/`fields.ext.media.*` on a generic entry row, with
 * revisions/taxonomy/`entry_refs` for free. That generic `entries` model does
 * not exist as running code in the host that first built this yet (it is
 * accepted design only; `post` itself is still a bespoke first-class table,
 * not a generic entry). `MediaRecord` below is therefore built the same way a
 * bespoke `post`-style record is built: a bespoke record with its editorial
 * fields inlined directly. When a generic entries system ships, `media`
 * should migrate onto it the same way `post` eventually will — this file is
 * not a competing permanent design, it is that pattern applied to media.
 *
 * The two sidecars (`AssetBlobRecord`, `AssetRenditionRecord`) ARE built as
 * the original design describes — they were always meant to be core-owned tables
 * independent of the entries model, so no scope adjustment was needed there.
 */
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";

/** Deletion ladder status (mirrored from `navigation`'s menu ladder). */
export type MediaStatus = "active" | "trashed";
export type MediaKind = "media" | "document";

/**
 * Write-once source binding — the edge from a media record to its bytes.
 * "Settable-once-from-absent" (absent -> set exactly once, then
 * immutable). In this bespoke-table build every `MediaRecord` gets its
 * `source` set at creation time by `uploadMedia` (never a row without bytes),
 * so in practice the absent state is transient/internal
 * to `uploadMedia`, not something the write-once guard needs to police at the
 * repo/API boundary. The guard exists anyway (`assertSourceUnchanged` in
 * `media-service.ts`) as the enforced invariant for any future write path.
 */
export interface MediaSource {
  /** Private ingress such as submitted files; never exposed by public media routes. */
  private?: true;
  sha256: string;
  /** Sniffed media MIME (document policy MIME for private documents); absent for legacy rows. */
  contentType?: string | undefined;
  /** Origin of this editorial item, independent of the deduplicated blob's creator. */
  provenance?: MediaProvenance | undefined;
}

export type MediaProvenance =
  | { kind: 'url'; url: string }
  | { kind: 'picked-folder'; path: string }
  | { kind: 'upload'; path?: string | undefined }
  /** `model`/`provider` name the exact image model id and vendor id that produced the bytes, so the
   * library and the assistant can say which generator made an asset. Optional: rows written before
   * 2026-11-13 carry neither and still parse. */
  | { kind: 'generated'; path?: string | undefined; model?: string | undefined; provider?: string | undefined };

export interface MediaRecord {
  /** Absent only in legacy callers/serialized records; persistent adapters default to media. */
  kind?: MediaKind | undefined;
  /** Immutable upload name; editable title is the display stem. Never a storage path. */
  originalFilename?: string | null | undefined;
  id: UUID;
  workspaceId: UUID;
  /** Acting principal at asset creation, independent of the producer/model and editable credit.
   * Optional/null for records written before attribution existed. Never inferred from a shared
   * blob's owner: identical bytes may have been uploaded by different principals. */
  createdBy?: string | null | undefined;
  title: string;
  /**
   * Human-memorable, unique-per-workspace lookup key (owner-directed, 2026-09-07) — an ADDITIONAL
   * key alongside `id`, never a replacement: `id` stays the canonical primary key every existing
   * embed/reference resolves by, and this column only gives a second, human-typeable way to reach
   * the same row (`findMediaByIdOrSlug` in `media-service.ts` tries this first, `id` second).
   *
   * Derived from `title` at upload time (`deriveMediaSlug`), then independently editable afterward
   * — renaming `title` does NOT recompute this field; it changes only on an explicit `slug` write.
   * Unique per `(workspaceId, slug)`, enforced by the host's own DB index (see the host's
   * `idx_media_workspace_slug`) — `updateMediaMetadata`'s own `findBySlug` check is a friendly-error
   * courtesy on top of that, not the enforcement itself, the same split `posts_workspace_slug_unique`
   * already establishes for `post`'s identical `slug` field.
   */
  slug: string;
  alt: string;
  caption: string;
  credit: string;
  /**
   * Plain-language description of what the media shows, written for search (an agent can fill it in
   * after looking at an image). Optional, unlike `caption`: absent means "never described", and a host
   * repo adapter with no column for it keeps compiling and round-tripping its rows unchanged. Once
   * written, an empty string is its cleared form, the same as `caption`. Bounded by
   * `MEDIA_MAX_DESCRIPTION_LENGTH` (`media-service.ts`).
   */
  description?: string | undefined;
  /** Write-once (see {@link MediaSource} doc). Always set by the time a row exists. */
  source: MediaSource;
  status: MediaStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
  /**
   * Quick-and-dirty public-render sizing fields (owner-directed skip-the-ADR fix — "should we have
   * more lines on the upload/edit media page for css tags and height and width?"). An operator-set
   * per-asset override the public site's renderer threads onto the `<img>` tag so an inserted image
   * stops rendering at full native pixel width with nothing constraining it. `null` means "not set"
   * — a host renderer must omit the corresponding attribute entirely rather than emit `width="null"`
   * or coerce to `0`. Always present (never `undefined`) so every existing `MediaRecord` construction
   * site is forced to make an explicit choice; `uploadMedia` defaults all three to `null`.
   */
  width: number | null;
  height: number | null;
  cssClass: string | null;
  /**
   * Owner-directed (2026-09-07) free-text HTML attributes threaded onto this asset's public
   * `<img>`/`<video>` tag (stated uses: animations, custom WebMCP hooks) — raw, ALREADY-VALIDATED
   * source text (e.g. `data-motion="fade-in" loading="lazy"`), the same "one string column, `null`
   * means not set" shape {@link cssClass} already establishes; `null` by default. This is a stored-
   * XSS boundary: `updateMediaMetadata` validates it against `html-attributes.ts`'s allowlist before
   * ever writing it (`on*` handlers, `javascript:` values, and any name not on the allowlist are
   * rejected outright, never sanitized), and a host's render path must re-validate before emitting
   * it onto a real tag rather than trusting a stored value was never written by an older code path
   * or a direct DB edit.
   */
  htmlAttributes: string | null;
  /**
   * G7-9: optional WebVTT captions for a video/audio asset — a reference to a sibling `.vtt` media
   * row plus its language, never the cue text itself. Optional so a host adapter with no column for it
   * keeps compiling; `null` means "no captions". The public renderer resolves it to that asset's
   * `/m/.../original.vtt` URL and still refuses anything that is not a same-origin `.vtt` path.
   */
  captions?: MediaCaptionsTrack | null | undefined;
}

/** A video/audio asset's captions reference (G7-9): which sibling WebVTT asset, and its language. */
export interface MediaCaptionsTrack {
  /** Id of the `.vtt` media asset holding the cues; the host resolves it to its public URL. */
  assetId: UUID;
  /** BCP 47 language tag of the cues (`en`, `pt-BR`). */
  srclang: string;
  /** Human label for the player's captions menu; `null`/absent lets the browser choose. */
  label?: string | null | undefined;
}

/**
 * Blob-GC lifecycle status ( two-phase journaled protocol,
 * implemented in `blob-gc.ts`). `active` — has at least one live reference as
 * of the last check (or has never been checked). `tombstoned` — the
 * tombstone-pass found it unreferenced and is waiting out `gc_grace` before
 * the delete-pass may remove the row; a dedup upload observing `tombstoned`
 * resurrects it back to `active` in the same locked section instead of
 * writing a duplicate blob.
 * See docs/decisions/DR-004-journaled-blob-gc.md.
 */
export type AssetBlobStatus = "active" | "tombstoned";

/**
 * `asset_blobs` sidecar: physical bytes metadata. Identity is
 * `(workspaceId, sha256)` — dedup is per-workspace, no cross-tenant byte
 * sharing.
 */
export interface AssetBlobRecord {
  id: UUID;
  workspaceId: UUID;
  sha256: string;
  storageKey: string;
  /** Required attribution (machine writes still stamp a principal). */
  createdByPrincipal: string;
  createdAt: ISODateTime;
  /** See {@link AssetBlobStatus}. Always `"active"` for a freshly written blob. */
  status: AssetBlobStatus;
  /** Set only while `status === "tombstoned"`; cleared (undefined) on resurrect. */
  tombstonedAt?: ISODateTime | undefined;
  /** Sticky private/document ownership until blob GC: purge deletes editorial rows before deleting bytes.
   * Absent/false means no recorded document owner; saves must never clear a true value. */
  documentOwned?: boolean | undefined;
}

/**
 * `blob_gc_journal` sidecar ( two-phase protocol,
 * `blob-gc.ts`): written by the delete-pass in the same locked step as the
 * `asset_blobs` row deletion, drained by the unlink-pass. This is what makes
 * the unlink crash-safe/retriable instead of "delete row, hope the unlink
 * happens" — a journal entry surviving between the two passes is the seam a
 * crash-recovery sweep would resume from. (This build's journal is an
 * in-memory table like every other `media` repo in this pass — it does not
 * survive a process restart; see `repo.memory.ts` file header for the
 * standing disclosed precedent.)
 * See docs/decisions/DR-004-journaled-blob-gc.md.
 */
export interface BlobGcJournalEntry {
  id: UUID;
  workspaceId: UUID;
  sha256: string;
  storageKey: string;
  journaledAt: ISODateTime;
}

/**
 * `asset_renditions` sidecar: derived variants. This build has no
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

export class MediaNotFoundError extends Error {
  constructor({ message }: { message: string }, optionalArgs: ErrorOptions = {}) {
    super(message, optionalArgs);
  }
}
export class MediaValidationError extends Error {
  constructor({ message }: { message: string }, optionalArgs: ErrorOptions = {}) {
    super(message, optionalArgs);
  }
}
export class MediaConflictError extends Error {
  constructor({ message }: { message: string }, optionalArgs: ErrorOptions = {}) {
    super(message, optionalArgs);
  }
}

/**
 * The write-once source guard rejected an attempt to change an
 * already-set `source.sha256` ("settable-once-from-absent").
 */
export class MediaSourceImmutableError extends MediaValidationError {
  constructor({ message }: { message: string }, optionalArgs: ErrorOptions = {}) {
    super({ message }, optionalArgs);
  }
}

/**
 * The 409-style purge rejection (deletion ladder, mirrors
 * `MenuLocationBoundError`). `referencing` is a human-readable stand-in list —
 * see `media-service.ts` file header for the disclosed simplification (no real
 * `entry_refs` where-used index exists yet).
 */
export class MediaStillReferencedError extends MediaConflictError {
  readonly referencing: readonly string[];

  constructor(requiredArgs: { message: string; referencing: readonly string[] }, optionalArgs: Record<string, never> = {}) {
    const { message, referencing } = requiredArgs;
    super({ message: message });
    this.referencing = referencing;
  }
}
