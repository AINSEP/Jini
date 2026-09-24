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
import { describeMediaHtmlAttributeError, parseMediaHtmlAttributes } from "./html-attributes.js";

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
 * Renders a byte count as a human-readable MB figure for the size-cap rejection below (2026-09-21).
 * Every real caller passes a MiB-scale `maxUploadBytes` (10 MiB default, or a host override such as
 * Tovu's 50 MiB), so one decimal place is enough precision without ever showing a raw byte count —
 * the whole point of this fix (see `uploadMedia`'s size-cap check, and `agent-tools.ts`'s file header
 * for why the catalog description can no longer state a specific number either). `toFixed(1)`'s
 * trailing `.0` is trimmed so a clean multiple of 1 MB (the common case) reads as `10 MB`, not `10.0
 * MB`.
 *
 * @complexity O(1).
 */
function formatMaxUploadBytesAsMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const rounded = mb.toFixed(1);
  return `${rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded} MB`;
}

/**
 * Advisory MIME allowlist. SVG is deliberately EXCLUDED (not "TODO, forgot") —
 * SVG must be sanitized at ingest before it's safe to store;
 * that sanitizer is not built in this pass, so SVG upload is rejected rather
 * than accepted unsanitized.
 *
 * `image/avif` (owner-directed, 2026-09-06): a fifth still-image type, on the
 * same footing as the four above — `content-type-sniffer.ts` identifies it by
 * ISO-BMFF brand and the installed `sharp`/libvips build decodes it, so it
 * flows through the ordinary transform/rendition pipeline and is re-encoded
 * like any other image. Adding it required a matching sniffer fix, not just
 * this line: AVIF shares MP4's `ftyp` container tag, so before that fix an
 * AVIF was sniffed as `video/mp4` and served as an unplayable video.
 *
 * `video/mp4`/`video/webm` (owner-directed, 2026-08-24): the two formats
 * `content-type-sniffer.ts` already recognizes by magic bytes. Unlike the four
 * image types above, an accepted video is never re-encoded — there is no
 * `TransformFormat` for video (`transform-types.ts`'s union is image-only), so
 * a video asset's public URL bypasses the transform/rendition pipeline
 * entirely and serves the original bytes as-is (host concern; see the host's
 * `routes/site/media-rendition.ts`). This widens the SAME advisory,
 * client-declared-string check item 4 above already discloses as untrusted —
 * no new ingress hardening was added for video.
 */
export const DEFAULT_ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
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

/** Shared slug-format rule (2026-09-07) — same shape as `post`'s `SLUG_FORMAT_PATTERN`: lowercase
 *  letters, digits, and dashes only. Media slugs have no reserved-word list (`post`'s `admin`/`api`
 *  exclusions exist because a post slug can become a literal URL path segment a route dispatches
 *  on; a media slug is only ever a lookup key, never a route itself, so that hazard doesn't apply). */
const MEDIA_SLUG_FORMAT_PATTERN = /^[a-z0-9-]+$/;

/**
 * Slugs that spell a UUID are refused outright (2026-09-07 fix).
 *
 * A lowercase UUID is `[a-z0-9-]+` character for character, so {@link MEDIA_SLUG_FORMAT_PATTERN}
 * happily accepted one — and {@link findMediaByIdOrSlug} used to resolve SLUG FIRST, so pointing one
 * asset's slug at another asset's `id` silently took over every reference already authored against
 * that id (every `/m/{id}/…` URL a host's renderer has ever emitted for the victim). That resolution
 * order is now id-first, which closes the hijack for rows that already carry such a slug; this rule
 * is the write-path half — a slug that can only ever shadow an id is not a slug anyone wants, so it
 * is refused where a human can still see why rather than silently shadowed at read time.
 *
 * Shape-based, not a lookup: it rejects EVERY UUID-shaped value, not only ones that currently
 * collide, so a slug cannot become a hijack later when some future upload happens to mint that id.
 * Ordinary hex-and-dash slugs (`abc-123-def`, `2026-09-07-launch-clip`) are unaffected — nothing but
 * the exact 8-4-4-4-12 hex grouping matches.
 */
const MEDIA_SLUG_UUID_SHAPE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Shared slug max-length rule (2026-09-07) — same bound as `post.ts`'s `MAX_SLUG_LENGTH`, reused
 *  rather than inventing a second number. `post.ts` only enforces this on its EXPLICIT/caller-
 *  supplied slug path (`resolveExplicitSlug`, reject-with-error); its own title-derived path is
 *  uncapped. Media applies the same bound to BOTH paths, but differently per path's nature: an
 *  explicit edit ({@link resolveSlugForUpdate}) rejects with an error, exactly like `post.ts`,
 *  because a human typed it and should see why it was refused; a derived slug
 *  ({@link deriveUniqueMediaSlug}) truncates instead of rejecting, because nothing is prompting a
 *  human for a shorter value — silently truncating an internally-derived value is the same
 *  "coerce, don't fail" convention `deriveTitleFromFilename`/`slugifyMediaTitle` already use. */
const MEDIA_MAX_SLUG_LENGTH = 120;

export function isValidMediaSlugFormat(slug: string): boolean {
  return MEDIA_SLUG_FORMAT_PATTERN.test(slug) && !MEDIA_SLUG_UUID_SHAPE_PATTERN.test(slug);
}

/** Truncates a slug candidate to `maxLength`, stripping a trailing dash the cut can introduce (so a
 *  truncation never leaves a slug ending mid-word with a dangling "-"), falling back to `"untitled"`
 *  if nothing legible survives (only reachable when `maxLength` itself is tiny, e.g. while reserving
 *  room for a long numeric suffix — see {@link deriveUniqueMediaSlug}). A no-op when `candidate` is
 *  already within bounds. */
function capSlugCandidate(candidate: string, maxLength: number): string {
  if (candidate.length <= maxLength) return candidate;
  return candidate.slice(0, Math.max(maxLength, 0)).replace(/-+$/, "") || "untitled";
}

/** Turns free text into a slug candidate: lowercase, non-alphanumeric runs collapsed to one dash,
 *  leading/trailing dashes trimmed. Same algorithm as `post.ts`'s private `slugify` (duplicated, not
 *  imported — cross-repo: `post.ts` lives in the host, this file in `@jini-ai/cms`; this codebase's own
 *  precedent for a small hand-copied helper mirrored across a repo boundary is `DEFAULT_ALLOWED_MIME_TYPES`
 *  vs. the host's `FILE_HANDLER_ALLOWED_MIME_TYPES`/`IMPORTABLE_CONTENT_TYPES`). Never throws and never
 *  returns `undefined` — an all-punctuation input collapses to `""`, which every caller here treats
 *  as "derive nothing, fall back to a fixed default" rather than a malformed-input error. */
function slugifyMediaTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derives a unique-per-workspace slug from `title`, suffixing `-2`, `-3`, … on collision — the
 * identical loop shape `post.ts`'s `createPost` uses for its own derived-slug path. Shared by
 * {@link uploadMedia} (derive-on-create) and the backfill a host runs once for pre-existing rows
 * with no slug yet (see the host's `development/scripts/backfill-media-slugs.ts`).
 *
 * `base` falls back to `"untitled"` when `title` slugifies to the empty string (all-punctuation or
 * non-Latin titles that `slugifyMediaTitle` strips to nothing) — `uploadMedia`'s own title is never
 * empty (`deriveTitleFromFilename` guarantees a non-empty string), but the backfill script
 * (`development/scripts/backfill-media-slugs.ts`, host-side) calls this against arbitrary pre-existing
 * titles, so this fallback is load-bearing there, not just a defensive floor. Note this is the SAME
 * fallback base every empty-slugifying title collapses onto, so two such titles in one workspace
 * collide on `"untitled"` and are disambiguated by the ordinary suffix loop below exactly like any
 * other collision — an empty derived slug is never inserted as a bare empty string (which a unique
 * index would treat as one specific value, not "no value," and a SECOND empty string would then
 * violate it outright rather than surfacing a friendly conflict).
 *
 * `base` (after the empty-string fallback) is also capped at {@link MEDIA_MAX_SLUG_LENGTH} via
 * {@link capSlugCandidate} before any suffix is considered — a long machine-generated title must not
 * produce an equally long slug. When a collision forces a suffix, the BASE (never the suffix itself)
 * is re-truncated just enough to keep the whole `base-suffix` candidate within the cap, so every
 * candidate this loop ever checks already obeys the length bound, not just the first one.
 *
 * @complexity O(n) repo round-trips in the worst case, where n is the number of prior collisions on
 * the same base slug — bounded in practice by how many same-titled uploads exist in one workspace.
 */
async function deriveUniqueMediaSlug(mediaRepo: MediaRepoPort, workspaceId: UUID, title: string): Promise<string> {
  const base = capSlugCandidate(slugifyMediaTitle(title) || "untitled", MEDIA_MAX_SLUG_LENGTH);
  let slug = base;
  let suffix = 1;
  while (await mediaRepo.findBySlug({ workspaceId, slug })) {
    suffix += 1;
    const suffixText = `-${suffix}`;
    const truncatedBase = capSlugCandidate(base, MEDIA_MAX_SLUG_LENGTH - suffixText.length);
    slug = `${truncatedBase}${suffixText}`;
  }
  return slug;
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
 * overhead, not a scan) — plus {@link deriveUniqueMediaSlug}'s own O(n) in the number of prior
 * same-base-slug collisions (see that function's doc).
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
      `uploaded file exceeds the ${formatMaxUploadBytesAsMb(maxUploadBytes)} size cap`
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

  const title = deriveTitleFromFilename(input.filename);
  const slug = await deriveUniqueMediaSlug(deps.mediaRepo, input.workspaceId, title);

  const media: MediaRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    title,
    slug,
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
    htmlAttributes: null,
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

export interface FindMediaByIdOrSlugRequired {
  deps: { mediaRepo: MediaRepoPort };
  input: { workspaceId: UUID; idOrSlug: string };
}

/**
 * Resolves a media asset by either its id or its slug — ID FIRST, slug second. The slug is the
 * handle a human typed into an embed marker or a hand-authored `<img>`/`<video>` tag; the id is the
 * opaque UUID every existing reference already uses, and every URL a host's renderer emits.
 *
 * THE ORDER IS A SECURITY PROPERTY, not a preference (2026-09-07). This resolved slug-first, on the
 * documented assumption that "an id never collides with a slug in practice since slugs pass through
 * {@link isValidMediaSlugFormat}". That assumption was false: a lowercase UUID matched the old slug
 * pattern `[a-z0-9-]+` exactly, so setting asset B's slug to asset A's id made every `/m/{A.id}/…`
 * URL — the ones a renderer emitted for A, already live in published pages — resolve to B instead.
 * An id is minted by the system and is never a value a human chooses, so it must always win; the
 * write path additionally refuses UUID-shaped slugs now (see
 * {@link MEDIA_SLUG_UUID_SHAPE_PATTERN}), but ordering is what protects rows written before that
 * rule existed. Id-first costs nothing on the slug path: a real slug simply misses the id lookup and
 * falls through.
 *
 * Never throws (unlike {@link getMediaById}): every call site that needs this (an embed resolver, a
 * public rendition route) already has its own REQ-27-style non-throwing-miss contract, so this
 * returns `null` on failure and lets the caller apply its own not-found handling rather than forcing
 * one shape on every caller.
 *
 * @complexity O(1) — at most two indexed repo lookups, short-circuited on the first hit.
 */
export async function findMediaByIdOrSlug(
  required: FindMediaByIdOrSlugRequired,
  _optional: Record<string, never> = {}
): Promise<MediaRecord | null> {
  const { deps, input } = required;
  const byId = await deps.mediaRepo.findById({ workspaceId: input.workspaceId, id: input.idOrSlug });
  if (byId) return byId;
  return deps.mediaRepo.findBySlug({ workspaceId: input.workspaceId, slug: input.idOrSlug });
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
  /**
   * Explicit slug edit (2026-09-07). `undefined` (key omitted) leaves the stored slug unchanged —
   * in particular, changing `title` on the SAME call never touches `slug`; they are independent
   * fields by design (see `MediaRecord.slug`'s doc). Unlike `title`/`cssClass`, `slug` has no
   * "empty means unset" fallback: a media asset's slug is never null once assigned, so a caller
   * cannot clear it back to absent, only replace it with a different valid slug.
   */
  slug?: string | undefined;
  /**
   * Same undefined/null/value contract as `cssClass` above (2026-09-07). A provided non-empty string
   * is validated against `html-attributes.ts`'s allowlist BEFORE it is trimmed and stored — an `on*`
   * handler, a `javascript:` value, or any disallowed name throws `MediaValidationError` naming the
   * exact rejected attribute, and NOTHING is written (this field included) when that happens. A
   * string that validates but trims to empty is stored as `null`, matching `cssClass`'s identical
   * "empty means unset" convention.
   */
  htmlAttributes?: string | null | undefined;
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
 * Updates editorial-only fields (title/alt/caption/credit/slug/width/height/cssClass).
 * `source.sha256` is write-once — this function's input type has no `sha256` field,
 * so there is no code path here that can touch it (see `resolveWriteOnceSource`
 * doc for the directly-tested invariant this relies on).
 *
 * `slug` (2026-09-07) is validated and uniqueness-checked by {@link resolveSlugForUpdate} when
 * provided; every other field keeps its pre-existing undefined-means-unchanged contract.
 *
 * @complexity O(1) plus {@link resolveSlugForUpdate}'s own O(1) when `input.slug` is provided.
 * @overallScore 100
 */
/** Validates a `width`/`height` override: must be a positive integer. `null` (explicit clear) and
 *  `undefined` (leave unchanged) both bypass this — only a real provided number is checked. */
function assertPositiveIntegerOrThrow(value: number, field: "width" | "height"): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new MediaValidationError(`media.${field} must be a positive integer, got ${value}`);
  }
}

/**
 * Validates and normalizes an explicit `slug` edit, then enforces per-workspace uniqueness against
 * every OTHER row — an app-level courtesy check, not the enforcement itself (see `MediaRecord.slug`'s
 * doc): the host's DB unique index is what actually prevents two rows from landing on the same slug
 * under a concurrent write; this check only exists so a normal, non-racing caller sees a clear
 * `MediaConflictError` naming the conflict instead of a raw constraint-violation message surfacing
 * from whatever the host's repo adapter throws. Mirrors `post.ts`'s `assertSlugAvailableForUpdate`
 * (same "claiming your own current slug is not a conflict" rule).
 *
 * @complexity O(1) — one format check, one uniqueness lookup.
 */
async function resolveSlugForUpdate(mediaRepo: MediaRepoPort, workspaceId: UUID, id: UUID, rawSlug: string): Promise<string> {
  const slug = rawSlug.trim().toLowerCase();
  if (!slug || !isValidMediaSlugFormat(slug)) {
    throw new MediaValidationError(
      "slug must use lowercase letters, numbers, and dashes, and must not be shaped like a UUID"
    );
  }
  // Same bound and rejection style as `post.ts`'s `resolveExplicitSlug` — a human typed this value,
  // so it is refused with a clear reason rather than silently truncated (unlike the derived-on-
  // upload path, see `MEDIA_MAX_SLUG_LENGTH`'s doc).
  if (slug.length > MEDIA_MAX_SLUG_LENGTH) {
    throw new MediaValidationError(`slug must be ${MEDIA_MAX_SLUG_LENGTH} characters or fewer`);
  }
  const duplicate = await mediaRepo.findBySlug({ workspaceId, slug });
  if (duplicate && duplicate.id !== id) {
    throw new MediaConflictError(`slug '${slug}' is already used by media '${duplicate.id}'`);
  }
  return slug;
}

/**
 * Validates an explicit `htmlAttributes` edit against `html-attributes.ts`'s allowlist — a stored-
 * XSS boundary, not a syntax convenience (see `MediaRecord.htmlAttributes`'s own doc). Throws
 * `MediaValidationError` naming the exact rejected attribute the moment `parseMediaHtmlAttributes`
 * reports one; the caller (`updateMediaMetadata`) must never reach its own `save()` call when this
 * throws, so an invalid value is never partially or fully persisted. A value that validates but
 * trims to empty stores as `null`, matching `cssClass`'s identical "empty means unset" convention.
 *
 * @complexity O(n) in the input string's length (one `parseMediaHtmlAttributes` pass).
 */
function resolveHtmlAttributesForUpdate(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (trimmed === "") return null;
  const parsed = parseMediaHtmlAttributes(trimmed);
  if (parsed.error) {
    throw new MediaValidationError(`media.htmlAttributes: ${describeMediaHtmlAttributeError(parsed.error)}`);
  }
  return trimmed;
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
  const slug =
    input.slug !== undefined
      ? await resolveSlugForUpdate(deps.mediaRepo, input.workspaceId, input.id, input.slug)
      : existing.slug;
  // Validated BEFORE the record is built (same "fail before any write" discipline `assertPositive
  // IntegerOrThrow` above already follows) — an invalid value must never reach `save()`.
  const htmlAttributes =
    input.htmlAttributes !== undefined
      ? input.htmlAttributes === null
        ? null
        : resolveHtmlAttributesForUpdate(input.htmlAttributes)
      : existing.htmlAttributes;

  const media: MediaRecord = {
    ...existing,
    // `title` and `slug` are deliberately independent (see `MediaRecord.slug`'s doc): renaming the
    // title never recomputes `slug`, and editing `slug` never touches `title`.
    title: input.title !== undefined ? input.title.trim() || existing.title : existing.title,
    slug,
    alt: input.alt !== undefined ? input.alt.trim() : existing.alt,
    caption: input.caption !== undefined ? input.caption.trim() : existing.caption,
    credit: input.credit !== undefined ? input.credit.trim() : existing.credit,
    width: input.width !== undefined ? input.width : existing.width,
    height: input.height !== undefined ? input.height : existing.height,
    cssClass: input.cssClass !== undefined ? (input.cssClass === null ? null : input.cssClass.trim() || null) : existing.cssClass,
    htmlAttributes,
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

  await removeMediaRowsAndTombstoneBlob(deps, {
    workspaceId: input.workspaceId,
    id: input.id,
    sha256: existing.source.sha256,
  });

  return { purged: true };
}

/** Deps shared by both callers of {@link removeMediaRowsAndTombstoneBlob} — the subset of
 *  `PurgeMediaDeps` that cleanup actually needs (no `blobStore`: neither caller deletes bytes
 *  directly, only tombstones the row via `tombstoneBlobIfUnreferenced`). */
export interface MediaRowCleanupDeps {
  mediaRepo: MediaRepoPort;
  blobRepo: AssetBlobRepoPort;
  renditionRepo: AssetRenditionRepoPort;
  /** Optional — see `PurgeMediaDeps.clock`'s identical doc. */
  clock?: ClockPort | undefined;
}

/**
 * Shared row/blob cleanup: removes an asset's renditions and media row, then tombstones its blob
 * if-and-only-if no other active media row in the workspace still references the same sha256 (the
 * same predicate {@link tombstoneBlobIfUnreferenced} always applies). Used by both `purgeMedia`
 * (after its trash guard passes) and {@link rollbackUploadedMedia} (an unconditional internal
 * compensating rollback) — the same three-step deletion, triggered from two different callers.
 *
 * @complexity O(n) in the workspace's media row count, inherited from the tombstone-pass's
 * `isBlobUnreferenced` scan.
 */
async function removeMediaRowsAndTombstoneBlob(
  deps: MediaRowCleanupDeps,
  input: { workspaceId: UUID; id: UUID; sha256: string }
): Promise<void> {
  await deps.renditionRepo.removeByAsset({ workspaceId: input.workspaceId, assetId: input.id });
  await deps.mediaRepo.remove({ workspaceId: input.workspaceId, id: input.id });

  const clock = deps.clock ?? { nowIso: () => new Date().toISOString() };
  await tombstoneBlobIfUnreferenced({
    deps: { mediaRepo: deps.mediaRepo, blobRepo: deps.blobRepo, clock },
    input: { workspaceId: input.workspaceId, sha256: input.sha256 },
  });
}

export interface RollbackUploadedMediaRequired {
  deps: MediaRowCleanupDeps;
  input: { workspaceId: UUID; media: MediaRecord };
}

/**
 * Compensating rollback for {@link uploadMedia}: removes the rendition + media rows it just wrote
 * and tombstones the blob if no other active media row in the workspace still references its
 * sha256 (delegates to {@link removeMediaRowsAndTombstoneBlob}, `purgeMedia`'s own cleanup step).
 *
 * For a caller-side step that runs AFTER `uploadMedia()` has already committed and then fails
 * (e.g. `tool-registrations.ts`'s optional `recordUploadContentType` hook) — without this, the
 * rows `uploadMedia()` wrote survive as orphans (bytes and/or rows nothing points at) even though
 * the caller sees the whole upload as failed. Unlike `purgeMedia`, this performs no trashed-status
 * guard: it is an internal compensating action for a partially-failed operation, not a user-facing
 * delete.
 *
 * @complexity O(n) in the workspace's media row count, inherited from
 * {@link removeMediaRowsAndTombstoneBlob}.
 */
export async function rollbackUploadedMedia(
  required: RollbackUploadedMediaRequired,
  _optional: Record<string, never> = {}
): Promise<void> {
  const { deps, input } = required;
  await removeMediaRowsAndTombstoneBlob(deps, {
    workspaceId: input.workspaceId,
    id: input.media.id,
    sha256: input.media.source.sha256,
  });
}
