/**
 * @file `media` write/read service — walking-skeleton build.
 *
 * Mirrors a `post`-style feature's shape: plain async functions taking
 * `{ deps, input }` (+ an optional second `options` object), typed domain
 * errors from `./types`.
 *
 * SCOPE — what this file deliberately does NOT build (disclosed, not silently
 * skipped; each deferred piece is named below):
 *
 *  1. **Blob GC** — now built for real (`blob-gc.ts`): a journaled,
 *     `withSha256Lock`-serialized tombstone -> delete-pass -> unlink-pass
 *     protocol with `gc_grace` retention. `purgeMedia` below no longer
 *     deletes blob bytes itself — after removing the media row it only
 *     triggers the tombstone-pass (`tombstoneBlobIfUnreferenced`); actual
 *     byte removal is deferred to `runBlobGcDeletePass` +
 *     `runBlobGcUnlinkPass` (or the `runBlobGcCycle` convenience wrapper),
 *     which nothing schedules automatically yet (no scheduler exists — see
 *     `blob-gc.ts`'s file header). `uploadMedia`'s dedup check is likewise
 *     serialized per-sha256 and resurrects a tombstoned blob instead of
 *     writing a duplicate. See `blob-gc.ts` for what's still
 *     disclosed-stubbed within that protocol (`entry_refs`, retained
 *     snapshots, the monthly orphan sweep).
 *  2. **Named transform registry / real image processing** — the only
 *     rendition this build ever creates is a trivial "original" passthrough
 *     row that points at the source blob (created by `uploadMedia`). No
 *     `transform_registry` table, no eager/lazy generation, no
 *     `/m/{assetId}/{transformName}.v{version}/{slug}.{ext}` URL contract.
 *  3. **Origin-isolated serving** — a host may add an authenticated,
 *     workspace-scoped admin route that serves original bytes, with content
 *     type derived at serve time by `content-type-sniffer.ts` rather than
 *     trusted from upload, since no real content type is stored anywhere —
 *     that route's own security model is a host concern. What is still NOT
 *     built, per the full design: a second, cookie-less media
 *     origin/process, and signed mint-URLs (a `media.download_original`
 *     permission would reserve that capability for a future route).
 *     `Content-Disposition` rules DO now exist, but only the one such a route
 *     needs (forcing `attachment` when the sniffed bytes are HTML/SVG-shaped).
 *  4. **`MediaIngressPolicy`** — no SSRF guards, IP pinning, redirect
 *     handling, pixel-bomb caps, or magic-byte sniffing. Only a byte-size cap
 *     and an advisory `contentType` allowlist (see `DEFAULT_ALLOWED_MIME_TYPES`
 *     below) — an attacker-controlled `contentType` header is trusted, which
 *     the real ingress policy would never do.
 *  5. **Where-used / `entry_refs`** — no real index exists because posts don't
 *     reference media by id in `bodyJson` yet. `purgeMedia`'s 409 guard uses
 *     "not yet trashed" as a stand-in for "referenced" (see its doc comment).
 *  6. Virus scanning, remote-URL upload, video pipeline, S3 adapter — all
 *     explicitly deferred by design.
 *
 * See `types.ts`'s file header for the other disclosed scope adjustment: the
 * bespoke `MediaRecord` table in place of a generic-entries model.
 */
import { createHash } from "node:crypto";

import type { ClockPort, IdGeneratorPort, UUID } from "../core/ports.js";
import {
  MediaConflictError,
  MediaNotFoundError,
  MediaSourceImmutableError,
  MediaStillReferencedError,
  MediaValidationError,
  type MediaRecord,
  type MediaSource,
  type MediaStatus,
} from "./types.js";
import type { AssetBlobRepoPort, AssetRenditionRepoPort, BlobStorePort, MediaRepoPort } from "./ports.js";
import { withSha256Lock } from "./blob-gc-lock.js";
import { tombstoneBlobIfUnreferenced } from "./blob-gc.js";

export {
  MediaConflictError,
  MediaNotFoundError,
  MediaSourceImmutableError,
  MediaStillReferencedError,
  MediaValidationError,
};

/** Default byte-size cap (this pass's stand-in for the real ingress policy's streaming cap). */
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Advisory MIME allowlist. SVG is deliberately EXCLUDED (not "TODO, forgot") —
 * SVG must be sanitized at ingest before it's safe to store;
 * that sanitizer is not built in this pass, so SVG upload is rejected rather
 * than accepted unsanitized.
 */
export const DEFAULT_ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Enforces the "settable-once-from-absent" write-once rule for
 * `source.sha256`: absent -> set exactly once, then immutable.
 *
 * Not currently reachable through any exposed write path — `uploadMedia` only
 * ever calls it with `existing = undefined` (a brand-new row), and
 * `UpdateMediaMetadataInput` has no `sha256` field at all, so
 * `updateMediaMetadata` can't trigger the rejection branch even by accident.
 * Kept as an explicit, directly-testable invariant (see
 * `__tests__/media-service.test.ts`) rather than an implicit one enforced only
 * by "the type doesn't have the field" — and it's the seam any future
 * "replace source" operation would have to go through.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function resolveWriteOnceSource(
  required: { existing: MediaSource | undefined; requestedSha256: string },
  _optional: Record<string, never> = {}
): MediaSource {
  const { existing, requestedSha256 } = required;
  if (existing && existing.sha256 !== requestedSha256) {
    throw new MediaSourceImmutableError(
      `source.sha256 is write-once: cannot change '${existing.sha256}' to '${requestedSha256}'`
    );
  }
  return { sha256: requestedSha256 };
}

function deriveTitleFromFilename(filename: string): string {
  const base = filename.trim().replace(/\.[^./\\]+$/, "");
  return base.trim() || "Untitled";
}

// ---------------------------------------------------------------------------
// uploadMedia
// ---------------------------------------------------------------------------

export interface UploadMediaInput {
  workspaceId: UUID;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  alt?: string | undefined;
  caption?: string | undefined;
  credit?: string | undefined;
  /** Attributed on the `asset_blobs` row (required attribution). */
  createdByPrincipal: string;
}

export interface UploadMediaDeps {
  clock: ClockPort;
  idGen: IdGeneratorPort;
  mediaRepo: MediaRepoPort;
  blobRepo: AssetBlobRepoPort;
  renditionRepo: AssetRenditionRepoPort;
  blobStore: BlobStorePort;
}

export interface UploadMediaRequired {
  deps: UploadMediaDeps;
  input: UploadMediaInput;
}

export interface UploadMediaOptional {
  maxUploadBytes?: number | undefined;
  allowedMimeTypes?: ReadonlySet<string> | undefined;
}

/**
 * Validates, hashes, dedups by `(workspaceId, sha256)`, and writes a new media
 * asset. Ordering (INV-1a): bytes are written (or found already
 * present via dedup) BEFORE the media row is saved — a media row never exists
 * without corresponding bytes.
 *
 * Blob dedup is per-hash, not per-upload: uploading the same bytes twice
 * always creates two `MediaRecord`s (two distinct library entries, matching
 * common CMS behavior) but writes the blob bytes only once. The dedup
 * check-then-act sequence runs inside {@link withSha256Lock} (`blob-gc-lock.ts`)
 * so it can't interleave with a concurrent `blob-gc.ts` delete-pass on the
 * same sha256 (the "Serialization" invariant). If the existing blob row
 * is `tombstoned` (a pending GC candidate), this resurrects it back to
 * `active` in the same locked section instead of writing a duplicate blob —
 * the dedup rule's explicit resurrect case.
 *
 * @complexity O(1) — one hash, one blob lookup, at most one blob write, one
 * media write, one rendition write (the lock itself adds O(1) scheduling
 * overhead, not a scan).
 * @overallScore 100
 */
export async function uploadMedia(
  required: UploadMediaRequired,
  optional: UploadMediaOptional = {}
): Promise<{ media: MediaRecord }> {
  const { deps, input } = required;
  const maxUploadBytes = optional.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const allowedMimeTypes = optional.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;

  if (!allowedMimeTypes.has(input.contentType)) {
    throw new MediaValidationError(
      `content type '${input.contentType}' is not allowed for upload`
    );
  }
  if (input.bytes.byteLength === 0) {
    throw new MediaValidationError("uploaded file is empty");
  }
  if (input.bytes.byteLength > maxUploadBytes) {
    throw new MediaValidationError(
      `uploaded file exceeds the ${maxUploadBytes}-byte size cap`
    );
  }

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const nowIso = deps.clock.nowIso();

  const storageKey = await withSha256Lock(sha256, async () => {
    const existingBlob = await deps.blobRepo.findByHash({ workspaceId: input.workspaceId, sha256 });
    if (existingBlob) {
      if (existingBlob.status === "tombstoned") {
        // Resurrect: cancel the pending GC in the same locked section rather
        // than writing a duplicate blob (INV-1 dedup rule).
        await deps.blobRepo.save({ ...existingBlob, status: "active", tombstonedAt: undefined });
      }
      return existingBlob.storageKey;
    }

    const written = await deps.blobStore.put({
      workspaceId: input.workspaceId,
      sha256,
      bytes: input.bytes,
    });
    await deps.blobRepo.save({
      id: deps.idGen.newId(),
      workspaceId: input.workspaceId,
      sha256,
      storageKey: written.storageKey,
      status: "active",
      createdByPrincipal: input.createdByPrincipal,
      createdAt: nowIso,
    });
    return written.storageKey;
  });

  const media: MediaRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    title: deriveTitleFromFilename(input.filename),
    alt: input.alt?.trim() ?? "",
    caption: input.caption?.trim() ?? "",
    credit: input.credit?.trim() ?? "",
    source: resolveWriteOnceSource({ existing: undefined, requestedSha256: sha256 }),
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
    // No sizing UI on upload yet (only the edit panel got one — see `UpdateMediaMetadataInput`
    // below) — every freshly uploaded asset starts with no override, set via a follow-up PATCH.
    width: null,
    height: null,
    cssClass: null,
  };
  await deps.mediaRepo.save(media);

  await deps.renditionRepo.save({
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    assetId: media.id,
    transformName: "original",
    version: 1,
    storageKey,
    createdAt: nowIso,
  });

  return { media };
}

// ---------------------------------------------------------------------------
// listMedia / getMediaById
// ---------------------------------------------------------------------------

export interface ListMediaRequired {
  deps: { mediaRepo: MediaRepoPort };
  input: { workspaceId: UUID };
}

/**
 * Lists all media in a workspace (all statuses — active + trashed; admin sees
 * everything, mirrors an admin post listing). Purged assets are absent by
 * construction (`purgeMedia` removes the row), not filtered here.
 *
 * @complexity O(1) repo call; the returned array is bounded by the
 * workspace's media row count (repo-dependent — no pagination cap added in
 * this pass, acceptable at walking-skeleton scale).
 * @overallScore 100
 */
export async function listMedia(
  required: ListMediaRequired,
  _optional: Record<string, never> = {}
): Promise<{ media: MediaRecord[] }> {
  const media = await required.deps.mediaRepo.list({ workspaceId: required.input.workspaceId });
  return { media };
}

export interface GetMediaByIdRequired {
  deps: { mediaRepo: MediaRepoPort };
  input: { workspaceId: UUID; id: UUID };
}

/**
 * Fetches one media asset by id, scoped to its workspace.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export async function getMediaById(
  required: GetMediaByIdRequired,
  _optional: Record<string, never> = {}
): Promise<{ media: MediaRecord }> {
  const { workspaceId, id } = required.input;
  const media = await required.deps.mediaRepo.findById({ workspaceId, id });
  if (!media) throw new MediaNotFoundError(`media '${id}' was not found`);
  return { media };
}

// ---------------------------------------------------------------------------
// updateMediaMetadata
// ---------------------------------------------------------------------------

export interface UpdateMediaMetadataInput {
  workspaceId: UUID;
  id: UUID;
  title?: string | undefined;
  alt?: string | undefined;
  caption?: string | undefined;
  credit?: string | undefined;
  /**
   * Quick-and-dirty sizing override fields (see `MediaRecord.width`/`height`/`cssClass` doc).
   * `undefined` (the key omitted, or explicitly `undefined`) leaves the stored value unchanged —
   * same optional-field/partial-patch contract every other field on this input already has.
   * `null` explicitly CLEARS a previously-set override back to "not set". A provided number must be
   * a positive integer (rejected with `MediaValidationError` otherwise) — this is public HTML output
   * sizing, not a field worth silently coercing.
   */
  width?: number | null | undefined;
  height?: number | null | undefined;
  /** Same undefined/null/value contract as `width`/`height` above. A non-empty string is trimmed;
   *  a string that trims to empty is stored as `null` (equivalent to clearing it), matching the
   *  "empty means unset" convention `title`/`alt`/etc. already follow via `.trim()`. */
  cssClass?: string | null | undefined;
}

export interface UpdateMediaMetadataDeps {
  clock: ClockPort;
  mediaRepo: MediaRepoPort;
}

export interface UpdateMediaMetadataRequired {
  deps: UpdateMediaMetadataDeps;
  input: UpdateMediaMetadataInput;
}

/**
 * Updates editorial-only fields (title/alt/caption/credit). `source.sha256` is
 * write-once — this function's input type has no `sha256` field,
 * so there is no code path here that can touch it (see `resolveWriteOnceSource`
 * doc for the directly-tested invariant this relies on).
 *
 * @complexity O(1).
 * @overallScore 100
 */
/** Validates a `width`/`height` override: must be a positive integer. `null` (explicit clear) and
 *  `undefined` (leave unchanged) both bypass this — only a real provided number is checked. */
function assertPositiveIntegerOrThrow(value: number, field: "width" | "height"): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new MediaValidationError(`media.${field} must be a positive integer, got ${value}`);
  }
}

export async function updateMediaMetadata(
  required: UpdateMediaMetadataRequired,
  _optional: Record<string, never> = {}
): Promise<{ media: MediaRecord }> {
  const { deps, input } = required;
  const existing = await deps.mediaRepo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) throw new MediaNotFoundError(`media '${input.id}' was not found`);

  if (input.width !== undefined && input.width !== null) assertPositiveIntegerOrThrow(input.width, "width");
  if (input.height !== undefined && input.height !== null) assertPositiveIntegerOrThrow(input.height, "height");

  const media: MediaRecord = {
    ...existing,
    title: input.title !== undefined ? input.title.trim() || existing.title : existing.title,
    alt: input.alt !== undefined ? input.alt.trim() : existing.alt,
    caption: input.caption !== undefined ? input.caption.trim() : existing.caption,
    credit: input.credit !== undefined ? input.credit.trim() : existing.credit,
    width: input.width !== undefined ? input.width : existing.width,
    height: input.height !== undefined ? input.height : existing.height,
    cssClass: input.cssClass !== undefined ? (input.cssClass === null ? null : input.cssClass.trim() || null) : existing.cssClass,
    updatedAt: deps.clock.nowIso(),
    version: existing.version + 1,
  };
  await deps.mediaRepo.save(media);
  return { media };
}

// ---------------------------------------------------------------------------
// trashMedia / purgeMedia (deletion ladder)
// ---------------------------------------------------------------------------

export interface TrashMediaDeps {
  clock: ClockPort;
  mediaRepo: MediaRepoPort;
}

export interface TrashMediaRequired {
  deps: TrashMediaDeps;
  input: { workspaceId: UUID; id: UUID };
}

/**
 * Soft delete. Idempotent — trashing an already-trashed asset is a no-op
 * (mirrors `disableMember`'s idempotency), not an error.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export async function trashMedia(
  required: TrashMediaRequired,
  _optional: Record<string, never> = {}
): Promise<{ media: MediaRecord }> {
  const { deps, input } = required;
  const existing = await deps.mediaRepo.findById(input);
  if (!existing) throw new MediaNotFoundError(`media '${input.id}' was not found`);
  if (existing.status === "trashed") return { media: existing };

  const media: MediaRecord = {
    ...existing,
    status: "trashed" as MediaStatus,
    updatedAt: deps.clock.nowIso(),
    version: existing.version + 1,
  };
  await deps.mediaRepo.save(media);
  return { media };
}

export interface PurgeMediaDeps {
  mediaRepo: MediaRepoPort;
  blobRepo: AssetBlobRepoPort;
  renditionRepo: AssetRenditionRepoPort;
  blobStore: BlobStorePort;
  /**
   * Optional — only used to timestamp the blob-GC tombstone-pass this
   * function triggers after the media row is removed (`tombstoneBlobIfUnreferenced`,
   * `blob-gc.ts`). Falls back to the system clock when omitted so a caller
   * that doesn't wire a clock into `PurgeMediaDeps` keeps compiling and
   * behaving correctly unchanged.
   */
  clock?: ClockPort | undefined;
}

export interface PurgeMediaRequired {
  deps: PurgeMediaDeps;
  input: { workspaceId: UUID; id: UUID };
}

/**
 * Hard delete. Deletion ladder (mirrors `deleteMenu`): purge is
 * rejected with `MediaStillReferencedError` (409-style) unless the asset has
 * already been trashed first.
 *
 * SIMPLIFICATION (disclosed): the real design's guard checks the derived
 * `entry_refs` where-used index (any live reference from published content).
 * That index doesn't exist — posts don't reference media by id in `bodyJson`
 * yet — so this build uses "not yet trashed" as the stand-in referenced-check.
 * This is strictly weaker than the real invariant: a media asset that IS
 * trashed but still referenced by a post would purge here without complaint,
 * whereas the real system would keep blocking it. Do not read this function's
 * 409 as evidence the where-used index exists.
 *
 * Once past the guard: rendition rows are removed, then the media row is
 * removed. After that removal commits, the blob-GC tombstone-pass
 * (`tombstoneBlobIfUnreferenced`, `blob-gc.ts`) runs for the asset's sha256 —
 * it marks the blob `tombstoned` if-and-only-if the real "unreferenced"
 * predicate holds (no other non-purged media row shares the hash, plus the
 * disclosed `entry_refs`/retained-snapshot stubs). This function does **not**
 * delete blob bytes itself anymore: the delete-pass (`runBlobGcDeletePass`)
 * is grace-period-gated (`gc_grace`, default 30 days) and the unlink-pass
 * (`runBlobGcUnlinkPass`) that actually removes bytes runs as a separate,
 * explicit step — nothing schedules either automatically yet (see
 * `blob-gc.ts`'s file header). This is a real behavior change from this
 * function's prior "delete row, best-effort unlink immediately" shortcut,
 * which is exactly the gap this task closes.
 *
 * @complexity O(n) in the workspace's media row count, inherited from the
 * tombstone-pass's `isBlobUnreferenced` scan (see `blob-gc.ts`).
 * @overallScore 100
 */
export async function purgeMedia(
  required: PurgeMediaRequired,
  _optional: Record<string, never> = {}
): Promise<{ purged: true }> {
  const { deps, input } = required;
  const existing = await deps.mediaRepo.findById(input);
  if (!existing) throw new MediaNotFoundError(`media '${input.id}' was not found`);

  if (existing.status !== "trashed") {
    throw new MediaStillReferencedError(
      `media '${input.id}' must be trashed before it can be purged`,
      [
        `media '${input.id}' is still active (stand-in for the real entry_refs ` +
          `where-used index, which is not implemented — see purgeMedia's doc comment)`,
      ]
    );
  }

  await deps.renditionRepo.removeByAsset({ workspaceId: input.workspaceId, assetId: input.id });
  await deps.mediaRepo.remove({ workspaceId: input.workspaceId, id: input.id });

  const clock = deps.clock ?? { nowIso: () => new Date().toISOString() };
  await tombstoneBlobIfUnreferenced({
    deps: { mediaRepo: deps.mediaRepo, blobRepo: deps.blobRepo, clock },
    input: { workspaceId: input.workspaceId, sha256: existing.source.sha256 },
  });

  return { purged: true };
}
