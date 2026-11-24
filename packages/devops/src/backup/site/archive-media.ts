import { createHash } from "node:crypto";
import path from "node:path";
import { SiteShareRefusal } from "./share-refusal.js";

/** The slice of a transform definition this module reads: the output format. */
export interface ArchiveMediaTransformParams { readonly format: string }

/** Snapshot-owned metadata, never a read from mutable live media repositories. */
export interface ArchiveMediaSource<TParams extends ArchiveMediaTransformParams = ArchiveMediaTransformParams> {
  readonly id: string; readonly workspaceId: string; readonly slug: string;
  readonly originalFilename: string | null; readonly kind: string;
  readonly storageKey: string; readonly sha256: string;
  readonly documentOwned?: boolean;
  readonly public?: { readonly storageKey?: string; readonly sha256?: string; readonly version: number; readonly params: TParams };
}

/** One archived media file as the manifest lists it. */
export interface ArchiveMediaEntry { readonly id: string; readonly slug: string; readonly path: string; readonly sha256: string }

export interface ArchiveMediaCopy extends ArchiveMediaEntry {
  readonly workspaceId: string; readonly storageKey: string; readonly contentType: string;
  readonly publicVersion?: number;
  readonly documentOwned?: boolean | undefined;
}
export type ArchiveMediaRewriter = (required: { bytes: Buffer; copies: readonly ArchiveMediaCopy[] }, optional?: { signal?: AbortSignal }) => Promise<Buffer>;

/** The raster re-encoder: same bytes and params give the same output. */
export interface ArchiveMediaImageTransformer<TParams extends ArchiveMediaTransformParams = ArchiveMediaTransformParams> {
  transform(input: { bytes: Uint8Array; params: TParams }): Promise<{ bytes: Uint8Array }>;
}

/** Media content operations the host owns (sniffing, SVG sanitizing, content-addressed keys). */
export interface ArchiveMediaOperations {
  sniffContentType(required: { bytes: Uint8Array }): string;
  sanitizeSvg(required: { bytes: Uint8Array }): Promise<Uint8Array>;
  computeBlobStorageKey(required: { workspaceId: string; sha256: string }): string;
  mimeForTransformFormat(required: { format: string }): string;
}

/** Portable-path policy the host owns: refuses a path (throws) or folds it to its collision alias. */
export interface ArchiveMediaPathPolicy {
  validateSharePath(required: { path: string }): void;
  sharePathAlias(required: { path: string }): string;
}

/**
 * Size-capped ledger and blob reads the host owns, so the share limits and their wording stay with
 * the host. Each refuses (throws {@link SiteShareRefusal}) instead of returning a partial result.
 */
export interface ArchiveMediaSharePolicy<TLedger, TBlobStore> {
  addBuffered(required: { ledger: TLedger; file: { path: string; content: Buffer } }): void;
  reportedBlobSize(required: { blobStore: TBlobStore; storageKey: string; document: boolean }): Promise<number>;
  fetchVerifiedBlob(required: { blobStore: TBlobStore; media: { storageKey: string; sha256?: string }; size: number }): Promise<Buffer>;
}

/** Everything the host injects. */
export interface ArchiveMediaHost<TLedger, TBlobStore> {
  readonly operations: ArchiveMediaOperations;
  readonly paths: ArchiveMediaPathPolicy;
  readonly sharePolicy: ArchiveMediaSharePolicy<TLedger, TBlobStore>;
}

interface PublicCopy { bytes: Buffer; contentType: string; extension: string; publicVersion?: number }
interface CopyContext<TLedger, TBlobStore, TParams extends ArchiveMediaTransformParams> {
  host: ArchiveMediaHost<TLedger, TBlobStore>; blobStore: TBlobStore;
  imageTransformer: ArchiveMediaImageTransformer<TParams>;
}

const EXTENSIONS: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "audio/wav": "wav", "audio/mpeg": "mp3", "audio/flac": "flac", "audio/mp4": "m4a" };

/** Picks exactly one public copy per item, in id order, without writing to the source site.
 * @throws SiteShareRefusal naming missing, corrupt or unbounded media; raster failures never fall back to raw bytes.
 * @complexity O(items log items + media bytes); shared caps bound retained output and each input read.
 */
export async function bufferArchiveMedia<TLedger, TBlobStore, TParams extends ArchiveMediaTransformParams>(required: { sources: readonly ArchiveMediaSource<TParams>[]; blobStore: TBlobStore; imageTransformer: ArchiveMediaImageTransformer<TParams>; ledger: TLedger; host: ArchiveMediaHost<TLedger, TBlobStore> }, optional: { signal?: AbortSignal } = {}): Promise<ArchiveMediaCopy[]> {
  const { host } = required;
  const context: CopyContext<TLedger, TBlobStore, TParams> = { host, blobStore: required.blobStore, imageTransformer: required.imageTransformer };
  const aliases = new Set<string>();
  const copies: ArchiveMediaCopy[] = [];
  for (const source of [...required.sources].sort((a, b) => a.id < b.id ? -1 : Number(a.id > b.id))) {
    optional.signal?.throwIfAborted();
    const original = await readCopy({ context, source });
    const selected = await publicCopy({ context, source, original });
    const file = mediaPath({ host, source, extension: selected.extension, aliases });
    const sha256 = createHash("sha256").update(selected.bytes).digest("hex");
    const storageKey = host.operations.computeBlobStorageKey({ workspaceId: source.workspaceId, sha256 });
    host.paths.validateSharePath({ path: "uploads/" + storageKey });
    host.sharePolicy.addBuffered({ ledger: required.ledger, file: { path: file, content: selected.bytes } });
    copies.push({ id: source.id, slug: source.slug, path: file, sha256, workspaceId: source.workspaceId, storageKey, contentType: selected.contentType, documentOwned: source.documentOwned, ...(selected.publicVersion === undefined ? {} : { publicVersion: selected.publicVersion }) });
  }
  return copies;
}

/** Size and checksum must come from the snapshot/store contract before bytes can be archived. */
async function readCopy<TLedger, TBlobStore, TParams extends ArchiveMediaTransformParams>(required: { context: CopyContext<TLedger, TBlobStore, TParams>; source: { storageKey: string; sha256?: string; kind?: string } }): Promise<Buffer> {
  const { host, blobStore } = required.context;
  host.paths.validateSharePath({ path: "uploads/" + required.source.storageKey });
  const size = await host.sharePolicy.reportedBlobSize({ blobStore, storageKey: required.source.storageKey, document: required.source.kind === "document" });
  return host.sharePolicy.fetchVerifiedBlob({ blobStore, media: required.source, size });
}

async function publicCopy<TLedger, TBlobStore, TParams extends ArchiveMediaTransformParams>(required: { context: CopyContext<TLedger, TBlobStore, TParams>; source: ArchiveMediaSource<TParams>; original: Buffer }): Promise<PublicCopy> {
  const { operations } = required.context.host;
  const contentType = operations.sniffContentType({ bytes: required.original });
  if (required.source.kind === "document") return { bytes: required.original, contentType, extension: originalExtension(required.source) };
  if (contentType === "image/svg+xml") return { bytes: Buffer.from(await operations.sanitizeSvg({ bytes: required.original })), contentType, extension: "svg" };
  if (!contentType.startsWith("image/")) return { bytes: required.original, contentType, extension: EXTENSIONS[contentType] ?? originalExtension(required.source) };
  return rasterCopy(required);
}

async function rasterCopy<TLedger, TBlobStore, TParams extends ArchiveMediaTransformParams>(required: { context: CopyContext<TLedger, TBlobStore, TParams>; source: ArchiveMediaSource<TParams>; original: Buffer }): Promise<PublicCopy & { publicVersion: number }> {
  const { context } = required;
  const { operations } = context.host;
  const definition = required.source.public;
  if (!definition || definition.params.format !== "webp") throw new SiteShareRefusal({ code: "INVALID_MEDIA", message: `Media '${required.source.id}' has no public webp transform.` });
  try {
    const bytes = definition.storageKey
      ? await readCopy({ context, source: { storageKey: definition.storageKey, ...(definition.sha256 ? { sha256: definition.sha256 } : {}) } })
      : Buffer.from((await context.imageTransformer.transform({ bytes: required.original, params: definition.params })).bytes);
    if (operations.sniffContentType({ bytes }) !== "image/webp") throw new Error("public rendition is not webp");
    return { bytes, contentType: operations.mimeForTransformFormat({ format: definition.params.format }), extension: "webp", publicVersion: definition.version };
  } catch (error) {
    throw new SiteShareRefusal({ code: "INVALID_MEDIA", message: `Cannot export media '${required.source.id}' (${required.source.slug}): ${error instanceof Error ? error.message : "image decode failed"}` });
  }
}

function originalExtension(source: { originalFilename: string | null }): string {
  const extension = path.extname(source.originalFilename ?? "").slice(1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(extension) ? extension : "bin";
}
function mediaPath(required: { host: ArchiveMediaHost<never, never>; source: { slug: string; id: string }; extension: string; aliases: Set<string> }): string {
  const { paths } = required.host;
  const slug = required.source.slug || required.source.id;
  const extension = portableExtension({ paths, slug, extension: required.extension });
  let candidate = `media/${slug}.${extension}`, suffix = 2;
  while (required.aliases.has(paths.sharePathAlias({ path: candidate }))) {
    candidate = `media/${slug}-${suffix}.${extension}`;
    suffix++;
  }
  paths.validateSharePath({ path: candidate });
  required.aliases.add(paths.sharePathAlias({ path: candidate }));
  return candidate;
}

/** A document keeps its own extension, which the share path policy may never publish (Keynote's
 * `.key`). The archive name is cosmetic: the media row keeps the original filename, so `.bin` names it. */
function portableExtension(required: { paths: ArchiveMediaPathPolicy; slug: string; extension: string }): string {
  try { required.paths.validateSharePath({ path: `media/${required.slug}.${required.extension}` }); return required.extension; } catch (error) {
    if (error instanceof SiteShareRefusal) return "bin";
    throw error;
  }
}
