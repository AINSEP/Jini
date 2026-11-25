import type { ISODateTime, UUID } from "../../primitives/index.js";

/**
 * @file Media repo, transform-parameter and image-codec port contracts. Types only.
 *
 * Additive copy of the declarations in `@jini-ai/cms/media` (`ports.ts`, `types.ts`,
 * `transform-types.ts`, `image-codec.ts`) and `@jini-ai/cms`'s `core/transform-format.ts`, with the
 * structural closure they need. The services, the in-memory repo, the MIME map and the codec
 * adapters stay in cms.
 */

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
}

export interface MediaRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<MediaRecord | null>;
  /** Second lookup key (2026-09-07) — `MediaRecord.slug`'s own doc has the full identity-model
   *  rationale. Mirrors `AssetBlobRepoPort.findByHash`'s shape: one indexed field, one row or `null`. */
  findBySlug(required: { workspaceId: UUID; slug: string }): Promise<MediaRecord | null>;
  list(required: { workspaceId: UUID }): Promise<MediaRecord[]>;
  save(record: MediaRecord): Promise<void>;
  /** Hard delete — called by `purgeMedia` after the trash guard passes, and by
   *  `rollbackUploadedMedia` as an unconditional compensating rollback for a failed upload. */
  remove(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

/**
 * Output re-encode format. Matches `media-service.ts`'s
 * `DEFAULT_ALLOWED_MIME_TYPES` image set minus SVG (never a transform output —
 * SVG has no raster pixels to resize).
 */
export type TransformFormat = "jpeg" | "png" | "webp" | "gif";

/** Resize behavior, mirrors `sharp`'s `fit` vocabulary (a deliberately small subset). */
export type TransformFit = "cover" | "contain" | "fill" | "inside" | "outside";

/**
 * Declarative transform parameters (named definitions only, never
 * caller-supplied dimensions). `width`/`height` are optional so a
 * format-only re-encode (no resize) is a valid definition; `fit` only
 * matters when both `width` and `height` are given.
 */
export interface TransformParams {
  width?: number | undefined;
  height?: number | undefined;
  fit?: TransformFit | undefined;
  format: TransformFormat;
  /** Encoder quality, 1–100; omitted preserves the codec default. */
  quality?: number | undefined;
}

/** Vendor-neutral pixel operations. Hosts inject the codec; importing this port loads no native binary. */
export interface ImageCodecLimits { maxInputPixels?: number; timeoutSeconds?: number }
export interface ImageMetadata {
  format?: string; width: number; height: number; hasAlpha: boolean; orientation?: number;
  autoOrient: { width: number; height: number };
}
export interface EncodedImage { bytes: Uint8Array; width: number; height: number }
export interface ImageGeometry {
  autoOrient?: boolean;
  extract?: { left: number; top: number; width: number; height: number };
  rotate?: number; flip?: boolean; flop?: boolean; background?: string;
  resize?: { width?: number; height?: number; fit?: "cover" | "contain" | "inside" | "outside" | "fill"; position?: string; withoutEnlargement?: boolean };
}
export interface ImageEncodeInput extends ImageGeometry {
  source: Uint8Array; format: "png" | "jpeg" | "webp" | "avif";
  quality?: number; stripMetadata?: boolean; flatten?: { background: string };
}
export interface ImageTileInput { source: Uint8Array; maxWidth: number; tileHeight: number }
export interface ImageCodecPort {
  inspect(input: { source: Uint8Array }, options?: ImageCodecLimits): Promise<ImageMetadata>;
  encode(input: ImageEncodeInput, options?: ImageCodecLimits): Promise<EncodedImage>;
  encodeTiles(input: ImageTileInput, options?: { quality?: number }): Promise<(EncodedImage & { top: number })[]>;
}

/**
 * The admin `media` wire DTOs (second section of this module) (ADR-029): the JSON bodies the media admin routes answer with and
 * an admin client reads. Declared here, once, so the server serializer
 * (`@jini-ai/cms/admin-http/http/media`) and any client mirror read the same shapes without the client
 * depending on CMS. Serialization rules (document display names, sniffed content types, public URLs)
 * stay in CMS; only the declarations sit in Core.
 *
 * Core cannot import CMS, so the media record's `status` and `kind` unions are restated structurally
 * here. CMS's `admin-http/http/__tests__/media.test.ts` pins them against `MediaStatus` and
 * `MediaKind` in both directions; keep the two sides identical.
 */

/** Deletion-ladder status of an asset (CMS `MediaStatus`). */
export type AdminMediaStatus = 'active' | 'trashed';

/** `"document"` for a private Library document, `"media"` for ordinary media (CMS `MediaKind`). */
export type AdminMediaKind = 'media' | 'document';

/** Compatibility hint for a stored video, read from its decoded stream metadata. `other` is a
 *  confirmed codec outside the named ones; an unknown codec is an absent hint, never a guess. */
export type VideoCodec = 'hevc' | 'h264' | 'other';

/** Host-bound codec probe over admitted, byte-sniffed video bytes. Resolves `undefined` when the
 *  codec cannot be confirmed (missing tool, unsupported metadata, timeout, abort); callers treat a
 *  rejection the same way, so probing never changes whether bytes are accepted. */
export interface VideoCodecProbePort {
  probe(required: { bytes: Uint8Array; contentType: string }, optional?: { signal?: AbortSignal }): Promise<VideoCodec | undefined>;
}

/** Static wire code for a single file over its upload byte limit. */
export const MEDIA_UPLOAD_TOO_LARGE = 'MEDIA_UPLOAD_TOO_LARGE';

/** The admin upload/replace refusal body for one file over its byte limit (status 400): the plain
 *  sentence plus the measured size and the limit that applied, so a client need not parse words. */
export interface AdminMediaUploadTooLargeRefusal {
  error: string;
  code: typeof MEDIA_UPLOAD_TOO_LARGE;
  fileBytes: number;
  limitBytes: number;
}

/** One asset as the admin API answers it. */
export interface AdminMediaDto {
  id: string;
  kind: AdminMediaKind;
  originalFilename: string | null;
  displayFilename: string;
  /** Stable creation principal ID; NULL means unknown legacy/pre-migration attribution. */
  createdBy: string | null;
  workspaceId: string;
  title: string;
  /** Human-memorable, unique-per-workspace lookup key (2026-09-07) — see `MediaRecord.slug`'s own
   *  doc (`@jini-ai/cms/media`) for the full identity model. */
  slug: string;
  alt: string;
  caption: string;
  credit: string;
  description?: string;
  sha256: string;
  /** Original blob bytes; null when storage is missing or cannot report a size. */
  byteSize: number | null;
  status: AdminMediaStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
  width: number | null;
  height: number | null;
  cssClass: string | null;
  /** Free-text HTML attributes threaded onto this asset's public tag (2026-09-07) — see
   *  `MediaRecord.htmlAttributes`'s own doc (`@jini-ai/cms/media`) for the full identity/security
   *  model. Already validated by the time it reaches here; this DTO does not re-validate. */
  htmlAttributes: string | null;
  /**
   * The asset's real media type — always `sniffContentType(bytes)` from the stored bytes, never
   * the client's declared upload string (see `media/content-type-store.ts` for why). Drives the
   * admin Media screen's "Images"/"Videos" tabs.
   *
   * `null` means "not sniffed yet", NOT "unknown format" — an unrecognized blob reports the real
   * answer `"application/octet-stream"`. A `null` is only ever seen for a blob whose bytes could
   * not be read at list time; the list route backfills every other pre-existing row on read. The
   * admin UI must keep `null` rows visible somewhere rather than filtering them into oblivion.
   */
  contentType: string | null;
  /**
   * The asset's real, public, readable `/m/...` URL (readable-slugs S5a, 2026-09-23) — the same
   * `mediaUrlKey`/`mediaPublicPath` contract `seo/media.ts` and the
   * host's own public-URL resolver (`resolveMediaPublicUrls`) already use, keyed by the
   * asset's current slug when it has a valid one, otherwise its id. `null` for every case
   * `resolveMediaPublicUrls` itself returns `null` for — a trashed asset (never a link a visitor
   * would 404 on), or no "public" core transform registered yet — never a partially-built or
   * fabricated guess.
   */
  publicUrl: string | null;
  /** Confirmed video codec of the current source bytes; omitted when unknown or not a video. */
  videoCodec?: VideoCodec;
}

export type MediaConversionNotice = "web-copy-unavailable";
export type MediaUploadResult<Media> = { media: Media; conversionNotice?: MediaConversionNotice };

/** The single-asset body (update, trash). */
export interface AdminMediaEnvelope { media: AdminMediaDto }

/** The list body. */
export interface AdminMediaListEnvelope { media: AdminMediaDto[] }

/** The hard-purge body: `purged` is always `true` (a refused purge answers a 4xx instead). */
export interface AdminMediaPurgeEnvelope { purged: true }

/**
 * The media-generation vendor credentials, keyed by provider id, as markers only (that a key exists,
 * its last characters) — never key material. A bare map, not a `{ data }` envelope: `{}` means
 * "reached, manages nothing".
 */
export type AdminMediaProviderMarkers = Record<string, unknown>;

/** `GET …/media/:mediaId/where-used`: the stored asset id and the host's usage report for it. */
export interface AdminMediaWhereUsedEnvelope {
  readonly mediaId: string;
  readonly whereUsed: unknown;
}

/** One resolved asset's public-render sizing override — see `SiteRenderContext.mediaAssetMetadata`'s
 * own doc. `null` on any field means "not set", not "zero"/"empty string". */
export interface MediaAssetRenderMeta {
  sha256?: string;
  width: number | null;
  height: number | null;
  cssClass: string | null;
  /** Same "not set, not empty" contract as `cssClass` — see `MediaRecord.htmlAttributes`'s own doc
   *  (`@jini-ai/cms/media`) for the full identity/security model. */
  htmlAttributes: string | null;
  /**
   * The asset's sniffed content type (`image/png`, `video/mp4`, …), or `null` when not (yet) known
   * — added 2026-09-11 for the generic `media` doc node's dispatch ({@link renderDocMedia}'s own
   * doc). `MediaRecord` (`@jini-ai/cms/media`) has no such field of its own; this is populated from
   * the host-supplied `MediaContentTypeStorePort` side channel (`@jini-ai/cms/media/site/content-type-store`
   * — see that port's own file header for why), keyed by the asset's blob sha256, the SAME source
   * `resolver-service.ts`'s `resolveOneMediaEmbed` already reads for the sibling widget-embed media
   * path. Populated by `resolveMediaAssetMetadataForRender` (`routes/site/pages.ts`) for the direct
   * render path this file's own `renderDocNode`/`renderSite` reach, AND (also 2026-09-11, closing
   * what was briefly a disclosed gap) by `resolver-service.ts`'s `resolvePostContentMediaContext` —
   * shared by both `"post-content"` IR builders, `resolvePostTypeEmbeds` and
   * `resolveContentTypeEmbeds` — reconstructed on this side by {@link parseMediaAssetMeta}. That
   * shared path is NOT limited to "a post rendered because a PAGE embeds it": `routes/site/pages.ts`'s
   * `renderViaTemplate` reaches it via `resolveContentTypeEmbeds`'s DB branch for a post rendered at
   * its OWN public URL through a static-tier theme template too (see
   * `resolve-html-page-embeds.integration.test.ts`'s own doc on this — "the exact path both the
   * admin template-preview route AND any live post rendered through a static-tier theme's own
   * template go through"). A missing entry (mediaContentTypeStore not supplied, or a sha256 never
   * sniffed) degrades to `null` here, read as "not video" the same way every other unresolved ref on
   * this render path degrades, never a crash or a wrong guess at the asset's kind. Every
   * PRE-EXISTING reader of `MediaAssetRenderMeta` ({@link tryRenderRefImage}/
   * {@link resolveMediaAssetOverrides}, the `image` node's own path) never reads this field, so
   * adding it changes nothing about how `image` nodes render.
   */
  contentType: string | null;
  /**
   * The asset's CURRENT slug, or `null` when it has none (never uploaded through a path that
   * derives one, or a genuinely legacy row) — readable-slugs plan S3 (2026-09-23). This is the one
   * field {@link renderImageTag}/{@link renderVideoTag} read to decide the `/m/...` URL's key
   * (`mediaUrlKey`, `@jini-ai/cms/media/site/public-path`): a present, valid slug wins, otherwise the
   * asset's `id` is used, same fallback `mediaUrlKey` itself implements. Rename safety
   * (`media_slug_history`, S2a/S2b) is what makes emitting a slug here safe — a slug this render
   * captures can be renamed later without breaking the URL already baked into this HTML.
   */
  slug: string | null;
  /**
   * G7-9: the asset's resolved WebVTT captions track (`src` is the sibling `.vtt` asset's public
   * `/m/.../original.vtt` path), or `null`/absent for none. The renderer never trusts it: a non-`.vtt`
   * or off-origin `src` renders the uncaptioned player (`@jini-ai/cms` `caption-track.ts`).
   */
  captionsTrack?: { readonly src: string; readonly srclang: string; readonly label?: string | null } | null;
}

/** The only encoding a host converter is asked for: a web-safe MP4 that streams before it finishes loading. */
export type VideoTranscodeTarget = "mp4-h264-aac-faststart";
export type VideoTranscodeFailureReason = "unavailable" | "busy" | "too-large" | "timeout" | "canceled" | "invalid";
export type VideoTranscodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: VideoTranscodeFailureReason; readonly message: string };

/** Turns authorized video bytes into the requested web-safe encoding. Inputs are bytes, never
 * caller paths. Implementations report expected failures as results and keep the original intact. */
export interface MediaTranscoderPort {
  transcode(
    required: { input: Uint8Array; target: VideoTranscodeTarget },
    optional?: { signal?: AbortSignal | undefined; maxOutputBytes?: number | undefined },
  ): Promise<VideoTranscodeResult>;
}
