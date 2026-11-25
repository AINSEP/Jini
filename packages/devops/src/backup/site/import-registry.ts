import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { FileLockPort } from "@jini-ai/core/contracts/runtime";
import type { JsonFileRead } from "@jini-ai/core/contracts/site/fs-durable-json";
import { payloadPaths, ensurePayloadNamespace, expirePayloads, countStagedPayloads, type ImportPayloadFs } from "./import-index/payload-namespace.js";
import type { SiteImportRecord, ImportHistoryPolicy } from "@jini-ai/core/contracts/site/site-import-history";
import type { SqliteSyncClient } from "@jini-ai/core/contracts/storage";
import type { ImportIndexStore } from "./import-index/store.js";
import { SiteShareRefusal } from "./share-refusal.js";

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

/** CMS import history and private staging. The injected payload ports own atomic JSON replacement and locking.
 * No public list, caller-controlled filesystem path, or source URL in a filename.
 */
export class SiteImportRegistry {
  readonly directory: string;
  readonly history?: {
    read<T>(required: { run: (session: { kind: "legacy" } | { kind: "index"; db: SqliteSyncClient; store: ImportIndexStore; policy: ImportHistoryPolicy }, optional?: Record<string, never>) => T }, optional?: Record<string, never>): T;
    locked<T>(required: { run: (session: { kind: "legacy"; confirm?: (required: Record<string, never>, optional?: Record<string, never>) => void } | { kind: "index"; db: SqliteSyncClient; store: ImportIndexStore; policy: ImportHistoryPolicy; beforeWrite: (required: Record<string, never>, optional?: Record<string, never>) => void; expireHistory: (required: Record<string, never>, optional?: Record<string, never>) => void; sweep: (required: Record<string, never>, optional?: Record<string, never>) => void }, optional?: Record<string, never>) => Promise<T> }, optional?: Record<string, never>): Promise<T>;
  } | undefined;
  session: Parameters<Parameters<NonNullable<SiteImportRegistry["history"]>["locked"]>[0]["run"]>[0] = { kind: "legacy" };
  readonly payloadDirectory: string;
  readonly clock: { nowMs(): number };
  private readonly paths: ReturnType<typeof payloadPaths>;
  private readonly payload: {
    fs: ImportPayloadFs; clock: { nowMs(): number }; lock: FileLockPort;
    readJsonAt: (required: { file: string }, optional?: Record<string, never>) => JsonFileRead;
    writeJsonAt: (required: { file: string; value: unknown }, optional?: Record<string, never>) => void;
  };
  private ready = false;
  private readonly log: (line: string, error: unknown) => void;
  /** @param options.log Reports an entry the expiry sweep could not clear; defaults to `console.error`. */
  constructor(required: { directory: string; payload: SiteImportRegistry["payload"]; history?: SiteImportRegistry["history"] }, options: { log?: (line: string, error: unknown) => void } = {}) {
    this.log = options.log ?? ((line, error) => console.error(line, error));
    this.directory = path.resolve(required.directory);
    this.payload = required.payload;
    this.history = required.history;
    this.clock = required.payload.clock;
    this.paths = payloadPaths({ root: this.directory });
    this.payloadDirectory = this.paths.dir;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
  }
  private file({ id, suffix }: { id: string; suffix: string }, _optional: Record<string, never> = {}) {
    if (!ID.test(id)) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Invalid import or upload id." });
    return path.join(this.directory, id + suffix);
  }
  /** Reads one history record; an unreadable file is refused (with the caller's wording) and left in place. */
  private readRecord(required: { importId: string; unreadable: string }): SiteImportRecord | undefined {
    const read = this.payload.readJsonAt({ file: this.file({ id: required.importId, suffix: ".json" }) });
    if (read.state === "unreadable") throw new SiteShareRefusal({ code: "REGISTRY_UNREADABLE", message: required.unreadable });
    return read.state === "ok" ? read.value as SiteImportRecord : undefined;
  }
  get(required: { importId: string; principalId: string }, _options: Record<string, never> = {}): SiteImportRecord {
    this.file({ id: required.importId, suffix: ".json" });
    const row = this.session.kind === "index" ? this.session.store.get(required) : this.history
      ? this.history.read({ run: (session, _optional = {}) => session.kind === "index" ? session.store.get(required) : this.readRecord({ importId: required.importId, unreadable: "Import record is unreadable; it was left untouched." }) })
      : this.readRecord({ importId: required.importId, unreadable: "Import record is unreadable; it was left untouched." });
    if (!row || row.principalId !== required.principalId) throw new SiteShareRefusal({ code: "NOT_FOUND", message: "Import not found." });
    return row;
  }
  put(required: { row: SiteImportRecord }, _options: Record<string, never> = {}): void {
    if (this.session.kind === "index") {
      this.session.store.put({ row: required.row, beforeWrite: this.session.beforeWrite });
      return;
    }
    this.confirmLegacyAuthority({});
    // History is kept for good; a finished import no longer needs the share link's path or query.
    const row = required.row.status === "ready" || required.row.status === "failed" ? { ...required.row, source: withoutQuery({ source: required.row.source }) } : required.row;
    this.payload.writeJsonAt({ file: this.file({ id: required.row.importId, suffix: ".json" }), value: row });
    fs.chmodSync(this.file({ id: required.row.importId, suffix: ".json" }), 0o600);
  }
  /** Before a legacy JSON put, confirm under the held lock that the snapshot is still the authority. */
  private confirmLegacyAuthority(_required: Record<string, never>): void {
    if (!this.history) return;
    // Another process may have moved authority to the index since this lock's resolution; a stale JSON
    // write then could let a pre-index reader create the same site twice.
    if (this.session.kind !== "legacy" || !this.session.confirm) throw new Error("Legacy import history writes need the import lock.");
    this.session.confirm({});
  }
  list(required: { principalId?: string }, _options: Record<string, never> = {}): SiteImportRecord[] {
    return fs.readdirSync(this.directory).map(name => recordIdOf({ name })).filter(id => id !== undefined).flatMap(importId => {
      const row = this.readRecord({ importId, unreadable: "Import history is unreadable; it was left untouched." });
      return row && (required.principalId === undefined || row.principalId === required.principalId) ? [row] : [];
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  uploadPath(required: { uploadId: string }, _options: Record<string, never> = {}): string { return this.paths.upload(required); }
  stagePath(required: { importId: string }, _options: Record<string, never> = {}): string { return this.paths.stage(required); }
  saveUpload(required: { row: SiteImportUpload }, _options: Record<string, never> = {}): void { this.payload.writeJsonAt({ file: this.paths.uploadMeta(required.row), value: required.row }); }
  getUpload(required: { uploadId: string; principalId: string }, _options: Record<string, never> = {}): SiteImportUpload {
    const read = this.payload.readJsonAt({ file: this.paths.uploadMeta(required) });
    const row = read.state === "ok" ? read.value as SiteImportUpload : undefined;
    if (!row || row.principalId !== required.principalId || row.createdAt + UPLOAD_TTL_MS < this.clock.nowMs()) throw new SiteShareRefusal({ code: "NOT_FOUND", message: "Upload not found or expired. Upload the ZIP again." });
    return row;
  }
  /** One process-wide/disk-backed transfer lane bounds buffered memory and cross-process retries. */
  async exclusive<T>(required: { run: () => Promise<T> }, _options: Record<string, never> = {}): Promise<T> {
    return this.payload.lock.withFileLock({ lockPath: path.join(this.directory, ".import.lock"), run: async () => {
      if (!this.ready) {
        // Nonmutating refusal check first: a refused workspace must not create or move payload directories.
        this.history?.read({ run: (_session, _optional = {}) => undefined });
        ensurePayloadNamespace({ root: this.directory, paths: this.paths, fs: this.payload.fs });
        this.ready = true;
      }
      if (!this.history) return required.run();
      return this.history.locked({ run: async (session, _optional = {}) => {
        this.session = session;
        try { return await required.run(); } finally { this.session = { kind: "legacy" }; }
      } });
    } }, { staleMs: Infinity });
  }
  expirePayloads(_required: Record<string, never>, _optional: Record<string, never> = {}): void {
    expirePayloads({ paths: this.paths, fs: this.payload.fs, clock: this.clock,
      // A null row can never be claimed (getUpload refuses it), so it expires like an old one.
      readUpload: ({ uploadId }, _optional = {}) => this.payload.readJsonAt({ file: this.paths.uploadMeta({ uploadId }) }),
      statusOf: ({ importId }, _optional = {}) => {
        if (this.session.kind === "index") {
          const status = this.session.store.statusOf({ importId });
          if (status === undefined) return "absent";
          return STAGED_STATUSES.has(status) ? "active" : "terminal";
        }
        const read = this.payload.readJsonAt({ file: this.file({ id: importId, suffix: ".json" }) });
        if (read.state === "unreadable") return "unreadable";
        if (read.state !== "ok" || read.value === null) return "absent";
        return STAGED_STATUSES.has((read.value as SiteImportRecord).status) ? "active" : "terminal";
      },
      report: ({ operation, error }, _optional = {}) => this.log(`[site-backup] ${operation}`, error),
    });
  }
  countStagedPayloads(_required: Record<string, never>, _optional: Record<string, never> = {}): number {
    return countStagedPayloads({ paths: this.paths, fs: this.payload.fs });
  }
  /** Fails an owner setup past its deadline and discards its stage; history keeps the named failure. */
  private expireOwnerSetup(required: { importId: string }): void {
    const read = this.payload.readJsonAt({ file: this.file({ id: required.importId, suffix: ".json" }) });
    if (read.state !== "ok") return;
    const row = read.value as SiteImportRecord | null;
    if (row === null) return;
    if (row.status === "needs-owner" && row.expiresAt < this.clock.nowMs()) {
      fs.rmSync(this.stagePath(row), { recursive: true, force: true });
      this.put({ row: { ...row, status: "failed", error: "Owner setup expired. Import the archive again." } });
    }
    // Reuse the existing history pass to remove link details from older finished records too.
    if ((row.status === "ready" || row.status === "failed") && "url" in row.source && row.source.url !== new URL(row.source.url).origin) this.put({ row });
  }
  /** Expired payloads are disposable; retain history with a named failure rather than dead setup.
   * Crash leftovers (a ZIP without metadata, a stage without a pending record) are removed too, so
   * they never pin the staging budget. Callers hold the import lock: an upload writes its ZIP
   * before its metadata, so an unlocked sweep could remove a payload that is still being saved.
   */
  expire(_required: Record<string, never>, _options: Record<string, never> = {}): void {
    this.expirePayloads({});
    this.expireHistory({});
  }
  expireHistory(_required: Record<string, never>, _options: Record<string, never> = {}): void {
    if (this.session.kind === "index") { this.session.expireHistory({}); return; }
    // Legacy history expiry stays separate until indexed mode.
    for (const filename of fs.readdirSync(this.directory)) {
      const importId = recordIdOf({ name: filename });
      // Unrecognized files are outside the import registry.
      if (importId === undefined) continue;
      // One entry that cannot be removed (permissions, a busy file) must not stop the rest of the sweep.
      try { this.expireOwnerSetup({ importId }); } catch (error) {
        this.log(`[site-backup] import registry could not clear expired entry ${filename}; the rest of the sweep continues`, error);
      }
    }
  }
}
