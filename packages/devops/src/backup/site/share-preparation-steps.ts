import { createHash } from "node:crypto";
import path from "node:path";
import type { DbOpsPort } from "@jini-ai/core/contracts/site/gated-mutations-ports";
import type { CredentialWarning } from "./credential-warnings.js";
import type { SiteSavedKeysPort } from "./saved-keys-port.js";
import { SiteShareRefusal } from "./share-refusal.js";

/**
 * @file The steps of `prepareShareContent`: the projected database, the collected site files, the
 * referenced media read through the blob store, and the regenerated portable settings. The host
 * owns every size cap, its wording, the file walker and the snapshot reader; they arrive as
 * {@link ShareStepsDeps} through {@link createShareSteps}.
 */

/** The blob-store slice the share reads: bytes by key, and the size without reading them. */
export interface ShareBlobStore {
  get(required: { storageKey: string }): Promise<Uint8Array>;
  sizeOf?(required: { storageKey: string }): Promise<number | null>;
}

/** Every byte the share will carry, checked against the archive caps on each addition. */
export interface ShareLedger {
  readonly sizes: { path: string; bytes: number }[];
  readonly buffered: { path: string; content: Buffer }[];
  readonly notices?: string[];
}

/** One media record of the projected database the share reads bytes for. */
export interface ShareMediaReference { readonly storageKey: string; readonly sha256?: string; readonly destinationStorageKey?: string }

/** What the sanitizer returns: fresh database bytes plus the media the copy still references. */
export interface ShareDatabaseProjection<TArchiveMedia = unknown> {
  readonly credentialWarnings?: readonly CredentialWarning[];
  readonly notices?: readonly string[];
  readonly archiveMedia?: readonly TArchiveMedia[];
  readonly bytes: Buffer;
  readonly media: readonly ShareMediaReference[];
  /** Original document policies travel separately from deduplicated blob references. */
  readonly documents?: readonly { storageKey: string; sha256: string; originalFilename: string }[];
}
export type ShareDatabaseSanitizer<TProjection = ShareDatabaseProjection> = (required: { snapshot: Buffer; omittedMediaIds?: readonly string[] }, optional?: { signal?: AbortSignal | undefined }) => Promise<TProjection>;

/** The slice of a planned on-disk file the steps read. */
export interface SharePlannedFile { readonly path: string; readonly bytes: number }

/** The collector's answer: the planned files, and any file it refused to plan. */
export interface ShareCollectedFiles<TFile extends SharePlannedFile = SharePlannedFile> {
  readonly files: readonly TFile[];
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
}

/** The database snapshot reader's answer: bytes, or a caller-safe refusal message. */
export type ShareSnapshotResult = { ok: true; bytes: Buffer; watermarkAtCapture: number } | { ok: false; message: string };

/** What the host owns: caps and their copy, the file walker, the snapshot reader and the planned-file reader. */
export interface ShareStepsDeps<TSources extends { siteDir: string }, TInclude extends object, TFile extends SharePlannedFile, TCollected extends ShareCollectedFiles<TFile>> {
  /** The byte caps the steps enforce: the expanded cap bounds the snapshot, the manifest cap bounds each settings file, the document cap bounds a library document blob. */
  readonly limits: { readonly maxExpandedBytes: number; readonly maxManifestBytes: number; readonly maxDocumentBytes: number };
  /** Host wording for the refusals whose text names a cap. */
  readonly messages: { readonly settingsTooLarge: (required: { path: string }) => string; readonly invalidDocument: string };
  /** Throws a {@link SiteShareRefusal} when the listed files break the archive caps. */
  readonly checkShareLimits: (required: { files: readonly { path: string; bytes: number }[] }) => void;
  readonly captureDatabaseSnapshot: (required: { dbOps: DbOpsPort; scopeId: string }, optional: { maxBytes: number; snapshotRoot: string }) => Promise<ShareSnapshotResult>;
  readonly collectFiles: (required: { sources: TSources; include: TInclude }, optional: { profile: "share" }) => Promise<TCollected>;
  readonly readPlannedFile: (file: TFile) => Promise<{ ok: true; bytes: Buffer } | { ok: false; message: string }>;
}

const PROVENANCE_KEYS = ["templateId", "templateVersion", "schemaVersion", "schemaTag"];
const PROVENANCE_TEXT = /^[a-z\d_.+-]{1,128}$/i;

/** The bound steps; build one with {@link createShareSteps}. */
export interface ShareSteps<TSources extends { siteDir: string }, TInclude extends object, TFile extends SharePlannedFile, TCollected extends ShareCollectedFiles<TFile>> {
  addBuffered(required: { ledger: ShareLedger; file: { path: string; content: Buffer } }): void;
  captureProjectedDatabase<TProjection>(required: { dbOps: DbOpsPort; sanitize: ShareDatabaseSanitizer<TProjection>; snapshotRoot: string; savedKeys?: Pick<SiteSavedKeysPort, "capture">; shareId?: string; workspaceId?: string; includeSavedKeys?: boolean }, optional?: { signal?: AbortSignal }): Promise<{ projected: TProjection; watermarkAtCapture: number; savedKeys?: Awaited<ReturnType<SiteSavedKeysPort["capture"]>> }>;
  collectShareFiles(required: { sources: TSources; include: TInclude }): Promise<TCollected>;
  reportedBlobSize(required: { blobStore: ShareBlobStore; storageKey: string; document: boolean }): Promise<number>;
  fetchVerifiedBlob(required: { blobStore: ShareBlobStore; media: { storageKey: string; sha256?: string }; size: number }): Promise<Buffer>;
  addPortableSettings(required: { files: readonly TFile[]; siteDir: string; ledger: ShareLedger }): Promise<string>;
}

/**
 * Binds the share steps to a host's caps, file walker and snapshot reader.
 * @returns the steps; each refuses with a {@link SiteShareRefusal} instead of returning a partial share.
 */
export function createShareSteps<TSources extends { siteDir: string }, TInclude extends object, TFile extends SharePlannedFile, TCollected extends ShareCollectedFiles<TFile>>(deps: ShareStepsDeps<TSources, TInclude, TFile, TCollected>): ShareSteps<TSources, TInclude, TFile, TCollected> {
  /** Adds one buffered file after re-checking the caps with it counted. */
  function addBuffered(required: { ledger: ShareLedger; file: { path: string; content: Buffer } }): void {
    required.ledger.sizes.push({ path: required.file.path, bytes: required.file.content.length });
    deps.checkShareLimits({ files: required.ledger.sizes });
    required.ledger.buffered.push(required.file);
  }

  /**
   * Snapshots the site database and returns only the sanitizer's fresh projection.
   * Release the private snapshot before buffering media and assembling the public ZIP: the snapshot
   * is scoped to this helper, so it is released before the caller does either.
   * `snapshotRoot` is a private folder outside the source site: Export never writes into site storage.
   * @throws SiteShareRefusal DATABASE_SNAPSHOT_FAILED with the snapshot's caller-safe message.
   */
  async function captureProjectedDatabase<TProjection>(required: { dbOps: DbOpsPort; sanitize: ShareDatabaseSanitizer<TProjection>; snapshotRoot: string; savedKeys?: Pick<SiteSavedKeysPort, "capture">; shareId?: string; workspaceId?: string; includeSavedKeys?: boolean }, optional: { signal?: AbortSignal | undefined } = {}): Promise<{ projected: TProjection; watermarkAtCapture: number; savedKeys?: Awaited<ReturnType<SiteSavedKeysPort["capture"]>> }> {
    const snapshot = await deps.captureDatabaseSnapshot({ dbOps: required.dbOps, scopeId: "site-share" }, { maxBytes: deps.limits.maxExpandedBytes, snapshotRoot: required.snapshotRoot });
    if (!snapshot.ok) throw new SiteShareRefusal({ code: "DATABASE_SNAPSHOT_FAILED", message: snapshot.message });
    const projected = await required.sanitize({ snapshot: snapshot.bytes }, { signal: optional.signal });
    return { projected, watermarkAtCapture: snapshot.watermarkAtCapture };
  }

  /** Collects the share profile's files (never the media folder); any skipped file refuses by name. */
  async function collectShareFiles(required: { sources: TSources; include: TInclude }): Promise<TCollected> {
    const collected = await deps.collectFiles({ sources: required.sources, include: { ...required.include, media: false } }, { profile: "share" });
    if (collected.skipped.length) {
      const skipped = collected.skipped[0];
      if (skipped === undefined) throw new Error("Share export has no skipped-file details");
      throw new SiteShareRefusal({ code: "UNSAFE_FILE", message: `Cannot share '${skipped.path}': ${skipped.reason}. Remove it or replace it with a regular file.` });
    }
    return collected;
  }

  /** Reads the blob's size from the store without fetching it; refuses a missing, invalid or over-cap blob. */
  async function reportedBlobSize(required: { blobStore: ShareBlobStore; storageKey: string; document: boolean }): Promise<number> {
    if (!required.blobStore.sizeOf) throw new SiteShareRefusal({ code: "UNBOUNDED_MEDIA", message: "This media store cannot report blob sizes. Configure a size-aware blob store before sharing." });
    const size = await required.blobStore.sizeOf({ storageKey: required.storageKey });
    if (size === null) throw new SiteShareRefusal({ code: "MISSING_MEDIA", message: `Share media '${required.storageKey}' is missing from the blob store.` });
    if (!Number.isSafeInteger(size) || size < 0) throw new SiteShareRefusal({ code: "UNBOUNDED_MEDIA", message: "Media storage returned an invalid byte count; nothing was shared." });
    if (required.document && (size === 0 || size > deps.limits.maxDocumentBytes)) throw new SiteShareRefusal({ code: "INVALID_DOCUMENT", message: deps.messages.invalidDocument });
    deps.checkShareLimits({ files: [{ path: "media/blob", bytes: size }] });
    return size;
  }

  /** Reads the blob and refuses bytes whose length or checksum differ from what was reported. */
  async function fetchVerifiedBlob(required: { blobStore: ShareBlobStore; media: { storageKey: string; sha256?: string }; size: number }): Promise<Buffer> {
    const { media } = required;
    const content = Buffer.from(await required.blobStore.get({ storageKey: media.storageKey }));
    if (content.length !== required.size || (media.sha256 && createHash("sha256").update(content).digest("hex") !== media.sha256)) throw new SiteShareRefusal({ code: "MEDIA_CHANGED", message: `Share media '${media.storageKey}' changed or failed its checksum.` });
    return content;
  }

  /** Read only the small, no-follow planned settings files; all other metadata is discarded. */
  async function readPortableJson(required: { file?: TFile | undefined }): Promise<Record<string, unknown>> {
    if (!required.file) return {};
    if (required.file.bytes > deps.limits.maxManifestBytes) throw new SiteShareRefusal({ code: "INVALID_SETTINGS", message: deps.messages.settingsTooLarge({ path: required.file.path }) });
    const read = await deps.readPlannedFile(required.file);
    if (!read.ok) throw new SiteShareRefusal({ code: "PLAN_STALE", message: read.message });
    try {
      const value: unknown = JSON.parse(read.bytes.toString("utf8"));
      if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* A malformed portable setting must not produce a partial share. */ }
    throw new SiteShareRefusal({ code: "INVALID_SETTINGS", message: `Share settings '${required.file.path}' must contain a JSON object.` });
  }

  /**
   * Regenerates root `settings.json` with name and named template provenance, never host configuration.
   * @returns the shared site name: the config's string `name`, else the site folder name.
   */
  async function addPortableSettings(required: { files: readonly TFile[]; siteDir: string; ledger: ShareLedger }): Promise<string> {
    const config = await readPortableJson({ file: required.files.find(file => file.path === "settings/config.json") });
    const name = typeof config.name === "string" ? config.name : path.basename(required.siteDir);
    const meta = await readPortableJson({ file: required.files.find(file => file.path === "settings/.site-meta.json") });
    addBuffered({ ledger: required.ledger, file: { path: "settings.json", content: Buffer.from(JSON.stringify({ name, template: pickProvenance({ meta }) })) } });
    return name;
  }

  return { addBuffered, captureProjectedDatabase, collectShareFiles, reportedBlobSize, fetchVerifiedBlob, addPortableSettings };
}

function pickProvenance(required: { meta: Record<string, unknown> }, _options = {}): Record<string, unknown> {
  const provenance: Record<string, unknown> = {};
  // Pick named provenance fields; never spread site identity, paths, fingerprints or storage.
  for (const key of PROVENANCE_KEYS) {
    const value = required.meta[key];
    const validText = typeof value === "string" && PROVENANCE_TEXT.test(value);
    const validNumber = typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    if (validText || validNumber) provenance[key] = value;
  }
  return provenance;
}
