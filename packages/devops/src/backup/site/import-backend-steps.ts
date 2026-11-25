import type { SiteImportRecord, SiteImportSource, SiteImportView } from "@jini-ai/core/contracts/site/site-import-history";
import fs from "node:fs";
import { formatErrorForLog, type SecretRedactionOptions } from "@jini-ai/core";
import type { SiteCreationAllocation } from "@jini-ai/core/contracts/site/platform-site-dir";
import type { SiteImportRegistry } from "./import-registry.js";
import { SiteShareRefusal } from "./share-refusal.js";

/**
 * @file The import backend's individual steps: input parsing, the private staging budget, the
 * share download, upload consumption, interrupted-creation recovery and the public row view.
 * Each takes its ports explicitly; `import-backend.ts` sequences them under the import lock.
 */

/** The guarded HTTP client the share download goes through; the host binds its own egress-policed client. */
export interface ImportHttpClient {
  send(required: {
    method: "GET"; url: string; headers: Record<string, string>; idleTimeoutMs: number; totalDeadlineMs: number;
    maxResponseBytes: number; bodyAs: "bytes"; signal: AbortSignal;
  }, optional?: Record<string, never>): Promise<{
    status: number; headers: Readonly<Record<string, string>>; bodyBytes?: Uint8Array | undefined; bodyBytesTruncated?: boolean | undefined;
  }>;
}

/** Host-owned refusal copy that quotes the host's byte limits, passed in so the limits and their wording stay together. */
export interface SiteImportCopy {
  /** Refusal when the sites-home volume cannot take the import's expanded archive. */
  readonly homeSpace: string;
  /** Refusal when the private staging volume cannot take another payload. */
  readonly stagingSpace: string;
  /** Refusal when a share download fails or exceeds `maxArchiveBytes`. */
  readonly downloadFailed: string;
  /** Refusal when an uploaded ZIP exceeds `maxArchiveBytes`. */
  readonly uploadTooLarge: string;
}

/** Host values the import steps depend on. Every member is REQUIRED: the engine carries no host defaults.
 * `W` is the host's workspace handle, only ever handed back to `reconcileCreation`.
 */
export interface SiteImportStepsHost<W = unknown> {
  /** Largest ZIP accepted by upload or download. */
  readonly maxArchiveBytes: number;
  /** Largest expanded archive; free space of three times this is required before retaining payloads. */
  readonly maxExpandedBytes: number;
  readonly copy: SiteImportCopy;
  /** The development default owner password that an import must never reuse. */
  readonly developmentDefaultPassword: string;
  /** Redaction policy applied to the failure text logged when an imported site cannot start. */
  readonly errorLogOptions: SecretRedactionOptions;
  /** The timeout, in milliseconds, when `error` is the HTTP client's timeout failure; otherwise `undefined`. */
  timeoutMsOf(required: { error: unknown }): number | undefined;
  /** Throws when `name` cannot be a portable site folder name. */
  assertPortableName(required: { name: string }): void;
  /** Settles an interrupted site creation against the workspace. */
  reconcileCreation(required: { allocation: SiteCreationAllocation; workspace: W }): Promise<"ready" | "failed">;
}
export interface ParsedSiteImportInput { source: SiteImportSource; displayName?: string; requestId?: string }

/** Throws the closed-contract refusal every import step reports; never returns. */
export function refusal({ code, message }: { code: string; message: string }, _optional: Record<string, never> = {}): never { throw new SiteShareRefusal({ code, message }); }

const INPUT_KEYS = ["url", "uploadId", "displayName", "requestId"];
const REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const UPLOAD_ID = /^[a-f0-9-]{36}$/;
const ARCHIVE_CONTENT_TYPES = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];

/** Source union is enforced at every remote boundary; server paths are never accepted. */
export function parseImportInput(required: { input: unknown }): ParsedSiteImportInput {
  const input = requireSourceShape({ value: required.input });
  if (input.displayName !== undefined && !isDisplayName({ value: input.displayName })) refusal({ code: "INVALID_INPUT", message: "displayName must be 1..200 characters." });
  if (input.requestId !== undefined && (typeof input.requestId !== "string" || !REQUEST_ID.test(input.requestId))) refusal({ code: "INVALID_INPUT", message: "requestId must be 1..128 letters, digits, dashes or underscores." });
  const source = input.url !== undefined ? parseUrlSource({ url: input.url }) : parseUploadSource({ uploadId: input.uploadId });
  return { source, ...(input.displayName !== undefined ? { displayName: input.displayName as string } : {}), ...(input.requestId !== undefined ? { requestId: input.requestId as string } : {}) };
}

function requireSourceShape({ value }: { value: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> {
  const input = value as Record<string, unknown>;
  const invalidRecord = !input || typeof input !== "object" || Array.isArray(input);
  if (invalidRecord || Object.keys(input).some(key => !INPUT_KEYS.includes(key)) ||
      (input.url !== undefined) === (input.uploadId !== undefined)) refusal({ code: "INVALID_INPUT", message: "Provide exactly one source: url or uploadId; optional displayName and requestId only." });
  return input;
}

function isDisplayName({ value }: { value: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 200;
}

function parseUrlSource(required: { url: unknown }): SiteImportSource {
  if (typeof required.url !== "string" || required.url.length > 4096) refusal({ code: "INVALID_INPUT", message: "url must be an HTTPS share URL." });
  let url: URL;
  try { url = new URL(required.url); } catch { refusal({ code: "INVALID_INPUT", message: "url must be an HTTPS share URL." }); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) refusal({ code: "INVALID_INPUT", message: "Import URLs require HTTPS without credentials or fragments." });
  return { url: url.href };
}

function parseUploadSource(required: { uploadId: unknown }): SiteImportSource {
  if (typeof required.uploadId !== "string" || !UPLOAD_ID.test(required.uploadId)) refusal({ code: "INVALID_INPUT", message: "uploadId must come from the authenticated ZIP upload endpoint." });
  return { uploadId: required.uploadId };
}

/** Refuses when the volume holding `dir` has less than three expanded-archive caps free. */
export function requireFreeSpace(required: { dir: string; message: string; maxExpandedBytes: number }): void {
  const space = fs.statfsSync(required.dir);
  if (space.bavail * space.bsize < required.maxExpandedBytes * 3) refusal({ code: "INSUFFICIENT_STORAGE", message: required.message });
}

/** At most four private payloads (uploads or stages) and 900 MiB free before retaining more bytes. */
export function requireStagingBudget(required: { registry: SiteImportRegistry; host: Pick<SiteImportStepsHost, "maxExpandedBytes" | "copy"> }): void {
  required.registry.expirePayloads({});
  // The staging cap counts disposable payloads, not history.
  const payloads = required.registry.countStagedPayloads({});
  if (payloads >= 4) refusal({ code: "BUSY", message: "Four imports are staged. Complete owner setup or wait for expiry before uploading another." });
  requireFreeSpace({ dir: required.registry.payloadDirectory, message: required.host.copy.stagingSpace, maxExpandedBytes: required.host.maxExpandedBytes });
}

/** The caller's signal (when given) combined with this step's own deadline. */
export function deadlineSignal(required: { timeoutMs: number }, optional: { signal?: AbortSignal } = {}): AbortSignal {
  return AbortSignal.any([...(optional.signal ? [optional.signal] : []), AbortSignal.timeout(required.timeoutMs)]);
}

/** Marks one unconsumed upload as consumed by `importId` and returns its id. */
export function consumeUpload(required: { registry: SiteImportRegistry; uploadId: string; principalId: string; importId: string }): string {
  const upload = required.registry.getUpload({ uploadId: required.uploadId, principalId: required.principalId });
  if (upload.consumedBy) refusal({ code: "UPLOAD_USED", message: "This upload was already imported. Use the original requestId or upload again for a separate site." });
  required.registry.saveUpload({ row: { ...upload, consumedBy: required.importId } });
  return upload.uploadId;
}

/**
 * Downloads a share archive through the guarded HTTP port: a bounded identity GET whose body must
 * be complete and labelled ZIP or binary.
 * @complexity O(archive bytes), at most 300 MiB.
 */
export async function downloadShareArchive(required: { http: ImportHttpClient; url: string; signal: AbortSignal; host: Pick<SiteImportStepsHost, "maxArchiveBytes" | "copy" | "timeoutMsOf"> }): Promise<Buffer> {
  // Keep the final minute of the import budget for verification and restore.
  const response = await required.http.send({ method: "GET", url: required.url, headers: { Accept: "application/zip", "Accept-Encoding": "identity" }, idleTimeoutMs: 30_000, totalDeadlineMs: 240_000, maxResponseBytes: required.host.maxArchiveBytes, bodyAs: "bytes", signal: required.signal }).catch((error: unknown) => {
    const timeoutMs = required.host.timeoutMsOf({ error });
    if (timeoutMs !== undefined) refusal({ code: "DOWNLOAD_TIMEOUT", message: `The share download from ${new URL(required.url).origin} timed out after ${timeoutMs / 1000} seconds. Download the ZIP file and import it.` });
    throw error;
  });
  if (response.status !== 200 || !response.bodyBytes || response.bodyBytesTruncated !== false) refusal({ code: "DOWNLOAD_FAILED", message: required.host.copy.downloadFailed });
  const contentType = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1]?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !ARCHIVE_CONTENT_TYPES.includes(contentType)) refusal({ code: "INVALID_CONTENT_TYPE", message: "Share download must have a ZIP or binary Content-Type." });
  return Buffer.isBuffer(response.bodyBytes) ? response.bodyBytes : Buffer.from(response.bodyBytes.buffer, response.bodyBytes.byteOffset, response.bodyBytes.byteLength);
}

/**
 * Only the lock holder may classify a verifying or creating row as interrupted, never a concurrent
 * reader: both statuses exist only while the import lock is held, so the holder finding one means
 * the previous holder crashed. A verifying row failed; a creating row with an allocation is
 * reconciled against the workspace, one without it failed. Either way its stage is discarded.
 */
export async function reconcileInterruptedImports<W>(required: {
  registry: SiteImportRegistry; workspace: W; put: (row: SiteImportRecord) => void; host: Pick<SiteImportStepsHost<W>, "reconcileCreation">;
  activeRows: (required: Record<string, never>, optional?: Record<string, never>) => SiteImportRecord[];
}, _optional: Record<string, never> = {}): Promise<void> {
  for (const row of required.activeRows({}, {})) {
    if (row.status === "verifying") required.put({ ...row, status: "failed", error: "Archive verification was interrupted. Import the archive again." });
    else if (row.status === "creating") required.put(await reconcileCreatingRow({ row, workspace: required.workspace, host: required.host }));
    else continue;
    fs.rmSync(required.registry.stagePath(row), { recursive: true, force: true });
  }
}

/** The settled row for an interrupted creation: kept when the workspace has the site, else failed. */
async function reconcileCreatingRow<W>(required: { row: SiteImportRecord; workspace: W; host: Pick<SiteImportStepsHost<W>, "reconcileCreation"> }): Promise<SiteImportRecord> {
  const { row } = required;
  const status = row.creation ? await required.host.reconcileCreation({ allocation: row.creation, workspace: required.workspace }) : "failed";
  return { ...row, status, ...(status === "failed" ? { newSiteId: null, newSiteName: null, error: "Site creation was interrupted and rolled back. Import the archive again." } : {}) };
}

/** A folder-safe site name from the display name; non-Latin names fall back to `imported-site`.
 * @throws {ValidationError} Windows device names or trailing dots/spaces, before or after slugification.
 * @complexity O(display name length), no I/O.
 */
export function importSiteSlug(required: { displayName: string; host: Pick<SiteImportStepsHost, "assertPortableName"> }, _optional = {}): string {
  required.host.assertPortableName({ name: required.displayName });
  const slug = required.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "imported-site";
  required.host.assertPortableName({ name: slug });
  return slug;
}

/** The owner-setup gate: only a pending import, and never without a new password. */
export function requireOwnerSetup(required: { row: SiteImportRecord; adminPassword: unknown; host: Pick<SiteImportStepsHost, "developmentDefaultPassword"> }): void {
  if (required.row.status !== "needs-owner") refusal({ code: "INVALID_STATE", message: "This import is not awaiting owner setup. Import the archive again if it failed or expired." });
  if (required.adminPassword === undefined || required.adminPassword === required.host.developmentDefaultPassword) refusal({ code: "INVALID_PASSWORD", message: "Choose a new owner password; the development default cannot be used for an import." });
}

/** Owner and restore are committed; a start failure is recorded, never retried as a new site. */
export async function startImportedSite(required: { row: SiteImportRecord; name: string; startSite: (required: { name: string }) => Promise<{ adminUrl: string | null }>; host: Pick<SiteImportStepsHost, "errorLogOptions"> }): Promise<SiteImportRecord> {
  try {
    const started = await required.startSite({ name: required.name });
    return { ...required.row, adminUrl: started.adminUrl, ...(started.adminUrl ? {} : { error: "Site created; start it from Sites to open admin." }) };
  } catch (error) {
    console.warn("[site-import] The imported site could not start; the site remains available from Sites.", formatErrorForLog({ error }, required.host.errorLogOptions));
    return { ...required.row, error: "Site created with its owner. Start it from Sites to open admin." };
  }
}

/**
 * Shows a needs-owner row past its expiry as failed. Lock-free indexed reads (list, page, get,
 * replay) cannot run the expiry sweep, which writes, so they project the expired state instead
 * of persisting it; this is the single source of truth for that projection.
 */
export function projectExpiredOwnerSetup({ row, nowMs }: { row: SiteImportRecord; nowMs: number }, _optional: Record<string, never> = {}): SiteImportRecord {
  if (row.status !== "needs-owner" || row.expiresAt >= nowMs) return row;
  return { ...row, status: "failed", error: "Owner setup expired", warnings: undefined, credentialWarnings: [] };
}

/** The public view of a stored import row. */
export function siteImportView(required: { row: SiteImportRecord; setupBase: string }, _optional: Record<string, never> = {}): SiteImportView {
  const { row } = required;
  const pending = row.status === "needs-owner";
  return {
    importId: row.importId, source: row.source,
    newSiteId: row.newSiteId, newSiteName: row.newSiteName, state: row.status, status: row.status, createdAt: row.createdAt,
    ...(pending ? { setupUrl: required.setupBase + "/" + row.importId + "/owner" } : {}),
    adminUrl: row.adminUrl, error: row.error, warnings: row.warnings, credentialWarnings: row.credentialWarnings ?? [], hasEncryptedKeys: row.hasEncryptedKeys,
    instructions: pending ? "Open setupUrl while signed in as the importing principal and choose a new owner password privately. The site is unavailable until setup completes." : "Open adminUrl when available. Imported extensions remain quarantined and need explicit review before activation.",
  };
}
