/**
 * @file Read-back for one chat attachment's bytes, authorized by the uploading principal.
 *
 * ## The capability this closes
 *
 * `@jini-ai/http-kit`'s attachment route pack mounts exactly two routes — `POST /api/attachments`
 * and `DELETE /api/attachments` (`attachmentUploadRoutes`, `attachmentCleanupRoutes`) — so bytes could be staged and
 * abandoned but never read again. The admin's attachment preview modal therefore worked only for
 * the current session, off a client-side `File` cache keyed by upload path
 * (`apps/admin/.../attachment-preview-cache.ts`): anything from an earlier turn, or anything at all
 * after a reload, could never be previewed. This module is the server half that makes those bytes
 * reachable; `@jini-ai/cms/admin-http/routes/assistant/get-chat-attachment` (bound in
 * `server/runtime/composition/modules/assistant-attachment-read.ts`) is the HTTP half.
 *
 * ## Why this reads the store's on-disk records instead of calling the store
 *
 * The `AttachmentStore` port has no non-mutating, owner-scoped byte read:
 * - `resolveForRun(ref, runId)` returns the real path, but **claims** the attachment for `runId` on
 *   the first call. A preview that claimed what it previewed would delete the attachment at that
 *   run's cleanup and hide it from `chat_list_pending_attachments` — a preview must not consume the
 *   thing it previews.
 * - `listPendingForOwner(ownerId)` is non-mutating and owner-scoped, but returns only summaries
 *   (`ref`/`name`/`kind`/`size`/`createdAt`) — never a path — and deliberately excludes anything
 *   already claimed, which is precisely the "attachment from an earlier turn" case this exists for.
 *
 * The remaining source of truth is the sidecar record `createDiskAttachmentStore` writes under
 * `<uploadDirectory>/.records/` when constructed with `retainAcrossRestarts` (Tovu opts in at
 * `agent-daemon-server.ts`, commit `72e1e529`). That is what this module reads.
 *
 * **This is a real coupling to another package's on-disk format, stated rather than hidden.**
 * `@jini-ai/http-kit` exports `parsePersistedAttachment` and `attachmentSidecarFileName` from
 * `attachments.ts`, but its `package.json` publishes only the `.` entry point and `index.ts` does
 * not re-export either, so neither is importable from here. The shape checks below are therefore a
 * deliberate re-implementation of `parsePersistedAttachment`'s two load-bearing guarantees (a
 * well-formed record, and a `filePath` contained by its own re-derived batch directory), and
 * `isUnchangedAttachment` — which IS on the package's public surface — is imported rather than
 * re-implemented so the integrity gate itself cannot drift.
 *
 * The clean fix is a `readForOwner(ref, ownerId)` method on `AttachmentStore` itself, which is a
 * change to `@jini-ai/http-kit`. Worth revisiting the moment that package is being edited anyway;
 * this module becomes a thin call into it and every check below is deleted.
 *
 * ## Authorization
 *
 * One rule: **the bytes are readable only by the principal whose id the store recorded as this
 * attachment's `ownerId`, and an attachment with no recorded `ownerId` is readable by nobody.**
 *
 * That id is not self-asserted. `forwardAttachmentUpload` (`composition/modules/assistant.ts`)
 * stamps `RUN_PRINCIPAL_HEADER` from `getAuthedPrincipal(res).id` — a server-verified session
 * principal, never anything the browser chose — and the daemon records it via
 * `AttachmentsHttpDeps.resolveOwnerId`. The read side compares against the same kind of value, in
 * the process that mints it.
 *
 * Deliberately NOT wider:
 * - not "any authenticated admin". `chat_list_pending_attachments` scopes by admin account rather
 *   than by conversation, an accepted widening recorded in
 *   `ADS-memory/reports/2026-09-06-tovu-f6-outstanding-worklist.md` §A.6. This route matches that
 *   scope and does not go past it — one principal, their own uploads.
 * - not gated by an additional `authorize()` permission either, and that is not an omission: the
 *   upload route itself requires only `requireAdminSession` (`modules/assistant.ts`), so a
 *   permission gate here would refuse a principal their own upload. Same reasoning the admin BYOK
 *   execution-credential routes give for having no `authorize()` call (`server/runtime/composition/modules/assistant-settings.ts`):
 *   the record is scoped to the principal, so there is no other principal's data to reach.
 *
 * Deliberately NOT narrower: an attachment already claimed by a run is still readable by its owner.
 * The feature is "preview an attachment from an earlier turn", and an attachment from an earlier
 * turn is by definition one a run already claimed. (The sidecar does not persist `claimedRunId` at
 * all — see `PersistedAttachmentRecord`'s own doc — so claim state is not observable here in any
 * case.)
 *
 * Every refusal reaches the caller as one indistinguishable outcome. The `ChatAttachmentRefusal`
 * contract values exist so tests can assert *which* check fired; the HTTP layer collapses all of them
 * into a single 404 with a single fixed message, so a caller cannot tell "no such attachment" from
 * "someone else's attachment" — the same non-disclosure `AttachmentStore.resolveForRun` documents
 * for its own rejections.
 *
 * ## Path safety
 *
 * A `ref` is caller-controlled and a sidecar's contents are only as trustworthy as write access to
 * the upload root, so neither is used as a path without being proved non-traversing first:
 * 1. `ref` must match {@link CHAT_ATTACHMENT_REF_PATTERN} — `attachment:` plus `[A-Za-z0-9-]` only.
 *    No `.`, `/`, `\`, or NUL can appear, so no `..` segment and no absolute path can be spelled.
 *    Express decodes `:ref` before a handler sees it, so a percent-encoded `%2F`/`%2E%2E` arrives
 *    decoded and is rejected here, not silently routed.
 * 2. the sidecar path is `resolve`d and its `dirname` must equal the sidecar directory exactly.
 * 3. the sidecar's own `batchId` must match {@link BATCH_ID_PATTERN}, the batch directory is
 *    re-derived from the *canonical upload root* (never read from the sidecar), and the record's
 *    `filePath` must have that directory as its exact parent — the same parent-equality containment
 *    `AttachmentStore.register` applies to an upload path. A forged sidecar can therefore only ever
 *    name a file directly inside the upload root.
 * 4. the file itself must pass `isUnchangedAttachment`: a regular non-symlink file whose `realpath`
 *    equals its own path (so neither it nor any parent directory became a symlink after
 *    registration) and whose `dev`/`ino`/`size` and recorded `mtimeMs`/`ctimeMs` still match.
 *    Legacy sidecars may omit timestamps, matching the store's compatibility contract.
 * 5. bytes come from one opened descriptor, with `O_NOFOLLOW` where supported. Its `fstat`
 *    identity must match the validated file before reading, so a later path swap cannot redirect
 *    the read. The descriptor is closed on success, refusal, or read failure.
 */
import { dirname, resolve } from "node:path";

import { isUnchangedAttachment } from "./attachment-records.js";
import { SIDECAR_DIRECTORY_NAME } from "./attachment-persistence.js";
import { BATCH_ID_PATTERN } from "./attachment-types.js";

import { CHAT_ATTACHMENT_REF_PATTERN, type ChatAttachmentReadResult, type ChatAttachmentRefusal } from '@jini-ai/core/contracts/headless/chat-attachment';

/** The sidecar fields this module reads, as `attachments.ts`'s `PersistedAttachmentRecord` writes
 *  them. `claimedRunId` and `batchDirectory` are deliberately not persisted by that writer — the
 *  latter is re-derived here for exactly the reason its doc gives. */
interface SidecarRecord {
  readonly id: string;
  readonly filePath: string;
  readonly size: number;
  readonly batchId: string;
  readonly dev: number;
  readonly ino: number;
  readonly mtimeMs?: number;
  readonly ctimeMs?: number;
  readonly ownerId?: string;
}

/** The attachment's metadata and bytes must come from the same opened descriptor. */
interface ChatAttachmentReadHandle {
  stat(): Promise<{ isFile(): boolean; dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>;
  readFile(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface AttachmentReadPorts {
  readSidecarText(required: { path: string }): Promise<string>;
  realpath(required: { path: string }): Promise<string>;
  lstat(required: { path: string }): Promise<{ isFile(): boolean; dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>;
  openNoFollow(required: { path: string }): Promise<ChatAttachmentReadHandle>;
}

/** Field types a sidecar must carry, checked as data so the validator stays one flat loop —
 *  mirrors `attachments.ts`'s `PERSISTED_FIELD_TYPES`. `name`/`kind`/`createdAt` are validated
 *  even though this module does not read them: a record missing them is not one that writer
 *  produced, and accepting it would mean trusting a differently-shaped file. */
const SIDECAR_FIELD_TYPES: Readonly<Record<string, string>> = {
  id: "string",
  filePath: "string",
  name: "string",
  kind: "string",
  size: "number",
  batchId: "string",
  dev: "number",
  ino: "number",
  createdAt: "number",
};

function refuse(refusal: ChatAttachmentRefusal): ChatAttachmentReadResult {
  return { ok: false, refusal };
}

/** Sidecar filename for a ref — a line-for-line mirror of `attachments.ts`'s
 *  `attachmentSidecarFileName`, which is exported from that module but not from the package's
 *  single `.` entry point (see this file's header). */
export function chatAttachmentSidecarFileName({ ref }: { ref: string }, _optional: Record<string, never> = {}): string {
  return `${ref.replaceAll(/[^a-zA-Z0-9-]/gu, "_")}.json`;
}

/** Validates required field types and optional legacy timestamps. Pure, O(1) time/space. */
function hasSidecarFieldTypes({ candidate }: { candidate: Record<string, unknown> }, _options = {}): boolean {
  return Object.entries(SIDECAR_FIELD_TYPES).every(([field, type]) => typeof candidate[field] === type)
    && ["mtimeMs", "ctimeMs"].every(field => candidate[field] === undefined || typeof candidate[field] === "number");
}

/** `true` when `raw` has the writer's required fields and optional legacy timestamps.
 * Pure, O(1) time/space; malformed fields return `false`.
 */
export function isChatAttachmentSidecarShape(required: { raw: unknown }, _optional: Record<string, never> = {}): required is { raw: SidecarRecord & Record<string, unknown> } {
  const { raw } = required;
  if (typeof raw !== "object" || raw === null) return false;
  const candidate = raw as Record<string, unknown>;
  if (!hasSidecarFieldTypes({ candidate })) return false;
  return candidate.ownerId === undefined || typeof candidate.ownerId === "string";
}

/**
 * The record's real file path, or `undefined` when the sidecar does not name a file directly inside
 * its own batch directory under `canonicalUploadDirectory` — step 3 of this file's path-safety doc.
 *
 * Pure and exported so hostile records can be exercised directly, without staging files on disk.
 */
export function resolveContainedAttachmentPath(
  { record, canonicalUploadDirectory }: { record: SidecarRecord; canonicalUploadDirectory: string },
  _optional: Record<string, never> = {}
): string | undefined {
  if (!BATCH_ID_PATTERN.test(record.batchId)) return undefined;
  const batchDirectory = resolve(canonicalUploadDirectory, record.batchId);
  const filePath = resolve(record.filePath);
  return dirname(filePath) === batchDirectory ? filePath : undefined;
}

/** Reads and validates one sidecar. `ref` is re-checked against the record's own `id` because the
 *  filename is a LOSSY reduction of an id (`:` becomes `_`), so a filename alone does not prove
 *  which id it describes. */
async function loadSidecar(
  { sidecarPath, canonicalUploadDirectory, ref, io }: { sidecarPath: string; canonicalUploadDirectory: string; ref: string; io: AttachmentReadPorts },
  _optional: Record<string, never> = {}
): Promise<{ record: SidecarRecord; filePath: string } | ChatAttachmentRefusal> {
  let raw: unknown;
  try {
    raw = JSON.parse(await io.readSidecarText({ path: sidecarPath }));
  } catch {
    // Absent, unreadable, truncated by a kill mid-write, or not JSON. Indistinguishable from a ref
    // this store never issued, and treated identically.
    return "no-record";
  }
  const candidate = { raw };
  if (!isChatAttachmentSidecarShape(candidate) || candidate.raw.id !== ref) return "record-unreadable";
  const filePath = resolveContainedAttachmentPath({ record: candidate.raw, canonicalUploadDirectory });
  if (filePath === undefined) return "record-outside-upload-root";
  return { record: candidate.raw, filePath };
}

/** Observes one path's identity, including timestamps for Jini's shared integrity gate.
 * Returns `undefined` when the file is gone or cannot be canonicalized; never writes.
 * @complexity O(1) metadata space and two filesystem calls for one path.
 */
async function observeAttachment(
  { filePath, io }: { filePath: string; io: AttachmentReadPorts }, _options = {},
): Promise<({ dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number } & { isRegularFile: boolean; canonicalPath: string }) | undefined> {
  try {
    const info = await io.lstat({ path: filePath });
    // `lstat`, never `stat`: a symlink must be SEEN as a symlink rather than followed. `isFile()`
    // is false for both a symlink and a directory, which is the whole check.
    //
    // Honest about its strength: with the canonical-path comparison below intact, no input
    // distinguishes `lstat` from `stat` here — a path that survives `realpath(filePath) ===
    // filePath` has no symlinked component left for `lstat` to catch. Swapping in `stat` was
    // mutated in and killed no test. It stays because it is the call `isUnchangedAttachment`'s
    // own contract names for `isRegularFile`, not because it is independently load-bearing.
    return {
      isRegularFile: info.isFile(),
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.ctimeMs,
      // `realpath` resolves every parent component too, so a batch directory swapped for a symlink
      // after registration produces a canonical path that no longer equals `filePath`.
      canonicalPath: await io.realpath({ path: filePath }),
    };
  } catch {
    return undefined;
  }
}

/** The upload root's canonical path, or `undefined` when there is none to search. */
async function canonicalUploadRoot({ uploadDirectory, io }: { uploadDirectory: string; io: AttachmentReadPorts }, _options = {}): Promise<string | undefined> {
  try {
    return await io.realpath({ path: uploadDirectory });
  } catch {
    // No upload directory at all — the daemon has never run here, or it was removed. Nothing to
    // find, reported as the ordinary not-found outcome rather than as a server fault.
    return undefined;
  }
}

/** Whether `ownerId` is the principal the store recorded. Pure: decided from the sidecar alone. */
function isRecordedOwner({ record, ownerId }: { record: SidecarRecord; ownerId: unknown }, _options = {}): boolean {
  // A caller with no usable principal id matches nothing. Guarded explicitly rather than left to
  // the comparison below, because that comparison has one input for which it says YES:
  // `undefined !== undefined` is false, so an ownerless record and a caller with no id would match
  // each other and hand out someone's upload. `ownerId` is typed `string` and comes from
  // `getAuthedPrincipal`, so this can only fire on a contract violation — but it is the one
  // contract violation that would grant access rather than deny it.
  if (typeof ownerId !== "string" || ownerId.length === 0) return false;
  // An attachment registered with NO `ownerId` is readable by nobody — never "unscoped", never a
  // wildcard match. Same rule `AttachmentStore.listPendingForOwner` documents for its own listing,
  // and it matters for the same reason: every attachment registered before ownership existed, and
  // every attachment from a host that wires no `resolveOwnerId`, carries no owner at all. The
  // single comparison below enforces that rule and ordinary ownership together — `undefined` never
  // equals a non-empty id — so a separate `=== undefined` guard here would be dead code.
  return record.ownerId === ownerId;
}

/** Refuse non-finite, negative or oversized metadata before reading attachment bytes.
 * The finite check remains explicit even if a caller supplies an infinite preview cap. */
function exceedsPreviewCap({ size, maxBytes }: { size: number; maxBytes?: number }, _options = {}): boolean {
  return maxBytes !== undefined && (!Number.isFinite(size) || size < 0 || size > maxBytes);
}

/** Validates the path, then checks and reads one descriptor. Open/identity failures refuse;
 * stat/read/close faults propagate. The handle is closed even when reading fails.
 * Both observations carry timestamps so Jini can reject same-size rewrites, including
 * changes between path validation and open. Legacy records still get the descriptor check.
 * @complexity O(n) time/space for n attachment bytes, bounded by upload/preview limits.
 */
async function readUnchangedAttachment(
  { loaded, io }: { loaded: { record: SidecarRecord; filePath: string }; io: AttachmentReadPorts },
  _optional = {},
): Promise<ChatAttachmentReadResult> {
  const observed = await observeAttachment({ filePath: loaded.filePath, io });
  if (observed === undefined) return refuse("integrity");
  if (!isUnchangedAttachment({ recorded: { ...loaded.record, filePath: loaded.filePath }, observed })) return refuse("integrity");

  let handle: ChatAttachmentReadHandle;
  try {
    handle = await io.openNoFollow({ path: loaded.filePath });
  } catch {
    return refuse("integrity");
  }
  try {
    const info = await handle.stat();
    const opened = { isRegularFile: info.isFile(), dev: info.dev, ino: info.ino, size: info.size,
      mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, canonicalPath: observed.canonicalPath };
    // A pathname can change after validation; compare the opened object to that validated identity
    // through the shared Jini gate, then read only this handle, never the pathname again.
    if (!isUnchangedAttachment({
      recorded: { ...observed, filePath: loaded.filePath },
      observed: opened,
    })) return refuse("integrity");
    const bytes = await handle.readFile();
    return bytes.byteLength === observed.size ? { ok: true, bytes } : refuse("integrity");
  } finally {
    await handle.close();
  }
}

/**
 * The bytes of the chat attachment `ref` names, if and only if `ownerId` is the principal the store
 * recorded for it and the file retains its registered identity, size and recorded timestamps.
 *
 * Non-mutating: nothing here claims, deletes, or otherwise changes store state, so previewing an
 * attachment cannot consume it (see this file's header for why that rules out `resolveForRun`).
 * `deps.openFile` defaults to Node's open; metadata and bytes are read through its returned handle.
 * Open/identity failures refuse; descriptor stat/read/close faults propagate to the caller.
 *
 * @complexity O(1) plus one sidecar read, one `lstat`/`realpath` pair, and one bounded descriptor read
 * (bounded by the attachment's own upload-time byte cap, `AttachmentsHttpDeps.maxAttachmentBytes`).
 */
export async function readChatAttachmentForOwner(
  { uploadDirectory, ref, ownerId, io }: { readonly uploadDirectory: string; readonly ref: string; readonly ownerId: string; readonly io: AttachmentReadPorts },
  { maxBytes }: { readonly maxBytes?: number } = {}
): Promise<ChatAttachmentReadResult> {
  if (!CHAT_ATTACHMENT_REF_PATTERN.test(ref)) return refuse("malformed-ref");

  const canonicalUploadDirectory = await canonicalUploadRoot({ uploadDirectory, io });
  if (canonicalUploadDirectory === undefined) return refuse("no-record");

  const sidecarDirectory = resolve(canonicalUploadDirectory, SIDECAR_DIRECTORY_NAME);
  const sidecarPath = resolve(sidecarDirectory, chatAttachmentSidecarFileName({ ref: ref }));
  // Defense in depth behind the ref pattern: even if that pattern were ever loosened, a path whose
  // parent is not exactly the sidecar directory never gets read.
  if (dirname(sidecarPath) !== sidecarDirectory) return refuse("malformed-ref");

  const loaded = await loadSidecar({ sidecarPath, canonicalUploadDirectory, ref, io });
  if (typeof loaded === "string") return refuse(loaded);
  // Ownership and size policy live in helpers so the read orchestration stays below its
  // complexity ceiling; these checks still precede every attachment-file operation.
  // Ownership is decided BEFORE the attachment file is touched, so a caller who is not the owner
  // never causes a read of those bytes at all.
  if (!isRecordedOwner({ record: loaded.record, ownerId: ownerId })) return refuse("not-owner");

  // Video preview has a tighter cap than upload. Refuse before allocating/reading its payload;
  // the identity gate below also proves that the current file still has this recorded size.
  if (exceedsPreviewCap({ size: loaded.record.size, ...(maxBytes === undefined ? {} : { maxBytes }) })) return refuse("too-large");

  return readUnchangedAttachment({ loaded, io });
}
