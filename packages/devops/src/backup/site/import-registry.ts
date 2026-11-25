import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { JsonFileRead } from "@jini-ai/core/contracts/site/fs-durable-json";
import type { SiteCreationAllocation } from "@jini-ai/core/contracts/site/platform-site-dir";
import type { CredentialWarning } from "./credential-warnings.js";
import { SiteShareRefusal } from "./share-refusal.js";

const UPLOAD_METADATA_SUFFIX = ".upload.json";

/** The durable JSON file and file lock the registry persists through; the host binds its filesystem implementation. */
export interface SiteImportDurableDeps {
  /** Opens one durable JSON file (atomic replacement, explicit unreadable state) with the notices it reports under. */
  openJsonFile(required: { filePath: string; notices: { prefix: string; lockTimeout(required: { lockPath: string; waitMs: number }): string } }): {
    read(required: Record<string, never>): JsonFileRead;
    write(required: { value: unknown }): void;
  };
  /** Runs `run` while holding the lock file at `lockPath`; `staleMs` is when a holder's lock may be stolen. */
  withFileLock<T>(required: { lockPath: string; run: () => Promise<T> }, options: { staleMs: number }): Promise<T>;
}

export interface SiteImportRecord {
  importId: string;
  principalId: string;
  requestId?: string;
  sourceDigest?: string;
  source: { url: string } | { uploadId: string };
  newSiteId: string | null;
  newSiteName: string | null;
  displayName: string;
  /** Private write-ahead allocation, supplied only by the existing site lifecycle. */
  creation?: SiteCreationAllocation;
  status: "verifying" | "needs-owner" | "creating" | "ready" | "failed";
  createdAt: string;
  expiresAt: number;
  adminUrl?: string | null;
  warnings?: readonly string[];
  credentialWarnings?: readonly CredentialWarning[];
  hasEncryptedKeys?: boolean;
  error?: string;
}
export interface SiteImportUpload { uploadId: string; principalId: string; createdAt: number; consumedBy?: string }
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** A staged upload is claimable for one hour after it is saved. */
const UPLOAD_TTL_MS = 3600_000;
/** The statuses whose import may still own a `<id>.stage` directory. */
const STAGED_STATUSES: ReadonlySet<SiteImportRecord["status"]> = new Set(["verifying", "needs-owner", "creating"]);
/** Only the share origin remains in finished history. Upload sources are unchanged. @complexity O(url length). */
export function withoutQuery(required: { source: SiteImportRecord["source"] }): SiteImportRecord["source"] {
  const { source } = required;
  if (!("url" in source)) return source;
  const url = new URL(source.url);
  return { url: url.origin };
}
/** Request replay can compare a link without retaining its path in finished history. */
export function importSourceDigest(required: { source: SiteImportRecord["source"] }, _optional = {}): string | undefined {
  if (!("url" in required.source)) return undefined;
  const url = new URL(required.source.url);
  return createHash("sha256").update(url.href).digest("hex");
}
/** The import id behind an `<id>.json` history record name; undefined for every other file. */
function recordIdOf({ name }: { name: string }, _optional: Record<string, never> = {}): string | undefined {
  const id = name.slice(0, -5);
  return name.endsWith(".json") && ID.test(id) ? id : undefined;
}

/** CMS import history and private staging. The injected durable store owns atomic JSON replacement and locking.
 * No public list, caller-controlled filesystem path, or source URL in a filename.
 */
export class SiteImportRegistry {
  readonly directory: string;
  private readonly log: (line: string, error: unknown) => void;
  private readonly durable: SiteImportDurableDeps;
  /** @param required.durable The durable JSON file and lock implementation. @param options.log Reports an entry the expiry sweep could not clear; defaults to `console.error`. */
  constructor(required: { directory: string; durable: SiteImportDurableDeps }, options: { log?: (line: string, error: unknown) => void } = {}) {
    this.log = options.log ?? ((line, error) => console.error(line, error));
    this.durable = required.durable;
    this.directory = path.resolve(required.directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
  }
  private file({ id, suffix }: { id: string; suffix: string }, _optional: Record<string, never> = {}) {
    if (!ID.test(id)) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Invalid import or upload id." });
    return path.join(this.directory, id + suffix);
  }
  private store({ id, suffix }: { id: string; suffix: string }, _optional: Record<string, never> = {}) {
    return this.durable.openJsonFile({ filePath: this.file({ id, suffix }), notices: { prefix: "Site imports", lockTimeout: () => "Import registry is busy." } });
  }
  /** Reads one history record; an unreadable file is refused (with the caller's wording) and left in place. */
  private readRecord(required: { importId: string; unreadable: string }): SiteImportRecord | undefined {
    const read = this.store({ id: required.importId, suffix: ".json" }).read({});
    if (read.state === "unreadable") throw new SiteShareRefusal({ code: "REGISTRY_UNREADABLE", message: required.unreadable });
    return read.state === "ok" ? read.value as SiteImportRecord : undefined;
  }
  get(required: { importId: string; principalId: string }, _options: Record<string, never> = {}): SiteImportRecord {
    const row = this.readRecord({ importId: required.importId, unreadable: "Import record is unreadable; it was left untouched." });
    if (!row || row.principalId !== required.principalId) throw new SiteShareRefusal({ code: "NOT_FOUND", message: "Import not found." });
    return row;
  }
  put(required: { row: SiteImportRecord }, _options: Record<string, never> = {}): void {
    // History is kept for good; a finished import no longer needs the share link's path or query.
    const row = required.row.status === "ready" || required.row.status === "failed" ? { ...required.row, source: withoutQuery({ source: required.row.source }) } : required.row;
    this.store({ id: required.row.importId, suffix: ".json" }).write({ value: row });
    fs.chmodSync(this.file({ id: required.row.importId, suffix: ".json" }), 0o600);
  }
  list(required: { principalId?: string }, _options: Record<string, never> = {}): SiteImportRecord[] {
    return fs.readdirSync(this.directory).map(name => recordIdOf({ name })).filter(id => id !== undefined).flatMap(importId => {
      const row = this.readRecord({ importId, unreadable: "Import history is unreadable; it was left untouched." });
      return row && (required.principalId === undefined || row.principalId === required.principalId) ? [row] : [];
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  uploadPath(required: { uploadId: string }, _options: Record<string, never> = {}): string { return this.file({ id: required.uploadId, suffix: ".upload.zip" }); }
  stagePath(required: { importId: string }, _options: Record<string, never> = {}): string { return this.file({ id: required.importId, suffix: ".stage" }); }
  saveUpload(required: { row: SiteImportUpload }, _options: Record<string, never> = {}): void { this.store({ id: required.row.uploadId, suffix: UPLOAD_METADATA_SUFFIX }).write({ value: required.row }); }
  getUpload(required: { uploadId: string; principalId: string }, _options: Record<string, never> = {}): SiteImportUpload {
    const read = this.store({ id: required.uploadId, suffix: UPLOAD_METADATA_SUFFIX }).read({});
    const row = read.state === "ok" ? read.value as SiteImportUpload : undefined;
    if (!row || row.principalId !== required.principalId || row.createdAt + UPLOAD_TTL_MS < Date.now()) throw new SiteShareRefusal({ code: "NOT_FOUND", message: "Upload not found or expired. Upload the ZIP again." });
    return row;
  }
  /** One process-wide/disk-backed transfer lane bounds buffered memory and cross-process retries. */
  async exclusive<T>(required: { run: () => Promise<T> }, _options: Record<string, never> = {}): Promise<T> {
    return this.durable.withFileLock({ lockPath: path.join(this.directory, ".import.lock"), run: required.run }, { staleMs: Infinity });
  }
  /** Removes an upload (payload, then record) once it is past its one-hour claim window. */
  private expireUpload(required: { id: string }): void {
    if (!ID.test(required.id)) return;
    const read = this.store({ id: required.id, suffix: UPLOAD_METADATA_SUFFIX }).read({});
    if (read.state !== "ok") return;
    const row = read.value as SiteImportUpload | null;
    // A null row can never be claimed (getUpload refuses it), so it expires like an old one.
    if (row !== null && row.createdAt + UPLOAD_TTL_MS >= Date.now()) return;
    fs.rmSync(this.uploadPath({ uploadId: required.id }), { force: true });
    fs.rmSync(this.file({ id: required.id, suffix: UPLOAD_METADATA_SUFFIX }), { force: true });
  }
  /** Fails an owner setup past its deadline and discards its stage; history keeps the named failure. */
  private expireOwnerSetup(required: { importId: string }): void {
    const read = this.store({ id: required.importId, suffix: ".json" }).read({});
    if (read.state !== "ok") return;
    const row = read.value as SiteImportRecord | null;
    if (row === null) return;
    if (row.status === "needs-owner" && row.expiresAt < Date.now()) {
      fs.rmSync(this.stagePath(row), { recursive: true, force: true });
      this.put({ row: { ...row, status: "failed", error: "Owner setup expired. Import the archive again." } });
    }
    // Reuse the existing history pass to remove link details from older finished records too.
    if ((row.status === "ready" || row.status === "failed") && "url" in row.source && row.source.url !== new URL(row.source.url).origin) this.put({ row });
  }
  /** Removes a ZIP whose metadata is missing or unreadable: a crash between the two writes. */
  private removeOrphanUpload(required: { id: string }): void {
    if (!ID.test(required.id) || this.store({ id: required.id, suffix: UPLOAD_METADATA_SUFFIX }).read({}).state === "ok") return;
    fs.rmSync(this.uploadPath({ uploadId: required.id }), { force: true });
  }
  /** Removes a stage no in-progress record owns; an unreadable record keeps its stage untouched. */
  private removeOrphanStage(required: { importId: string }): void {
    if (!ID.test(required.importId)) return;
    const read = this.store({ id: required.importId, suffix: ".json" }).read({});
    if (read.state === "unreadable") return;
    const status = read.state === "ok" ? (read.value as SiteImportRecord | null)?.status : undefined;
    if (status === undefined || !STAGED_STATUSES.has(status)) fs.rmSync(this.stagePath(required), { recursive: true, force: true });
  }
  /** Expired payloads are disposable; retain history with a named failure rather than dead setup.
   * Crash leftovers (a ZIP without metadata, a stage without a pending record) are removed too, so
   * they never pin the staging budget. Callers hold the import lock: an upload writes its ZIP
   * before its metadata, so an unlocked sweep could remove a payload that is still being saved.
   */
  expire(_required: Record<string, never>, _options: Record<string, never> = {}): void {
    for (const filename of fs.readdirSync(this.directory)) {
      // One entry that cannot be removed (permissions, a busy file) must not stop the rest of the sweep.
      try { this.expireEntry({ filename }); } catch (error) {
        this.log(`[site-backup] import registry could not clear expired entry ${filename}; the rest of the sweep continues`, error);
      }
    }
  }
  private expireEntry({ filename }: { filename: string }): void {
    const importId = recordIdOf({ name: filename });
    if (filename.endsWith(UPLOAD_METADATA_SUFFIX)) this.expireUpload({ id: filename.slice(0, -12) });
    else if (filename.endsWith(".upload.zip")) this.removeOrphanUpload({ id: filename.slice(0, -11) });
    else if (filename.endsWith(".stage")) this.removeOrphanStage({ importId: filename.slice(0, -6) });
    else if (importId !== undefined) this.expireOwnerSetup({ importId });
    else {
      // Unrecognized files are outside the import registry.
    }
  }
}
