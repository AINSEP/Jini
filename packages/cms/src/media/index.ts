/**
 * @file Public surface (barrel) for the `media` library.
 *
 * A module's public contract is its `index.ts` — deep imports from outside
 * this directory should go through here.
 *
 * See `types.ts` and `media-service.ts` file headers for the disclosed scope
 * adjustments this walking-skeleton build makes relative to the full
 * design (bespoke table instead of generic entries; no origin isolation or
 * ingress policy). Blob GC (`blob-gc.ts`) IS built for real within its own
 * disclosed scope — see that file's header for what's still stubbed
 * (`entry_refs`, retained snapshots, the monthly orphan sweep).
 */
export type {
  MediaStatus,
  MediaSource,
  MediaRecord,
  AssetBlobStatus,
  AssetBlobRecord,
  AssetRenditionRecord,
  BlobGcJournalEntry,
} from "./types.js";

export {
  MediaNotFoundError,
  MediaValidationError,
  MediaConflictError,
  MediaSourceImmutableError,
  MediaStillReferencedError,
} from "./types.js";

export type {
  MediaRepoPort,
  AssetBlobRepoPort,
  AssetRenditionRepoPort,
  BlobStorePort,
  BlobGcJournalRepoPort,
  PutBlobInput,
  TransformDefinitionRepoPort,
} from "./ports.js";

export { computeBlobStorageKey } from "./blob-key.js";
export { preserveMediaCreator, mediaRepoWithCreator } from "./created-by.js";

export {
  MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES,
  isAllowedMediaHtmlAttributeName,
  parseMediaHtmlAttributes,
  describeMediaHtmlAttributeError,
  type MediaHtmlAttributeRejectionReason,
  type MediaHtmlAttributeError,
  type ParsedMediaHtmlAttributes,
} from "./html-attributes.js";

export {
  InMemoryMediaRepo,
  InMemoryAssetBlobRepo,
  InMemoryAssetRenditionRepo,
  InMemoryBlobGcJournalRepo,
  InMemoryTransformDefinitionRepo,
} from "./repo.memory.js";

export { withSha256Lock } from "./blob-gc-lock.js";

export {
  DEFAULT_GC_GRACE_MS,
  resolveGcGraceMs,
  isBlobUnreferenced,
  tombstoneBlobIfUnreferenced,
  runBlobGcDeletePass,
  runBlobGcUnlinkPass,
  runBlobGcCycle,
  runMonthlyOrphanSweepStub,
} from "./blob-gc.js";

export { InMemoryBlobStore } from "./blob-store.memory.js";
export { LocalFsBlobStore, type LocalFsBlobStoreDeps } from "./blob-store.fs.js";

export {
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_ALLOWED_MIME_TYPES,
  resolveWriteOnceSource,
  uploadMedia,
  listMedia,
  getMediaById,
  findMediaByIdOrSlug,
  updateMediaMetadata,
  trashMedia,
  purgeMedia,
  isValidMediaSlugFormat,
  type UploadMediaInput,
  type UploadMediaDeps,
  type UpdateMediaMetadataInput,
  type FindMediaByIdOrSlugRequired,
} from "./media-service.js";

// -----------------------------------------------------------------------------
// Named transform registry + rendition generation — core-declared
// transforms only, in-process lazy single-flight generation only (no eager
// hot-set worker, no out-of-process generation, no theme/plugin declaration
// API). See `transform-types.ts`, `transform-registry.ts`,
// `rendition-service.ts`, `image-transformer*.ts` file headers.
// -----------------------------------------------------------------------------
export type {
  TransformFit,
  TransformFormat,
  TransformParams,
  TransformDefinitionRecord,
} from "./transform-types.js";
export { TransformValidationError, mimeForTransformFormat, MAX_TRANSFORM_DIMENSION_PX } from "./transform-types.js";

export { withRenditionLock, withTransformRegistryLock } from "./transform-lock.js";

export {
  registerTransform,
  getLatestTransformDefinition,
  isLatestTransformVersion,
  isReferencedByPublishedContent,
  type RegisterTransformInput,
  type RegisterTransformDeps,
} from "./transform-registry.js";

export {
  resolveMediaRendition,
  type ResolveMediaRenditionDeps,
  type ResolveMediaRenditionInput,
  type ResolveMediaRenditionResult,
} from "./rendition-service.js";

export type { ImageTransformerPort, TransformImageInput, TransformImageOutput } from "./image-transformer.js";
export { InMemoryImageTransformer } from "./image-transformer.js";

export { SharpImageTransformer, ImageTransformUnavailableError, ImageSourceCorruptError } from "./image-transformer.sharp.js";

// -----------------------------------------------------------------------------
// Original-bytes admin preview route support. See `content-type-sniffer.ts`'s
// file header for the disclosed scope: an allowlist magic-byte sniffer, not a
// general-purpose one.
// -----------------------------------------------------------------------------
export { sniffContentType, type SniffedContentType } from "./content-type-sniffer.js";

/** The agent-tool catalog for this domain (see `agent-tools.ts` for what is deliberately omitted). */
export {
  mediaAgentToolCatalog,
} from "./agent-tools.js";

/**
 * The agent-tool wiring for this domain.
 *
 * `MediaToolDeps` is declared structurally rather than derived from any host's request-scoped
 * dependency bag, which is what lets a host satisfy it by passing whatever object it already has —
 * the shape is the contract, so no host type needs to be named here.
 */
export {
  buildMediaRegistrations,
  mediaDerivedRisk,
  type MediaToolDeps,
} from "./tool-registrations.js";

// Named argument contracts for consumer adapters.
export type { UploadMediaRequired, UploadMediaOptional, ListMediaRequired, GetMediaByIdRequired, UpdateMediaMetadataRequired, TrashMediaRequired, PurgeMediaRequired, RollbackUploadedMediaRequired } from "./media-service.js";
export type { ResolveMediaRenditionRequired } from "./rendition-service.js";
export type { RegisterTransformRequired, GetLatestTransformDefinitionRequired, IsLatestTransformVersionRequired } from "./transform-registry.js";
export type { IsBlobUnreferencedRequired, TombstoneBlobRequired, RunBlobGcDeletePassRequired, RunBlobGcUnlinkPassRequired, RunBlobGcCycleRequired } from "./blob-gc.js";

export { rollbackUploadedMedia } from "./media-service.js";
export type { MediaRowCleanupDeps } from "./media-service.js";

// Video previews: policy/port plus a bounded optional-host codec adapter.
export {
  VIDEO_DEFAULT_FRAMES, VIDEO_MAX_FRAMES, VIDEO_MAX_EDGE_PX, VIDEO_MAX_INPUT_BYTES,
  VIDEO_MAX_FRAME_BYTES, VIDEO_MAX_OUTPUT_BYTES, VIDEO_MAX_SHEET_BYTES, VIDEO_MAX_SHEETS, VIDEO_EXTRACTION_TIMEOUT_MS, planVideoFrames, parseVideoProbe, getVideoFrameEdge, planVideoContactSheets,
  type VideoMetadata, type VideoFrame, type VideoFrameOptions, type VideoFrameResult, type VideoFrameExtractor,
  type VideoSheetTile, type VideoSheetLayout, type VideoContactSheet,
} from './video-frames.js';
export {
  createFfmpegVideoFrameExtractor, findVideoBinaries, runLowPriorityVideoProcess,
  type VideoBinaries, type VideoBinaryFinder, type VideoProcessRunner,
} from './video-frames.ffmpeg.js';
