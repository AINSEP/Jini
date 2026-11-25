import path from "node:path";
import type { DbOpsPort } from "@jini-ai/core/contracts/site/gated-mutations-ports";
import type { SealedSecret } from "@jini-ai/core/contracts/vault";
import type { ArchiveMediaCopy, ArchiveMediaEntry, ArchiveMediaRewriter } from "./archive-media.js";
import type { CredentialWarning } from "./credential-warnings.js";
import { SAVED_KEYS_PATH, ENCRYPTED_KEYS_DESCRIPTOR, type SiteSavedKeysPort } from "./saved-keys-port.js";
import { SiteShareRefusal } from "./share-refusal.js";
import type { ShareCollectedFiles, ShareDatabaseProjection, ShareDatabaseSanitizer, ShareLedger, SharePlannedFile, ShareSteps } from "./share-preparation-steps.js";

/** What the host supplies beyond the call's ports: the share profile's scopes, its steps and its file/extension/schema readers. */
export interface SharePreparationDeps<TSources extends { siteDir: string }, TInclude extends object, TFile extends SharePlannedFile & { scope: string }, TCollected extends ShareCollectedFiles<TFile> & { notices?: readonly string[]; scopeNotes: unknown }, TMedia, TBlobStore, TTransformer, TPlugin, TSchema> {
  /** The scopes a share carries (all on): the host's own scope names. */
  readonly include: TInclude;
  readonly steps: ShareSteps<TSources, TInclude, TFile, TCollected>;
  /** Throws a {@link SiteShareRefusal} when the listed files break the archive caps. */
  readonly checkShareLimits: (required: { files: readonly { path: string; bytes: number }[] }) => void;
  /** Reads the non-settings files' installed extensions (themes, plugins) and returns the files to ship. */
  readonly prepareExtensions: (required: { sources: TSources; files: readonly TFile[] }, optional: { signal?: AbortSignal; packageThemesRoot?: string }) => Promise<{ files: TFile[]; plugins: TPlugin[]; notices?: readonly string[] }>;
  /** Picks exactly one public copy per media item and buffers its bytes into the ledger. */
  readonly bufferArchiveMedia: (required: { sources: readonly TMedia[]; blobStore: TBlobStore; imageTransformer: TTransformer; ledger: ShareLedger }, optional: { signal?: AbortSignal; packageThemesRoot?: string }) => Promise<ArchiveMediaCopy[]>;
  /** The runtime's schema identity the archive records. */
  readonly runtimeSchema: () => TSchema;
}

/** What the call supplies: the database, the site's sources, the sanitizer and the media ports. */
export interface SharePreparationPorts<TSources, TProjection, TBlobStore, TTransformer> {
  dbOps: DbOpsPort; snapshotRoot: string; sources: TSources; sanitize: ShareDatabaseSanitizer<TProjection>;
  blobStore: TBlobStore; imageTransformer: TTransformer; rewriteMedia: ArchiveMediaRewriter;
  savedKeys?: Pick<SiteSavedKeysPort, "capture">; shareId?: string; workspaceId?: string; includeSavedKeys?: boolean;
}

/**
 * The prepared share, before the host stamps its own build identity on it. Fields the host's plan
 * type adds (its version field) are the host's to add; this module never names one.
 */
export interface SharePreparedContent<TInclude, TFile, TCollected extends { scopeNotes: unknown }, TPlugin, TSchema> {
  readonly target: { readonly kind: "zip" };
  readonly profile: "share";
  readonly include: TInclude;
  readonly notices: string[];
  readonly credentialWarnings: readonly CredentialWarning[];
  readonly encryptedKeys?: typeof ENCRYPTED_KEYS_DESCRIPTOR;
  readonly sealedPassword?: SealedSecret;
  readonly media: ArchiveMediaEntry[];
  readonly plugins: TPlugin[];
  readonly database: { readonly bytes: Buffer; readonly watermarkAtCapture: number };
  readonly files: TFile[];
  readonly bufferedFiles: { path: string; content: Buffer }[];
  readonly skipped: [];
  readonly scopeNotes: TCollected["scopeNotes"];
  readonly totalBytes: number;
  readonly site: { readonly name: string; readonly folderName: string };
  readonly schema: TSchema;
  readonly createdAt: string;
}

/**
 * Same consistent snapshot and collector as a repository backup, with a fresh DB projection and
 * regenerated portable settings. Media comes ONLY from snapshot records through the blob-store
 * owner, so object-storage sites work and unreferenced/chat upload bytes cannot ride along.
 * `snapshotRoot` is the injected private folder the database snapshot lands in (never the source site).
 * @complexity O(site entries + snapshot + referenced blob bytes), bounded by archive caps.
 */
export async function prepareShareContent<TSources extends { siteDir: string }, TInclude extends object, TFile extends SharePlannedFile & { scope: string }, TCollected extends ShareCollectedFiles<TFile> & { notices?: readonly string[]; scopeNotes: unknown }, TMedia, TBlobStore, TTransformer, TPlugin, TSchema, TProjection extends ShareDatabaseProjection<TMedia>>(required: SharePreparationPorts<TSources, TProjection, TBlobStore, TTransformer> & { deps: SharePreparationDeps<TSources, TInclude, TFile, TCollected, TMedia, TBlobStore, TTransformer, TPlugin, TSchema> }, optional: { signal?: AbortSignal; packageThemesRoot?: string } = {}): Promise<SharePreparedContent<TInclude, TFile, TCollected, TPlugin, TSchema>> {
  const { deps } = required;
  optional.signal?.throwIfAborted();
  const { projected, watermarkAtCapture, savedKeys } = await deps.steps.captureProjectedDatabase(required, optional);
  const collected = await deps.steps.collectShareFiles({ sources: required.sources, include: deps.include });
  const extensions = await deps.prepareExtensions({ sources: required.sources, files: collected.files.filter(file => file.scope !== "settings") }, optional);
  const files = extensions.files;
  const notices = preparationNotices({ projected, collected, savedKeys });
  notices.push(...(extensions.notices ?? []));
  const ledger: ShareLedger = { notices, sizes: [...files.map(file => ({ path: file.path, bytes: file.bytes })), { path: "content.db", bytes: projected.bytes.length }], buffered: [] };
  deps.checkShareLimits({ files: ledger.sizes });
  const copies = await deps.bufferArchiveMedia({ sources: requireArchiveMediaSources(projected), blobStore: required.blobStore, imageTransformer: required.imageTransformer, ledger }, optional);
  const bytes = await required.rewriteMedia({ bytes: projected.bytes, copies }, optional);
  const database = ledger.sizes.find(file => file.path === "content.db");
  if (database === undefined) throw new Error("Share size ledger has no content database");
  database.bytes = bytes.length;
  deps.checkShareLimits({ files: ledger.sizes });
  if (savedKeys) deps.steps.addBuffered({ ledger, file: { path: SAVED_KEYS_PATH, content: savedKeys.encryptedKeys } });
  const name = await deps.steps.addPortableSettings({ files: collected.files, siteDir: required.sources.siteDir, ledger });
  return { target: { kind: "zip" }, profile: "share", include: deps.include, notices, credentialWarnings: projected.credentialWarnings ?? [], ...(savedKeys ? { encryptedKeys: ENCRYPTED_KEYS_DESCRIPTOR, sealedPassword: savedKeys.sealedPassword } : {}), media: copies.map(({ id, slug, path, sha256 }) => ({ id, slug, path, sha256 })), plugins: extensions.plugins, database: { bytes, watermarkAtCapture }, files, bufferedFiles: ledger.buffered, skipped: [], scopeNotes: collected.scopeNotes, totalBytes: ledger.sizes.reduce((sum, file) => sum + file.bytes, 0), site: { name, folderName: path.basename(required.sources.siteDir) }, schema: deps.runtimeSchema(), createdAt: new Date().toISOString() };
}

function requireArchiveMediaSources<TMedia>(projected: ShareDatabaseProjection<TMedia>): readonly TMedia[] {
  if (!projected.archiveMedia && projected.media.length) throw new SiteShareRefusal({ code: "INVALID_MEDIA", message: "Share projection has no archive media metadata." });
  return projected.archiveMedia ?? [];
}

/** Boundaries return independent notice lists; assembly owns the combined operation-local list. */
function preparationNotices(required: { projected: { notices?: readonly string[] }; collected: { notices?: readonly string[] }; savedKeys?: { notices: readonly string[] } | undefined }, _options = {}): string[] {
  return [...(required.projected.notices ?? []), ...(required.collected.notices ?? []), ...(required.savedKeys?.notices ?? [])];
}
