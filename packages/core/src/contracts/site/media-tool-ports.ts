import type { MediaRecord, MediaProvenance } from "./cms-media.js";

export interface MediaToolUploadInput {
  workspaceId: string;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  createdByPrincipal: string;
  alt?: string;
  caption?: string;
  credit?: string;
  description?: string;
  provenance?: MediaProvenance;
}

/** What `media_import_from_url` returns — the SAME shape `media_upload_asset`/`media_generate_asset`/
 *  `media_list_assets` return, so the model can chain straight into `media_update_metadata`/
 *  `media_trash_asset` off the returned `id` with no separate lookup, and use `publicUrl` to embed the
 *  image immediately. Declared locally for the same reason `media-generation`'s `GeneratedMediaView`
 *  is: `@jini-ai/cms/media`'s equivalent view type is an internal projection, not public surface. */
export interface ImportedMediaView {
  id: string;
  createdBy: string | null;
  /** The asset's short lookup name (2026-09-16) — a page marker can reference this instead of the
   *  long `id`; mirrors `@jini-ai/cms/media`'s own `MediaToolView.slug` addition. */
  slug: string;
  title: string;
  alt: string;
  caption: string;
  credit: string;
  sha256: string;
  status: string;
  version: number;
  publicUrl: string | null;
  /** The URL the bytes actually came from, after redirect resolution and normalization — so a
   *  transcript records what was imported, not merely what was asked for. Empty for local files. */
  sourceUrl: string;
}

export interface MediaToolStoragePorts {
  upload(required: { input: MediaToolUploadInput }, optional?: Record<string, never>): Promise<{ media: MediaRecord }>;
  recordContentType(required: { workspaceId: string; sha256: string; contentType: string }, optional?: Record<string, never>): Promise<void>;
  resolvePublicUrls(required: { assets: readonly MediaRecord[] }, optional?: Record<string, never>): Promise<Map<string, string | null>>;
}

export interface MediaImportSourcePorts {
  fetchRemote(required: { url: string }, optional?: Record<string, never>): Promise<{ bytes: Uint8Array; contentType: string; url: URL }>;
  resolveLocal(required: { root: string; relativePath: string }, optional?: Record<string, never>): { rootPath: string; relativePath: string };
  readLocal(required: { rootPath: string; relativePath: string; maxBytes: number }, optional?: Record<string, never>): Promise<Uint8Array>;
  localReadLimit(required: { relativePath: string }, optional?: Record<string, never>): number;
  validateBytes(required: { source: URL | string; bytes: Uint8Array; bytesTruncated: boolean }, optional?: Record<string, never>): string;
}

export interface MediaImportRefusalPorts {
  isEgressRefusal(required: { error: unknown }, optional?: Record<string, never>): boolean;
  describeEgressRefusal(required: { error: unknown }, optional?: Record<string, never>): { logMessage: string; callerSafeError: Error } | undefined;
  logEgressRefusal(required: { line: string }, optional?: Record<string, never>): void;
  isPathRefusal(required: { error: unknown }, optional?: Record<string, never>): boolean;
}

export interface ImageGenerationCredential {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

export interface GeneratedImageBytes {
  readonly bytes: Uint8Array;
  readonly providerId: string;
  readonly usedStubFallback: boolean;
}

export interface ImageGenerationPorts {
  readSavedSelections(
    required: { workspaceId: string }, optional?: Record<string, never>,
  ): Promise<Readonly<Record<string, { apiKeyConfigured?: boolean; model?: string }>>>;
  readSavedCredential(
    required: { workspaceId: string; providerId: string }, optional?: Record<string, never>,
  ): Promise<ImageGenerationCredential | null>;
  readEnvCredential(
    required: { providerId: string }, optional?: Record<string, never>,
  ): ImageGenerationCredential | null;
  generateImage(
    required: { model: string; prompt: string; providerId: string; credentials: ImageGenerationCredential; allowStubFallback: boolean },
    optional: { signal: AbortSignal },
  ): Promise<GeneratedImageBytes>;
}
