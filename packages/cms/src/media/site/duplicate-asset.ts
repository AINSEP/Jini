import {
  findMediaByIdOrSlug,
  updateMediaMetadata,
  sniffContentType,
  type MediaRecord,
  type MediaToolDeps,
} from "../index.js";
import { ToolInputError } from "@jini-ai/core";
import { rollbackUploadedMedia, uploadMedia } from "../index.js";

import type { DuplicateResourceHandlerContributor } from "@jini-ai/core/contracts/site/assistant-tool-contributions";
import type { MediaPublicUrlDeps } from "./contracts.js";
import { MAX_DOCUMENT_BYTES as MAX_UPLOAD_BYTES } from "../index.js";

/**
 * @file `content_duplicate`'s `"media"` resource — the third resource, and the only one whose rows
 * are not the whole story: a media asset has BYTES behind it.
 *
 * ## The decision this file exists to make: a copy REFERENCES the same bytes, it never duplicates them
 *
 * That is forced by the storage model, not a preference between two workable options.
 * `AssetBlobRecord`'s identity is `(workspaceId, sha256)` and `BlobStorePort` is content-addressed
 * (`computeBlobStorageKey` derives the key from the hash), so "write a second copy of these bytes"
 * is not representable — identical bytes always resolve to the same blob row and the same storage
 * key. There is no second physical copy to be had, and asking for one would only mean writing a
 * duplicate ROW pointing at the same object, which is strictly worse than sharing one.
 *
 * So this handler routes the copy through `uploadMedia` with the SOURCE's own bytes, and inherits
 * exactly the semantics that package already documents and tests: *"uploading the same bytes twice
 * always creates two `MediaRecord`s (two distinct library entries, matching common CMS behavior) but
 * writes the blob bytes only once"*. Two further properties come along with going through
 * `uploadMedia` rather than hand-writing rows, and both are reasons not to hand-write them:
 *
 * 1. The dedup check-then-act runs inside `withSha256Lock`, so it cannot interleave with a
 *    concurrent blob-GC delete-pass on the same hash — and if the source's blob happens to be
 *    `tombstoned` (a pending GC candidate), it is RESURRECTED to `active` in that same locked
 *    section. A hand-rolled copy would happily point a brand-new row at a blob about to be deleted.
 * 2. `AssetRenditionRecord` is keyed by `assetId`, not by hash, so the copy needs its own rendition
 *    rows to be addressable at its own `/m/<id>/...` URL. `uploadMedia` writes the "original"
 *    rendition as part of its normal path.
 *
 * **What the operator actually gets, stated plainly** (and stated the same way in the
 * `content_duplicate` catalog entry, so the model tells them the same thing): a new library entry
 * with its own id, its own slug, and its own editorial fields — title, alt text, caption, credit,
 * width/height, CSS class, HTML attributes — pointing at the same image or video. Editing the copy's
 * alt text does not touch the original's. Deleting one does not break the other: the underlying
 * bytes survive as long as any row still references them. What it is NOT is a second file on disk,
 * and nothing here pretends otherwise.
 */

/** The exact `content_duplicate` handler input this resource reads. */
interface DuplicateMediaInput {
  principalId: string;
  id: string;
  overrides: { title?: string; slug?: string; status?: string };
}

/**
 * The host's content-duplication naming policy (numeric-suffix default copy titles), injected so the
 * copy's default title follows the same rule as the host's other `content_duplicate` resources.
 */
export type DeriveDuplicateName = (required: { sourceName: string }, options: {
  isTaken: (required: { candidate: string }, optional?: Record<string, never>) => Promise<boolean>;
}) => Promise<string>;

/** Required args for {@link contributeMediaDuplicateHandlers}. */
export interface ContributeMediaDuplicateHandlersArgs extends DuplicateCaps {
  deriveDuplicateName: DeriveDuplicateName;
}

/** The two caps the copy's re-upload is checked against. Omitted: the 50 MiB general cap, and video
 *  follows it — so a host that never sets a video cap sees no change. The re-upload goes through
 *  `uploadMedia`, which picks between the two by the file's sniffed type. */
type DuplicateCaps = { maxUploadBytes?: number | undefined; maxVideoUploadBytes?: number | undefined };

/**
 * Resolves the content type to re-upload the copy under.
 *
 * PREFERS the type already recorded for these exact bytes over a fresh sniff, and that ordering is
 * load-bearing rather than an optimization: `uploadMedia` validates `contentType` against an
 * allowlist, and `sniffContentType` falls back to `application/octet-stream` for anything outside its
 * fixed magic-byte table (a PDF, say). Sniffing first would therefore make some already-accepted
 * assets un-copyable — the recorded value, by contrast, was itself produced by a sniff of these same
 * bytes at upload time AND already passed that allowlist once, so it is both trustworthy and known
 * acceptable. The sniff is the fallback for an older asset that predates the content-type store.
 *
 * Never a caller-declared string: there isn't one, and there must not be — see
 * the host media tool registrations' `buildRecordUploadContentType` for the same discipline on the upload path.
 *
 * @complexity One batched store read plus, only on the fallback path, `sniffContentType`'s own
 * fixed-window scan.
 */
async function resolveCopyContentType(
  { routeDeps, sha256, bytes }: { routeDeps: MediaToolDeps & MediaPublicUrlDeps; sha256: string; bytes: Uint8Array },
  _optional: Record<string, never> = {}
): Promise<string> {
  const recorded = await routeDeps.mediaContentTypeStore?.getMany({ workspaceId: routeDeps.workspaceId, sha256s: [sha256] });
  return recorded?.get(sha256) ?? sniffContentType({ bytes });
}

/**
 * Derives `content_duplicate`'s default title for a media copy through the host's injected
 * `deriveDuplicateName` (see that host module's header for the owner's numeric-suffix ruling).
 * Only ever called when the caller supplied no explicit `overrides.title`; an explicit one wins
 * outright and this performs no scan at all.
 *
 * @complexity O(1) when `overrideTitle` is given. Otherwise one `mediaRepo.list()` scan (17 rows at
 * current scale, read live 2026-09-08 — see the shared module's own header for why this is an
 * accepted O(n) scan rather than a new port method), then `deriveDuplicateName`'s own bounded search.
 */
async function resolveDuplicateTitle(
  { routeDeps, deriveDuplicateName, source, overrideTitle }: { routeDeps: MediaToolDeps; deriveDuplicateName: DeriveDuplicateName; source: MediaRecord; overrideTitle: string | undefined },
  _optional: Record<string, never> = {}
): Promise<string> {
  if (overrideTitle !== undefined) return overrideTitle;
  const existingTitles = new Set(
    (await routeDeps.mediaRepo.list({ workspaceId: routeDeps.workspaceId })).map((asset) => asset.title)
  );
  return deriveDuplicateName(
    { sourceName: source.title },
    { isTaken: async ({ candidate }, _optional = {}) => existingTitles.has(candidate) }
  );
}

/**
 * Copies every editorial field `uploadMedia` does not already take, onto the freshly created row.
 *
 * Split out from {@link duplicateMediaAsset} because it is the part that must stay in step with
 * `MediaRecord`'s own field list: a field added to the record and forgotten here is a field that
 * silently fails to copy, which is the failure mode this whole tool exists to avoid. `uploadMedia`
 * accepts `alt`/`caption`/`credit` directly, so only the remainder is applied here.
 *
 * `title` is set through this path rather than via `uploadMedia`'s `filename` because that derivation
 * strips a trailing extension — a title like `"Logo v1.2"` would arrive as `"Logo v1"`. `resolved.title`
 * is already the FINAL title (default-derived or override, resolved once by
 * {@link duplicateMediaAsset} before this runs), not recomputed here — recomputing it in two places
 * is exactly the kind of drift that let `filename`'s own former `"copy-of-…"` seed and this function's
 * default silently disagree with each other.
 *
 * @complexity O(1) — one repo read plus one write.
 */
async function applyCopiedMetadata(
  { routeDeps, created, source, resolved }: { routeDeps: MediaToolDeps; created: MediaRecord; source: MediaRecord; resolved: { title: string; slug?: string | undefined } },
  _optional: Record<string, never> = {}
): Promise<MediaRecord> {
  const { media } = await updateMediaMetadata({
    deps: { clock: routeDeps.clock, mediaRepo: routeDeps.mediaRepo },
    input: {
      workspaceId: routeDeps.workspaceId,
      id: created.id,
      title: resolved.title,
      ...(resolved.slug !== undefined ? { slug: resolved.slug } : {}),
      width: source.width,
      height: source.height,
      cssClass: source.cssClass,
      htmlAttributes: source.htmlAttributes,
    },
  });
  return media;
}

async function uploadDuplicateMedia({ routeDeps, source, bytes, contentType, input, caps }: {
  routeDeps: MediaToolDeps & MediaPublicUrlDeps; source: MediaRecord; bytes: Uint8Array; contentType: string; input: DuplicateMediaInput; caps: DuplicateCaps;
}): Promise<MediaRecord> {
  // Dedups by (workspaceId, sha256) inside the sha256 lock: the copy REFERENCES the source's bytes
  // rather than duplicating them, and a tombstoned blob is resurrected rather than left to be
  // collected out from under the new row. See this file's header.
  const { media: created } = await uploadMedia({
    deps: {
      clock: routeDeps.clock,
      idGen: routeDeps.idGen,
      mediaRepo: routeDeps.mediaRepo,
      blobRepo: routeDeps.assetBlobRepo,
      renditionRepo: routeDeps.assetRenditionRepo,
      blobStore: routeDeps.blobStore,
      blobFence: routeDeps.blobFence,
    },
    input: {
      workspaceId: routeDeps.workspaceId,
      bytes,
      // A slug-shaped SEED only — never the real title (applyCopiedMetadata sets that below) and
      // deliberately built from `source.slug`, not `title`: `source.slug` is guaranteed dot-free
      // (media slugs are lowercase letters/digits/dashes only), so appending to it can never trip
      // uploadMedia's own `deriveTitleFromFilename`, which strips anything that LOOKS like a
      // trailing file extension (`\.[^./\\]+$` — a bare period anywhere near the end, not just a
      // real `.ext`). The numbered `title` this function resolves CAN legitimately contain a period
      // (e.g. a source titled "Logo v1.2"), so it is never itself passed through here.
      filename: `${source.slug}-copy`,
      contentType,
      alt: source.alt,
      caption: source.caption,
      credit: source.credit,
      createdByPrincipal: input.principalId,
    },
  }, { maxUploadBytes: caps.maxUploadBytes ?? MAX_UPLOAD_BYTES, maxVideoUploadBytes: caps.maxVideoUploadBytes });

  return created;
}

/**
 * Duplicates one media asset — see this file's header for the bytes decision and what the operator
 * gets.
 *
 * Accepts a slug as well as an id, because `findMediaByIdOrSlug` is media's own established
 * identity model (`MediaRecord.slug`'s doc: an ADDITIONAL human-typeable key alongside `id`) and
 * refusing a slug here would make this tool the one place that ignores it.
 *
 * A TRASHED source is refused. `uploadMedia` always creates an `active` row, so copying a trashed
 * asset would produce a live entry for content the operator had already deleted — the same "a copy
 * is never more exposed than its source" rule that makes a duplicated published page default to
 * draft and a duplicated disabled form stay disabled.
 *
 * @param routeDeps - Media's own tool deps bag plus this host's optional content-type store.
 * @param deriveDuplicateName - The host's default-copy-title naming policy.
 * @param input - `content_duplicate`'s per-resource handler input.
 * @returns `{ media }` — the copy's own row.
 * @throws {ToolInputError} For an unsupported `status` override, a missing source, a trashed source,
 * or bytes that are no longer retrievable.
 * @throws {MediaConflictError | MediaValidationError} A taken or invalid `slug` override; the copy is
 * rolled back first.
 * @complexity O(1) repo/store calls plus one full read of the source's bytes.
 */
export async function duplicateMediaAsset(
  { routeDeps, deriveDuplicateName, maxUploadBytes, maxVideoUploadBytes, ...input }: { routeDeps: MediaToolDeps & MediaPublicUrlDeps; deriveDuplicateName: DeriveDuplicateName } & DuplicateCaps & DuplicateMediaInput,
  _optional: Record<string, never> = {},
): Promise<Record<string, unknown>> {
  // Rejected rather than ignored, mirroring the `"form"` resource: `content_duplicate`'s `status`
  // override is spelled in post/page's vocabulary (draft/published), which a media asset has no
  // equivalent of — its statuses are active/trashed, and a copy is never created trashed.
  if (input.overrides.status !== undefined) {
    throw new ToolInputError({ message: "content_duplicate: resource 'media' does not support the 'status' override — a media asset is " +
        "active/trashed, not draft/published, and a copy is always created active. Overrides honored " +
        "for 'media': title and slug. Use media_trash_asset afterwards to trash the copy." });
  }

  const source = await findMediaByIdOrSlug({
    deps: { mediaRepo: routeDeps.mediaRepo },
    input: { workspaceId: routeDeps.workspaceId, idOrSlug: input.id },
  });
  if (!source) throw new ToolInputError({ message: `content_duplicate: media asset '${input.id}' was not found` });
  if (source.kind === "document") throw new ToolInputError({ message: "Library document duplication is unavailable" });
  if (source.status === "trashed") {
    throw new ToolInputError({ message: `content_duplicate: media asset '${input.id}' is in the trash and was not copied — a copy would be ` +
        "a live entry for content you already deleted. Restore it first if you meant to copy it." });
  }

  // Resolved BEFORE anything is written: an asset whose bytes are genuinely gone must fail loudly
  // with nothing created, never leave a half-formed library entry behind (the same no-orphan-row
  // discipline `duplicatePostOrPage` applies to a bespoke-HTML page with no store wired).
  const blob = await routeDeps.assetBlobRepo.findByHash({ workspaceId: routeDeps.workspaceId, sha256: source.source.sha256 });
  if (!blob) {
    throw new ToolInputError({ message: `content_duplicate: media asset '${input.id}' has no stored blob for hash ${source.source.sha256} — ` +
        "nothing was copied. Its bytes are missing, so a copy would reference content that does not exist." });
  }
  const bytes = await routeDeps.blobStore.get({ storageKey: blob.storageKey });
  const contentType = await resolveCopyContentType({ routeDeps, sha256: source.source.sha256, bytes });

  // Resolved before uploadMedia so BOTH the interim filename seed below and applyCopiedMetadata's
  // real write use the SAME final title — see resolveDuplicateTitle's own doc for why recomputing it
  // twice is a drift risk this avoids.
  const title = await resolveDuplicateTitle({ routeDeps, deriveDuplicateName, source, overrideTitle: input.overrides.title });

  const created = await uploadDuplicateMedia({ routeDeps, source, bytes, contentType, input, caps: { maxUploadBytes, maxVideoUploadBytes } });

  // Keyed by sha256, not by asset id, so for a source whose type was already recorded this is a
  // no-op rewrite of the same value. It is called anyway, and deliberately: an asset predating the
  // content-type store has NO recorded type, and without this the copy would inherit that gap and
  // drop out of the admin's Images/Videos filter and the `/m/...` video URL branch. This is the
  // same store and method the HTTP upload route and `media_upload_asset` already write through.
  try {
    await routeDeps.mediaContentTypeStore?.set({ workspaceId: routeDeps.workspaceId, sha256: created.source.sha256, contentType });
    const media = await applyCopiedMetadata({ routeDeps, created, source, resolved: { title, slug: input.overrides.slug } });
    return { media };
  } catch (error) {
    // uploadMedia already committed the copy: a refused override (a taken or invalid slug) must not
    // leave a half-made `<slug>-copy` entry behind. The source still holds the bytes, so the
    // rollback's blob tombstone check leaves them alone.
    await rollbackUploadedMedia({ deps: { mediaRepo: routeDeps.mediaRepo, blobRepo: routeDeps.assetBlobRepo, renditionRepo: routeDeps.assetRenditionRepo, clock: routeDeps.clock },
      input: { workspaceId: routeDeps.workspaceId, media: created } });
    throw error;
  }
}

/**
 * `content_duplicate`'s resource contributor for `"media"`, resolving to `media.upload` — the SAME
 * permission `media_upload_asset` already declares in this domain's catalog. Creating a copy IS
 * creating a new library entry, so it is gated as an upload, not as a metadata update.
 *
 * Called from the host's composition root (its tool-catalog manifest), never
 * from within this domain: the host's dependency rules ban any non-type-only domain -> assistant-tool
 * registry import, so this function returns plain
 * data and imports only the registry's TYPE.
 */
export function contributeMediaDuplicateHandlers(
  { deriveDuplicateName, maxUploadBytes, maxVideoUploadBytes }: ContributeMediaDuplicateHandlersArgs,
  _optional: Record<string, never> = {},
): DuplicateResourceHandlerContributor<MediaToolDeps & MediaPublicUrlDeps>[] {
  return [
    {
      resource: "media",
      build: (routeDeps, _optional = {}) => ({
        permission: "media.upload",
        duplicate: (input, _optional = {}) => duplicateMediaAsset({ routeDeps: routeDeps as unknown as MediaToolDeps & MediaPublicUrlDeps, deriveDuplicateName, maxUploadBytes, maxVideoUploadBytes, ...input }),
      }),
    },
  ];
}
