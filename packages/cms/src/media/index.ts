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
  updateMediaMetadata,
  trashMedia,
  purgeMedia,
  type UploadMediaInput,
  type UploadMediaDeps,
  type UpdateMediaMetadataInput,
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

export { SharpImageTransformer, ImageTransformUnavailableError } from "./image-transformer.sharp.js";

// -----------------------------------------------------------------------------
// Original-bytes admin preview route support. See `content-type-sniffer.ts`'s
// file header for the disclosed scope: an allowlist magic-byte sniffer, not a
// general-purpose one.
// -----------------------------------------------------------------------------
export { sniffContentType, type SniffedContentType } from "./content-type-sniffer.js";

/** The agent-tool catalog for this domain (see `agent-tools.ts` for what is deliberately omitted). */
export {
  mediaAgentToolCatalog,
  type AgentToolDefinition as MediaAgentToolDefinition,
  type AgentToolSideEffect as MediaAgentToolSideEffect,
  type AgentToolActorClassRule as MediaAgentToolActorClassRule,
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
