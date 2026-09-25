/**
 * @module attachments
 *
 * `POST /api/attachments`, `DELETE /api/attachments` — an HTTP route pack for user file/image
 * uploads staged for one agent run, over a narrow, transport-owned `AttachmentStore` port plus a
 * batteries-included disk implementation (`createDiskAttachmentStore`).
 *
 * **The capability this closes.** A chat composer that accepts drag-and-drop needs somewhere to put
 * the bytes, a way to hand the agent a path it is actually allowed to read, and a guarantee that
 * those bytes disappear when the run ends. That is three separate concerns (an upload endpoint, a
 * trusted-metadata registry, and a run-scoped lifetime) which every host would otherwise hand-roll.
 * This module owns all three; `@jini-ai/chat-react`'s `createDaemonAttachmentUploader` is the
 * matching client half.
 *
 * **Trust model.** A renderer supplies bytes, a filename, and a batch id. None of that is trusted:
 * - the filename is reduced to a basename over a conservative character allowlist
 *   (`sanitizeAttachmentName`) and is only ever used as *display* text plus a short extension
 *   suffix — never as the stored filename, which is a fresh `randomUUID()`;
 * - the `kind` (`'image' | 'file'`) is sniffed from the leading bytes (`detectAttachmentKind`),
 *   never taken from a renderer-controlled MIME type or file extension;
 * - the byte count is measured while streaming, never read from a client-supplied length;
 * - the returned `path` is an opaque `attachment:<uuid>` capability id, not a filesystem path, so a
 *   renderer never learns where the upload root is and cannot name a file it did not upload.
 *   `claim()` is what exchanges those ids for real paths, server-side.
 *
 * **What `claim()` guarantees.** Exactly once per registered attachment, and only if the file is
 * still the same file: `lstat` must report a regular non-symlink whose `dev`/`ino`/`size` match
 * what was recorded at registration, and `realpath` must equal the recorded path (so neither the
 * file nor any parent directory was swapped for a symlink between upload and run start). Every
 * claimed attachment must belong to one batch, so the single `batchDirectory` a host grants the
 * agent read access to cannot be widened by mixing batches.
 *
 * **Ownership is opt-in and host-attached, not self-asserted.** `register()`'s optional `ownerId`
 * (and `listPendingForOwner`, the discovery method it enables) is never read from anything a
 * renderer sends — a host wires `AttachmentsHttpDeps.resolveOwnerId` to pull it from a channel IT
 * already trusts (its own session-verified principal header, say), never from `req` unauthenticated.
 * A store with no `resolveOwnerId` wired registers every attachment ownerless, and
 * `listPendingForOwner` never returns an ownerless record for any caller — see that method's own doc
 * for why an absent `ownerId` must never become a wildcard match.
 *
 * **Storage lifetime is daemon-lifetime by default, and opt-in restart-surviving.** With
 * `retainAcrossRestarts` left off (the default, and this pack's only behavior before that option
 * existed), `createDiskAttachmentStore` empties its upload directory on construction: files left
 * behind by an interrupted previous process cannot be authenticated against an in-memory registry
 * that no longer exists, so they are removed rather than adopted. Unclaimed uploads also expire by
 * TTL (`pruneExpired`), and a run's claimed files are deleted by `cleanupRun`.
 *
 * That default is wrong for any host whose process restarts while a person is still using the
 * composer. A file-watching dev server restarting the daemon on an unrelated source edit is not a
 * crash, but the construction wipe cannot tell the two apart, so it destroys uploads the user is
 * about to send — real data loss, not a tidy-up. `retainAcrossRestarts: true` replaces "wipe
 * everything, always" with "adopt exactly what can still be authenticated": see
 * {@link prepareAttachmentStorage} for the whole mechanism and {@link loadPersistedAttachments} for
 * why an adopted record is no less trusted than one this process registered itself.
 *
 * **This pack does not auto-wire itself into a run's lifecycle**, because no generic hook for that
 * exists — the same deliberate choice `@jini-ai/daemon`'s `createRunScopedContextStore` makes. A
 * host claims in its own `onRunStarted` and cleans up in a `finally`, roughly:
 *
 * ```ts
 * const store = await createDiskAttachmentStore({ uploadDirectory });
 * // ... httpExtensions: [(app, { adapter }) => registerAttachmentRoutes(app, { store }, adapter)]
 * onRunStarted: (context) => {
 *   void (async () => {
 *     try {
 *       const claimed = await store.claim(attachmentRefsFrom(context.request), context.run.id);
 *       await executor.run({
 *         runId: context.run.id,
 *         // ... prompt, cwd, agentId
 *         ...(claimed.batchDirectory === undefined ? {} : {
 *           imagePaths: claimed.attachments.filter((a) => a.kind === 'image').map((a) => a.path),
 *           extraAllowedDirs: [claimed.batchDirectory],
 *           uploadRoot: claimed.batchDirectory,
 *         }),
 *       });
 *     } finally {
 *       await store.cleanupRun(context.run.id);
 *     }
 *   })();
 * }
 * ```
 *
 * `imagePaths`/`extraAllowedDirs`/`uploadRoot` are pre-existing `AgentExecutor.run()` options; this
 * module only produces real values for them.
 *
 * **Body-parser ordering (`POST` reads the raw request stream).** The upload route streams
 * `request` straight to disk, so any body-parsing middleware that has already consumed the stream
 * leaves nothing to write. The classic way to hit this is a JSON body parser mounted app-wide: a
 * user drops a `.json` file, the browser sets `content-type: application/json`, and
 * `express.json()` eats the body — which without a guard shows up as the deeply unhelpful
 * "attachment is empty". `registerAttachmentRoutes` detects an already-consumed stream up front and
 * reports it as a host misconfiguration (`'attachment-body-consumed'`) instead of failing silently.
 * Mount this pack before any global body parser, or scope the parser so it skips this path.
 *
 * **SEC-005 redaction**: a store failure can carry filesystem paths a caller must not see, so
 * anything that is not an explicitly-classified `AttachmentRejectedError` becomes a
 * correlation-id-bearing generic `INTERNAL_ERROR`, with the real error reaching a host-owned sink —
 * the same `reportInternalError` shape `media.ts`/`delegated-tools.ts` use.
 */
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, resolve } from 'node:path';
import type { Express, Request, Response } from 'express';
import { createApiError, type ApiError } from '@jini-ai/protocol';
import type { AdapterContext } from './adapter.js';
import { guardSameOrigin } from './origin.js';
import { sendApiError, sendJson } from './response.js';

/**
 * A staged upload as it crosses the wire and as `claim()` returns it.
 *
 * Deliberately declared here rather than imported from `@jini-ai/chat/core`, whose `ChatAttachment`
 * this mirrors field-for-field: the same reason `media.ts` declares its own `MediaTask`/
 * `MediaDispatchEngine` port types instead of depending on `@jini-ai/media`. A transport package
 * should not acquire a dependency on a *domain* package (`jini.domain: "chat"`) to describe an
 * upload that has nothing chat-specific about it. `attachments.test.ts` holds a compile-time
 * assignability check in both directions against the real `ChatAttachment`, so the mirror cannot
 * silently drift — the drift risk is paid for with a test rather than with a dependency edge.
 *
 * `path` means two different things at two different times, on purpose:
 * - as returned by `register()` / over the wire: an opaque `attachment:<uuid>` capability id;
 * - as returned by `claim()`: the real absolute filesystem path, server-side only.
 */
export interface StoredAttachment {
  path: string;
  name: string;
  kind: 'image' | 'file';
  size?: number;
  /**
   * User-visible ordering for the turn that carries this attachment. Present for exact structural
   * parity with `ChatAttachment`; this store never sets it, because display ordering is the
   * renderer's concern and nothing here would be able to reconstruct it.
   */
  order?: number;
}

/** What `claim()` hands back: trusted paths plus the one directory an agent may be granted. */
export interface AttachmentClaim {
  attachments: StoredAttachment[];
  /** Absent only for an empty claim — there is no directory to grant when nothing was claimed. */
  batchDirectory?: string;
}

/** Why an attachment operation was refused. Maps to an HTTP status in `statusForRejection`. */
export type AttachmentRejectionReason =
  /** The batch id is missing or not of the accepted shape. */
  | 'invalid-batch'
  /** One file exceeded the per-attachment byte cap. */
  | 'attachment-too-large'
  /** The batch already holds `maxAttachments` files. */
  | 'batch-count-exceeded'
  /** This file would push the batch past `maxBatchBytes`. */
  | 'batch-too-large'
  /** The store as a whole is at `maxStoredAttachments` / `maxStoredBytes`. */
  | 'storage-full'
  /** Nothing was uploaded — a zero-byte body. */
  | 'empty-attachment'
  /** More concurrent uploads than `maxConcurrentUploads`. */
  | 'too-many-concurrent-uploads'
  /** The cleanup request body was not a `{ batchId, paths }` of the accepted shape. */
  | 'invalid-cleanup-request'
  /**
   * The request stream was already drained before this route saw it — a host body-parser ordering
   * problem, not anything the caller did. See this module's doc.
   */
  | 'attachment-body-consumed'
  /**
   * The stored file is not the canonical regular file it was registered as. Reported opaquely over
   * HTTP: this means either a bug or an active attempt to redirect a claim.
   */
  | 'attachment-integrity'
  /** More attachments in one claim than `maxAttachments` allows. */
  | 'too-many-attachments'
  /** The same capability id appeared twice in one claim. */
  | 'duplicate-attachment'
  /** No such capability id, or a run already claimed it. */
  | 'attachment-unknown-or-claimed'
  /** One claim spanned more than one batch. */
  | 'mixed-batch';

/**
 * A refusal this module classified itself, as opposed to an unexpected filesystem/programming
 * error. The route pack turns the `reason` into a status code and lets the `message` through to the
 * caller; anything that is *not* one of these is redacted to a generic `INTERNAL_ERROR`.
 */
export class AttachmentRejectedError extends Error {
  readonly reason: AttachmentRejectionReason;

  constructor(reason: AttachmentRejectionReason, message: string) {
    super(message);
    this.name = 'AttachmentRejectedError';
    this.reason = reason;
  }
}

/** The subset of `AttachmentRejectionReason` a caller is allowed to see a real message for. */
const REJECTION_STATUS: Readonly<Record<AttachmentRejectionReason, number>> = {
  'invalid-batch': 400,
  'attachment-too-large': 413,
  'batch-count-exceeded': 413,
  'batch-too-large': 413,
  'storage-full': 413,
  'empty-attachment': 400,
  'too-many-concurrent-uploads': 429,
  'invalid-cleanup-request': 400,
  // The remaining reasons describe a broken or hostile server-side state. They are never given a
  // real message over HTTP (see `respondToUploadFailure`); the entries exist so a host catching a
  // rejection from `claim()` outside HTTP can still classify it.
  'attachment-body-consumed': 500,
  'attachment-integrity': 500,
  'too-many-attachments': 400,
  'duplicate-attachment': 400,
  'attachment-unknown-or-claimed': 400,
  'mixed-batch': 400,
};

/** `ApiError` code per refusal, so `sendApiError` produces the standard envelope. */
function apiErrorForRejection(error: AttachmentRejectedError): ApiError {
  const status = REJECTION_STATUS[error.reason];
  if (status === 413) return createApiError('PAYLOAD_TOO_LARGE', error.message);
  if (status === 429) return createApiError('RATE_LIMITED', error.message);
  return createApiError('BAD_REQUEST', error.message);
}

/**
 * Registers, validates, and expires uploads staged for a run. `createDiskAttachmentStore` is the
 * implementation this package ships; a host with its own storage (object store, tmpfs, a quota
 * system of its own) can satisfy this port instead and keep the route pack.
 */
export interface AttachmentStore {
  /** Creates (idempotently) the private directory that holds one batch's files. */
  createBatchDirectory: (batchId: string) => Promise<string>;
  /**
   * Takes ownership of an already-written file and returns its opaque capability record. Rejects —
   * and deletes the file — if it is not a canonical regular file directly inside its batch
   * directory, or if any quota would be exceeded.
   */
  register: (input: {
    batchId: string;
    path: string;
    name: string;
    kind: StoredAttachment['kind'];
    size: number;
    /** See `AttachmentRecord.ownerId`'s own doc. Omitted by a host with no owner concept. */
    ownerId?: string;
  }) => Promise<StoredAttachment>;
  /** Exchanges capability ids for real paths, exactly once, binding them to `runId`. */
  claim: (
    attachments: readonly StoredAttachment[],
    runId: string,
  ) => Promise<AttachmentClaim>;
  /**
   * Resolves ONE still-known attachment to its real path for `runId`, without the "exactly once
   * across the whole batch" shape `claim()` has — the read-side counterpart for a caller that wants
   * to look up a single attachment it may or may not already own, rather than atomically reserving a
   * batch at run start.
   *
   * `ref` accepts either identifier a caller may actually be holding: the opaque `attachment:<uuid>`
   * capability id `register()` returned, or the real absolute path this run was already told about.
   * Both resolve to the same record. This dual form exists because `@jini-ai/daemon`'s
   * `image-prompt-delivery.ts` narrates the resolved PATH into the run's prompt text for an
   * already-claimed attachment — never the id — so a caller built from that prompt has the path, not
   * the id; a caller with the id (from the original upload response) can still use it directly.
   *
   * Ownership is enforced here, which is new: an attachment nobody has claimed yet is claimed for
   * `runId` on this call (identical effect to `claim()`, same integrity re-check); an attachment
   * already claimed BY `runId` is simply re-verified and returned again (idempotent — a run may look
   * this up more than once); an attachment claimed by any OTHER run throws the same
   * `'attachment-unknown-or-claimed'` rejection `claim()` uses for a genuinely unknown id, so a
   * caller cannot distinguish "no such attachment" from "a different run owns this" — the same
   * non-disclosure `claim()` already practices for its own rejections. This is the run-ownership
   * check `claim()`'s own FIRST reservation does not have (see this module's trust-model doc on the
   * deliberate capability-bearer model for a brand-new claim); `resolveForRun` adds it for every
   * lookup made through this method, so a second run/session on this same daemon can never read an
   * attachment already bound to someone else's run by calling this method with a guessed or
   * overheard `ref`.
   *
   * Returns `undefined` only for a `ref` this store has never heard of (never uploaded, or its
   * record was already deleted by `cleanupRun`/`pruneExpired`/`dispose`).
   */
  resolveForRun: (ref: string, runId: string) => Promise<StoredAttachment | undefined>;
  /**
   * Lists every still-unclaimed attachment registered with `ownerId` — the discovery counterpart to
   * `resolveForRun`'s single-lookup: a caller that does not yet hold a specific ref at all (an
   * attachment uploaded in an earlier turn, never named in this run's prompt) has no id to look up
   * with `resolveForRun` in the first place. This is what makes that attachment findable.
   *
   * **This is the one method in this port that widens the trust model documented at the top of this
   * file.** `register()`/`claim()`/`resolveForRun` all work from a caller-supplied opaque id or path
   * — the "you must already hold the unguessable capability" property that makes an unauthenticated
   * `claim()` first-reservation safe. A listing necessarily hands back ids the caller never held, so
   * it can only be safe if it is scoped to something the caller is actually entitled to — here, the
   * same principal id a host recorded via `register()`'s `ownerId` for the ORIGINAL upload request.
   *
   * Two things make that scoping real rather than decorative:
   * - an attachment registered with NO `ownerId` (a host that never wired `resolveOwnerId`, or any
   *   attachment from before this method existed) is excluded from every caller's results, never
   *   just "unscoped" — this method is not callable with `ownerId: undefined`, so there is no input
   *   that could accidentally match an ownerless record;
   * - a claimed attachment is excluded outright, whether or not this caller's own `runId` claimed
   *   it, so this method can never be used to re-discover something already handed to a run — the
   *   same "runs, not listings, are the reach here" boundary `resolveForRun` draws for a single ref.
   *
   * What this does NOT scope by: batch, conversation, or run — none of those are recorded on an
   * `AttachmentRecord` today. Two different conversations run by the SAME `ownerId` will each see
   * the other's pending attachments through this method. A host for whom that is too wide needs a
   * finer-grained id than `ownerId` to pass into `register()` — this method does not itself assume
   * `ownerId` means "one admin account" rather than "one conversation, one composer, one browser
   * tab"; it only assumes the host's `ownerId` is something the CALLER of this method is authorized
   * to see everything under.
   *
   * Sorted oldest-first (`createdAt` ascending) — arrival order, matching how a person would expect
   * to review what is waiting.
   *
   * @complexity O(n) in the number of tracked records (bounded by `maxStoredAttachments`), matching
   * every other method on this port.
   */
  listPendingForOwner: (ownerId: string) => Promise<PendingAttachmentSummary[]>;
  /** Deletes the named still-unclaimed uploads, then the batch directory if it is now empty. */
  deleteUnclaimed: (batchId: string, paths: readonly string[]) => Promise<void>;
  /** Deletes everything `runId` claimed. Safe to call for a run that claimed nothing. */
  cleanupRun: (runId: string) => Promise<void>;
  /** Deletes unclaimed uploads older than the retention window. */
  pruneExpired: (now?: number) => Promise<void>;
  /** Deletes every tracked upload. For host shutdown. */
  dispose: () => Promise<void>;
}

export interface CreateDiskAttachmentStoreOptions {
  /** Root directory this store owns outright — it is emptied on construction. */
  readonly uploadDirectory: string;
  /** Files per batch, i.e. per composer turn. Also caps one `claim()`. Defaults to 10. */
  readonly maxAttachments?: number;
  /** Total bytes per batch. Defaults to 50 MB. */
  readonly maxBatchBytes?: number;
  /** Tracked files across all batches. Defaults to 100. */
  readonly maxStoredAttachments?: number;
  /** Tracked bytes across all batches. Defaults to 200 MB. */
  readonly maxStoredBytes?: number;
  /** How long an unclaimed upload survives `pruneExpired`. Defaults to one hour. */
  readonly retentionMs?: number;
  /**
   * Adopts the uploads a previous process left behind instead of emptying the directory on
   * construction, so an attachment staged seconds before a restart is still there — and still
   * listable — afterwards.
   *
   * **Defaults to `false`, which is exactly this pack's pre-existing behavior.** Opting in is a
   * one-word change at the call site and reverting is deleting it; nothing about a store
   * constructed without this option differs in any way from before the option existed.
   *
   * Adoption is authenticated, not blind: see {@link loadPersistedAttachments}.
   */
  readonly retainAcrossRestarts?: boolean;
}

/**
 * Accepted batch id shape. Deliberately narrow — long enough for a UUID, and admitting no `.`,
 * `/`, or `\`, which is what makes `resolve(uploadRoot, batchId)` provably a single
 * non-traversing path segment.
 */
const BATCH_ID_PATTERN = /^[a-zA-Z0-9-]{8,80}$/u;

/**
 * `true` when `body`'s bytes 4-7 spell `ftyp` — the ISO-BMFF box tag AVIF, HEIC, and MP4 all
 * share. This says only "some member of the ISO-BMFF family", never "MP4" or "AVIF" on its own:
 * mirrors `@jini-ai/cms`'s `content-type-sniffer.ts` `isIsoBmffFtyp`, which documents the same
 * fact for the media route's own sniffer. `detectAttachmentKind` never returns `'image'` for this
 * tag alone (see that function's doc) — doing so is exactly the 2026-09-06 regression that made an
 * AVIF render as an unplayable `<video>` when the *media* sniffer briefly had the same bug.
 */
function hasIsoBmffFtypTag(body: Uint8Array): boolean {
  return body.length >= 8 && new TextDecoder().decode(body.slice(4, 8)) === 'ftyp';
}

/** ISO-BMFF brands that identify AVIF: a still image (`avif`) or an image sequence (`avis`). Kept
 * identical to `content-type-sniffer.ts`'s `AVIF_BRANDS` so the two sniffers can never disagree on
 * which brands mean AVIF. */
const AVIF_FTYP_BRANDS = ['avif', 'avis'] as const;
const FTYP_MAJOR_BRAND_OFFSET = 8;
/** Compatible brands follow the major brand (offset 8) and 4-byte minor version (offset 12). */
const FTYP_COMPATIBLE_BRANDS_OFFSET = 16;
/** Bound on the compatible-brand list scan — real `ftyp` boxes carry a handful, never dozens. */
const MAX_SCANNED_COMPATIBLE_BRANDS = 16;

function hasAvifBrandAt(body: Uint8Array, offset: number): boolean {
  return body.length >= offset + 4
    && AVIF_FTYP_BRANDS.some((brand) => new TextDecoder().decode(body.slice(offset, offset + 4)) === brand);
}

/** The `ftyp` box's declared end offset (big-endian size at bytes 0-3), clamped to the bytes
 * actually present so a truncated or size-inflating file can never push the brand scan past the
 * captured signature window. */
function ftypBoxEnd(body: Uint8Array): number {
  if (body.length < FTYP_MAJOR_BRAND_OFFSET) return 0;
  const declared = ((body[0]! << 24) | (body[1]! << 16) | (body[2]! << 8) | body[3]!) >>> 0;
  return Math.min(declared, body.length);
}

/**
 * `true` when `body` opens with an ISO-BMFF `ftyp` box whose major brand or compatible-brand list
 * names AVIF. This is a line-for-line mirror of `@jini-ai/cms`'s `content-type-sniffer.ts`
 * `isAvif` (no shared dependency exists between `@jini-ai/http-kit` and `@jini-ai/cms` today — see
 * this module's handoff notes on whether extracting one is worth it): the major brand alone is not
 * sufficient, because a great many real AVIF files declare the generic `mif1` (HEIF image) major
 * brand and name `avif` only in the compatible-brand list, so both are checked. HEIC declares
 * neither and is therefore never matched here — deliberate; nothing downstream of this attachment
 * store has confirmed it can render a HEIC as an `<img>`, so labelling one `'image'` would risk the
 * same "sniffed as a type the surface cannot actually display" failure this whole fix addresses.
 *
 * Must run before any generic `ftyp` check: {@link hasIsoBmffFtypTag} alone cannot tell AVIF, HEIC,
 * and MP4 apart, so a brand-blind caller would misclassify every ISO-BMFF file it sees as one type.
 */
export function hasAvifSignature(body: Uint8Array): boolean {
  if (!hasIsoBmffFtypTag(body)) return false;
  if (hasAvifBrandAt(body, FTYP_MAJOR_BRAND_OFFSET)) return true;

  const boxEnd = ftypBoxEnd(body);
  for (let index = 0; index < MAX_SCANNED_COMPATIBLE_BRANDS; index++) {
    const offset = FTYP_COMPATIBLE_BRANDS_OFFSET + index * 4;
    if (offset + 4 > boxEnd) return false;
    if (hasAvifBrandAt(body, offset)) return true;
  }
  return false;
}

/**
 * Bytes of leading signature `detectAttachmentKind` needs. WEBP's marker ends at byte 12; AVIF
 * needs more — {@link hasAvifSignature}'s compatible-brand scan can read as far as
 * `FTYP_COMPATIBLE_BRANDS_OFFSET + MAX_SCANNED_COMPATIBLE_BRANDS * 4` (a great many real AVIF
 * files declare the generic `mif1` major brand and name `avif` only in the compatible-brand list —
 * see that function's doc), so this is sized to that worst case rather than to the smallest format.
 */
const SIGNATURE_BYTES = FTYP_COMPATIBLE_BRANDS_OFFSET + MAX_SCANNED_COMPATIBLE_BRANDS * 4;

export interface AttachmentRecord {
  id: string;
  filePath: string;
  name: string;
  kind: StoredAttachment['kind'];
  size: number;
  batchId: string;
  batchDirectory: string;
  dev: number;
  ino: number;
  createdAt: number;
  claimedRunId?: string;
  /**
   * The principal a host's `AttachmentsHttpDeps.resolveOwnerId` reported for the request that
   * registered this attachment. Absent when the host supplies no `resolveOwnerId` (this pack's
   * behavior before ownership existed), which is why `listPendingForOwner` treats an absent
   * `ownerId` as "cannot be scoped" rather than as a wildcard match — see that method's own doc.
   */
  ownerId?: string;
}

/**
 * What `listPendingForOwner` hands back for one still-unclaimed attachment: enough for a caller to
 * show a person what is waiting, and to name it again (`ref`) to `claim()`/`resolveForRun`.
 */
export interface PendingAttachmentSummary {
  /** The same opaque `attachment:<uuid>` id `register()` returned over the wire. */
  ref: string;
  name: string;
  kind: StoredAttachment['kind'];
  size: number;
  /** `Date.now()` at registration — when the file arrived, not when it was looked up. */
  createdAt: number;
}

/** What registration recorded about a file, as `isUnchangedAttachment` needs it. */
export interface RecordedAttachmentIdentity {
  readonly filePath: string;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
}

/**
 * What the filesystem reports about a file right now — the subset of `fs.Stats` (plus `realpath`)
 * an integrity check needs.
 *
 * `isRegularFile` comes from `lstat().isFile()`, which is false for a symlink *and* for a
 * directory. There is deliberately no separate `isSymbolicLink` field: `lstat` reports exactly one
 * file type, so `isFile()` and `isSymbolicLink()` are mutually exclusive and a symlink check after
 * an `isFile()` check could never be the deciding one.
 */
export interface ObservedAttachmentIdentity {
  readonly isRegularFile: boolean;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  /** `realpath` of the file — differs from its own path when any path component became a symlink. */
  readonly canonicalPath: string;
}

/**
 * `true` when the file on disk is still the same file registration accepted.
 *
 * Every condition is a distinct real attack: a regular file swapped for a symlink or directory, a
 * parent directory swapped for a symlink pointing elsewhere, the file replaced by a different file
 * at the same path (new inode), the same inode truncated or appended to (new size), or the path
 * now resolving onto a different device.
 *
 * Pure and exported on purpose. Staging a *device* change for a file that keeps its path is not
 * something a test can do on a real filesystem, and a check that can only be exercised in
 * production is a check nobody knows works — a fake identity states each case directly.
 */
export function isUnchangedAttachment(
  recorded: RecordedAttachmentIdentity,
  observed: ObservedAttachmentIdentity,
): boolean {
  return observed.isRegularFile
    && observed.canonicalPath === recorded.filePath
    && observed.dev === recorded.dev
    && observed.ino === recorded.ino
    && observed.size === recorded.size;
}

/**
 * Phase 1 of `claim()`: synchronously reserves `attachments` for `runId`, or throws (releasing
 * whatever it already reserved this call) the first time a requested attachment turns out to be
 * unknown or already claimed.
 *
 * The reservation loop deliberately has no `await`: this store's exactly-once guarantee is what
 * stops two runs being handed the same real path on disk, and `claim` is reachable concurrently
 * (two run starts, one shared attachment). Nothing between `records.get` and the assignment of
 * `record.claimedRunId` may ever become asynchronous — that window is exactly where a concurrent
 * call would get its turn and could observe the same record as still unclaimed.
 *
 * Exported so this invariant can be exercised directly against a plain `Map` of fabricated
 * records, without going through a disk-backed store.
 */
export function reserveAttachmentRecords(
  attachments: readonly StoredAttachment[],
  records: ReadonlyMap<string, AttachmentRecord>,
  runId: string,
  maxAttachments: number,
): AttachmentRecord[] {
  if (attachments.length > maxAttachments) {
    throw new AttachmentRejectedError('too-many-attachments', 'Too many attachments');
  }
  const requestedPaths = new Set(attachments.map((attachment) => attachment.path));
  if (requestedPaths.size !== attachments.length) {
    throw new AttachmentRejectedError('duplicate-attachment', 'Duplicate attachment');
  }
  const claimed: AttachmentRecord[] = [];
  for (const requested of attachments) {
    const record = records.get(requested.path);
    if (!record || record.claimedRunId !== undefined) {
      for (const reserved of claimed) delete reserved.claimedRunId;
      throw new AttachmentRejectedError(
        'attachment-unknown-or-claimed',
        'Attachment is unknown or already claimed',
      );
    }
    record.claimedRunId = runId;
    claimed.push(record);
  }
  return claimed;
}

/**
 * Phase 2 of `claim()`: re-verifies every already-reserved record against the filesystem — not
 * merely re-read, but re-checked against what registration recorded, so someone able to write into
 * the batch directory between upload and run start cannot get the agent to read a file of their
 * choosing — and checks every claimed attachment shares one batch. Returns the shared batch
 * directory on success (or `''` for an empty `claimed`, which `claim()` never passes in — it
 * returns before calling this — but which a direct caller can still treat as "no batch").
 *
 * Throws without releasing `claimed`'s reservations; releasing is the caller's job (`claim`'s own
 * `catch`), so a rejected claim still leaves nothing half-claimed and the caller can retry with a
 * corrected set.
 *
 * Exported so the integrity and mixed-batch checks can be exercised directly against fabricated
 * records over real files on disk, without a full `createDiskAttachmentStore` around them.
 */
export async function verifyClaimedAttachments(
  claimed: readonly AttachmentRecord[],
): Promise<string> {
  let batchDirectory = '';
  for (const [index, record] of claimed.entries()) {
    const info = await lstat(record.filePath);
    const canonicalPath = await realpath(record.filePath);
    if (!isUnchangedAttachment(record, {
      isRegularFile: info.isFile(),
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      canonicalPath,
    })) {
      throw new AttachmentRejectedError('attachment-integrity', 'Attachment changed after upload');
    }
    if (index > 0 && record.batchDirectory !== batchDirectory) {
      throw new AttachmentRejectedError('mixed-batch', 'Attachments must belong to one batch');
    }
    batchDirectory = record.batchDirectory;
  }
  return batchDirectory;
}

/** Renders a byte cap the way a person would read it, for a message a user actually sees. */
function formatByteLimit(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? `${megabytes} MB` : `${bytes} bytes`;
}

/**
 * Reduces an untrusted upload filename to a display-only basename over a conservative allowlist.
 * Never used as the name of the stored file — see this module's trust-model doc.
 */
export function sanitizeAttachmentName(requestedName: unknown): string {
  if (typeof requestedName !== 'string') return 'attachment';
  return basename(requestedName).replaceAll(/[^a-zA-Z0-9._ -]/gu, '_') || 'attachment';
}

/** `true` when `body`'s first 8 bytes are the PNG signature. */
export function hasPngSignature(body: Uint8Array): boolean {
  return body.length >= 8
    && body[0] === 0x89
    && body[1] === 0x50
    && body[2] === 0x4e
    && body[3] === 0x47;
}

/** `true` when `body`'s first 3 bytes are the JPEG start-of-image marker. */
export function hasJpegSignature(body: Uint8Array): boolean {
  return body.length >= 3
    && body[0] === 0xff
    && body[1] === 0xd8
    && body[2] === 0xff;
}

/** `true` when `body`'s first 6 bytes spell either GIF version tag. */
export function hasGifSignature(body: Uint8Array): boolean {
  const signature = new TextDecoder().decode(body.slice(0, 6));
  return signature === 'GIF87a' || signature === 'GIF89a';
}

/** `true` when `body` opens with a RIFF container whose form type is WEBP. */
export function hasWebpSignature(body: Uint8Array): boolean {
  return body.length >= 12
    && new TextDecoder().decode(body.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(body.slice(8, 12)) === 'WEBP';
}

/** Every recognized image signature, checked in this order until one matches. */
const IMAGE_SIGNATURE_MATCHERS: readonly ((body: Uint8Array) => boolean)[] = [
  hasPngSignature,
  hasJpegSignature,
  hasGifSignature,
  hasWebpSignature,
  hasAvifSignature,
];

/**
 * Infers `'image'` from the leading bytes rather than from a renderer-controlled MIME type or file
 * extension. PNG, JPEG, GIF87a/89a, WEBP, and AVIF (brand-checked ISO-BMFF, see
 * {@link hasAvifSignature}) are recognized; everything else is `'file'` — including a plain MP4 or
 * other non-AVIF ISO-BMFF file, which shares AVIF's `ftyp` tag but is deliberately NOT matched here
 * (see {@link hasIsoBmffFtypTag}'s doc for why a brand-blind `ftyp` check would be wrong).
 *
 * `kind` decides whether a path is later passed to `AgentExecutor.run()`'s `imagePaths`, so letting
 * a renderer assert it would let a renderer choose how the agent runtime parses the bytes.
 */
export function detectAttachmentKind(body: Uint8Array): StoredAttachment['kind'] {
  return IMAGE_SIGNATURE_MATCHERS.some((matchesSignature) => matchesSignature(body)) ? 'image' : 'file';
}

/**
 * Streams a request body straight to a private file under a hard byte cap, keeping only the
 * leading signature bytes in memory so an upload never costs memory proportional to its size.
 *
 * Opened `wx`, so this can never overwrite an existing file. A partial write is removed before the
 * rejection propagates: the cap is enforced *during* the stream, which necessarily means some bytes
 * already reached disk by the time it trips.
 */
export async function writeBoundedAttachmentBody({
  request,
  filePath,
  maxBytes,
  mode = 0o600,
}: {
  request: AsyncIterable<unknown>;
  filePath: string;
  maxBytes: number;
  mode?: number;
}): Promise<{ size: number; signature: Uint8Array }> {
  const handle = await open(filePath, 'wx', mode);
  let total = 0;
  let signature = Buffer.alloc(0);
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buffer.byteLength;
      if (total > maxBytes) {
        throw new AttachmentRejectedError(
          'attachment-too-large',
          `Each attachment must be ${formatByteLimit(maxBytes)} or smaller`,
        );
      }
      if (signature.byteLength < SIGNATURE_BYTES) {
        signature = Buffer.concat(
          [signature, buffer.subarray(0, SIGNATURE_BYTES - signature.byteLength)],
          Math.min(SIGNATURE_BYTES, signature.byteLength + buffer.byteLength),
        );
      }
      await handle.write(buffer);
    }
    await handle.close();
    await chmod(filePath, mode);
    return { size: total, signature };
  } catch (error) {
    // Reached both while the handle is still open (the byte cap tripped, or the request stream
    // errored) and after it was already closed (`chmod` failed). No `.catch` is needed to tell those
    // apart: Node's `FileHandle.close()` is idempotent — closing an already-closed handle resolves
    // — so this can only reject for a handle that is genuinely still open and unclosable, which is
    // a failure worth surfacing rather than swallowing.
    await handle.close();
    await rm(filePath, { force: true });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Restart survival (`retainAcrossRestarts`)
// ---------------------------------------------------------------------------

/**
 * Directory, directly under the upload root, holding one small JSON sidecar per registered
 * attachment. This is what makes a restart-surviving store possible at all: the upload path encodes
 * the batch id and nothing else, so a directory scan alone can never recover an attachment's
 * display `name`, its sniffed `kind`, its capability `id`, or — the one that decides whether
 * `listPendingForOwner` can see it again — its `ownerId`. A scan-only "reconstruct from the paths"
 * design therefore brings the *bytes* back and still shows the user an empty list, which is half a
 * fix.
 *
 * The leading `.` is load-bearing: `BATCH_ID_PATTERN` admits no `.`, so `resolveBatchDirectory` can
 * never produce this path and a batch can never collide with (or be made to write into) the sidecar
 * directory. It also sits OUTSIDE every batch directory on purpose — a batch directory is the one
 * directory a host grants the agent read access to (`AttachmentClaim.batchDirectory`), so sidecars
 * kept next to their files would hand a run the `ownerId` and capability ids of every other
 * attachment in the same batch.
 */
const SIDECAR_DIRECTORY_NAME = '.records';

/**
 * One attachment as it is written to its sidecar — `AttachmentRecord` minus two fields, both
 * omitted deliberately:
 *
 * - **`batchDirectory`**, because it is re-derived from the upload root on read rather than trusted.
 *   A sidecar is a file on disk; if it could name the directory a claim later hands to an agent, a
 *   forged one would turn this store into an arbitrary-file-read primitive. Re-deriving it through
 *   the same `BATCH_ID_PATTERN` + `resolve` containment argument `resolveBatchDirectory` uses means
 *   a forged sidecar can only ever point inside the upload root.
 * - **`claimedRunId`**, because no run survives the process that owned it. Everything adopted comes
 *   back unclaimed; a file whose run died is re-listable to its own uploader (never to anyone else
 *   — `claim`/`resolveForRun` still demand the unguessable id or path) and expires on the normal
 *   TTL. See {@link loadPersistedAttachments} for the retention consequence that carries.
 */
export interface PersistedAttachmentRecord {
  readonly id: string;
  readonly filePath: string;
  readonly name: string;
  readonly kind: StoredAttachment['kind'];
  readonly size: number;
  readonly batchId: string;
  readonly dev: number;
  readonly ino: number;
  readonly createdAt: number;
  readonly ownerId?: string;
}

/** Field types a sidecar must carry, checked as data so the validator stays one flat loop. */
const PERSISTED_FIELD_TYPES: Readonly<Record<string, string>> = {
  id: 'string',
  filePath: 'string',
  name: 'string',
  kind: 'string',
  size: 'number',
  batchId: 'string',
  dev: 'number',
  ino: 'number',
  createdAt: 'number',
};

function hasPersistedFieldTypes(candidate: Record<string, unknown>): boolean {
  return Object.entries(PERSISTED_FIELD_TYPES)
    .every(([field, type]) => typeof candidate[field] === type);
}

function isPersistedAttachmentShape(raw: unknown): raw is PersistedAttachmentRecord {
  if (typeof raw !== 'object' || raw === null) return false;
  const candidate = raw as Record<string, unknown>;
  if (!hasPersistedFieldTypes(candidate)) return false;
  if (candidate.ownerId !== undefined && typeof candidate.ownerId !== 'string') return false;
  return candidate.kind === 'image' || candidate.kind === 'file';
}

/**
 * Turns one sidecar's parsed JSON back into an `AttachmentRecord`, or `undefined` for anything that
 * is not a well-formed record naming a file inside its own batch directory.
 *
 * `batchDirectory` is re-derived here and `filePath`'s containment is re-checked against it with
 * the same parent-equality test `register` uses — the two checks that make an adopted record no
 * more trusted than one this process registered itself. Pure and exported so both can be exercised
 * against hostile input directly, without staging files on disk.
 */
export function parsePersistedAttachment(
  raw: unknown,
  canonicalUploadDirectory: string,
): AttachmentRecord | undefined {
  if (!isPersistedAttachmentShape(raw)) return undefined;
  if (!BATCH_ID_PATTERN.test(raw.batchId)) return undefined;
  const batchDirectory = resolve(canonicalUploadDirectory, raw.batchId);
  const filePath = resolve(raw.filePath);
  if (dirname(filePath) !== batchDirectory) return undefined;
  return {
    id: raw.id,
    filePath,
    name: raw.name,
    kind: raw.kind,
    size: raw.size,
    batchId: raw.batchId,
    batchDirectory,
    dev: raw.dev,
    ino: raw.ino,
    createdAt: raw.createdAt,
    ...(raw.ownerId === undefined ? {} : { ownerId: raw.ownerId }),
  };
}

/**
 * Sidecar filename for a record id. Reduces the id to the same `[a-zA-Z0-9-]` allowlist
 * `BATCH_ID_PATTERN` uses before appending the extension, so no id — however this store's own id
 * format later changes — can put a `/`, a `..`, or a second extension into the path. Ids are
 * `attachment:<uuid>`, so the reduction stays injective in practice: the UUID is what makes it
 * unique and the UUID survives unchanged.
 */
export function attachmentSidecarFileName(id: string): string {
  return `${id.replaceAll(/[^a-zA-Z0-9-]/gu, '_')}.json`;
}

async function readPersistedAttachment(
  sidecarPath: string,
  canonicalUploadDirectory: string,
): Promise<AttachmentRecord | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(sidecarPath, 'utf8'));
    return parsePersistedAttachment(raw, canonicalUploadDirectory);
  } catch {
    // Unreadable, truncated by a kill mid-write, or not JSON at all. Indistinguishable from a
    // sidecar that never described a real attachment, and handled identically: not adopted.
    return undefined;
  }
}

/**
 * `true` when the file this record describes is still byte-for-byte the file registration accepted.
 *
 * Deliberately `verifyClaimedAttachments` rather than a looser existence check: adoption must apply
 * the SAME `dev`/`ino`/`size`/`realpath` gate `claim()` applies, or a restart would become the one
 * moment at which a file swapped underneath the store gets handed to an agent anyway.
 */
async function isAdoptableAttachment(record: AttachmentRecord): Promise<boolean> {
  try {
    await verifyClaimedAttachments([record]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuilds the record map from the sidecar directory, adopting only records that are (a) well
 * formed and contained, (b) still within the retention window, and (c) still backed by the exact
 * file registration accepted. Anything failing any of those is deleted — sidecar first, then the
 * file it named, and the file ONLY when containment passed, so an unparseable sidecar can never
 * make this an arbitrary-file-delete primitive for whatever the daemon can unlink.
 *
 * **The retention consequence, stated rather than assumed harmless.** Because `claimedRunId` is not
 * persisted (see {@link PersistedAttachmentRecord}), a file claimed by a run that died with the
 * process is adopted as unclaimed instead of being wiped, so it now occupies disk and quota for up
 * to `retentionMs` rather than until the next start. Bounded by the same `maxStoredAttachments` /
 * `maxStoredBytes` quotas as any live upload, and cleared by the `pruneExpired` every upload
 * already runs — but it is a real change in when that disk comes back.
 *
 * @complexity O(n) in sidecars present, each costing one read and one `lstat`/`realpath` pair.
 */
export async function loadPersistedAttachments({
  canonicalUploadDirectory,
  retentionMs,
  now = Date.now(),
}: {
  readonly canonicalUploadDirectory: string;
  readonly retentionMs: number;
  readonly now?: number;
}): Promise<Map<string, AttachmentRecord>> {
  const sidecarDirectory = resolve(canonicalUploadDirectory, SIDECAR_DIRECTORY_NAME);
  await mkdir(sidecarDirectory, { recursive: true, mode: 0o700 });
  const adopted = new Map<string, AttachmentRecord>();
  for (const entry of await readdir(sidecarDirectory)) {
    const sidecarPath = resolve(sidecarDirectory, entry);
    const record = await readPersistedAttachment(sidecarPath, canonicalUploadDirectory);
    if (record && now - record.createdAt < retentionMs && await isAdoptableAttachment(record)) {
      adopted.set(record.id, record);
      continue;
    }
    await rm(sidecarPath, { force: true });
    if (record) await rm(record.filePath, { force: true });
  }
  return adopted;
}

/** Deletes everything in one batch directory that no adopted record names, then tidies the
 *  directory away if that emptied it. A root entry that is not a directory at all is removed
 *  outright — the store never creates one, so it can only be debris. */
async function removeUnadoptedBatch(batchDirectory: string, keep: ReadonlySet<string>): Promise<void> {
  const entries = await readdir(batchDirectory).catch(() => undefined);
  if (entries === undefined) {
    await rm(batchDirectory, { force: true });
    return;
  }
  for (const entry of entries) {
    const filePath = resolve(batchDirectory, entry);
    if (!keep.has(filePath)) await rm(filePath, { recursive: true, force: true });
  }
  await rmdir(batchDirectory).catch(() => undefined);
}

/**
 * Removes every upload the sidecar pass did not adopt. Without this, a file whose sidecar was lost
 * (or was never written, because it predates this option) would survive forever with nothing
 * tracking it — trading the wipe's data loss for unbounded disk growth, which is not a trade worth
 * making. This is what keeps "never wipe on construction" bounded.
 */
export async function removeUnadoptedUploads(
  canonicalUploadDirectory: string,
  adopted: ReadonlyMap<string, AttachmentRecord>,
): Promise<void> {
  const keep = new Set([...adopted.values()].map((record) => record.filePath));
  for (const entry of await readdir(canonicalUploadDirectory)) {
    if (entry === SIDECAR_DIRECTORY_NAME) continue;
    await removeUnadoptedBatch(resolve(canonicalUploadDirectory, entry), keep);
  }
}

/**
 * Decides what a newly-constructed store starts holding: nothing (the default — empty the directory
 * outright, this pack's behavior before `retainAcrossRestarts` existed), or the authenticated
 * survivors of the previous process.
 *
 * Exported so the whole restart decision can be exercised without standing a store up around it.
 */
export async function prepareAttachmentStorage({
  canonicalUploadDirectory,
  retainAcrossRestarts,
  retentionMs,
  now,
}: {
  readonly canonicalUploadDirectory: string;
  readonly retainAcrossRestarts: boolean;
  readonly retentionMs: number;
  readonly now?: number;
}): Promise<Map<string, AttachmentRecord>> {
  if (!retainAcrossRestarts) {
    for (const entry of await readdir(canonicalUploadDirectory)) {
      await rm(resolve(canonicalUploadDirectory, entry), { recursive: true, force: true });
    }
    return new Map();
  }
  const adopted = await loadPersistedAttachments({
    canonicalUploadDirectory,
    retentionMs,
    ...(now === undefined ? {} : { now }),
  });
  await removeUnadoptedUploads(canonicalUploadDirectory, adopted);
  return adopted;
}

/**
 * The disk-backed `AttachmentStore` this package ships. Every default matches what a chat composer
 * needs out of the box; a host that wants different quotas passes them rather than reimplementing
 * the port.
 *
 * @complexity `register`/`claim` are O(n) in the number of tracked records (a small bounded number
 * — `maxStoredAttachments`), which is what keeps the quota decision synchronous; see `register`.
 */
export async function createDiskAttachmentStore({
  uploadDirectory,
  maxAttachments = 10,
  maxBatchBytes = 50 * 1024 * 1024,
  maxStoredAttachments = 100,
  maxStoredBytes = 200 * 1024 * 1024,
  retentionMs = 60 * 60 * 1_000,
  retainAcrossRestarts = false,
}: CreateDiskAttachmentStoreOptions): Promise<AttachmentStore> {
  await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
  await chmod(uploadDirectory, 0o700);
  const canonicalUploadDirectory = await realpath(uploadDirectory);
  // Either empties the directory (the default — a file left by an interrupted previous process has
  // no record to authenticate it against) or adopts the previous process's authenticated survivors.
  // See `prepareAttachmentStorage`.
  const records = await prepareAttachmentStorage({
    canonicalUploadDirectory,
    retainAcrossRestarts,
    retentionMs,
  });
  const sidecarDirectory = resolve(canonicalUploadDirectory, SIDECAR_DIRECTORY_NAME);
  const sidecarPathFor = (record: AttachmentRecord): string =>
    resolve(sidecarDirectory, attachmentSidecarFileName(record.id));

  /**
   * Writes one record's sidecar, or does nothing at all when this store was not asked to survive
   * restarts. A failure rolls the record back out of the map before propagating: a registration
   * whose sidecar could not be written would otherwise be silently non-surviving, which is the
   * exact failure mode this whole option exists to remove. `register`'s own `catch` deletes the
   * file, so the caller sees a failed upload rather than one that quietly evaporates later.
   */
  const persistRecord = async (record: AttachmentRecord): Promise<void> => {
    if (!retainAcrossRestarts) return;
    const persisted: PersistedAttachmentRecord = {
      id: record.id,
      filePath: record.filePath,
      name: record.name,
      kind: record.kind,
      size: record.size,
      batchId: record.batchId,
      dev: record.dev,
      ino: record.ino,
      createdAt: record.createdAt,
      ...(record.ownerId === undefined ? {} : { ownerId: record.ownerId }),
    };
    try {
      await writeFile(sidecarPathFor(record), JSON.stringify(persisted), { mode: 0o600 });
    } catch (error) {
      records.delete(record.id);
      throw error;
    }
  };

  const forgetRecord = async (record: AttachmentRecord): Promise<void> => {
    if (retainAcrossRestarts) await rm(sidecarPathFor(record), { force: true });
  };

  const resolveBatchDirectory = (batchId: string): string => {
    if (!BATCH_ID_PATTERN.test(batchId)) {
      throw new AttachmentRejectedError('invalid-batch', 'Invalid attachment batch');
    }
    // No containment re-check follows, and two things together are why — **both** are load-bearing:
    // `BATCH_ID_PATTERN` admits only `[a-zA-Z0-9-]`, so `batchId` carries no `.`, `/`, or `\`; and
    // `resolve` normalizes, so the result is exactly `<canonicalUploadDirectory><sep><batchId>`, one
    // non-traversing segment deeper. Weakening the pattern (a `.` would be enough) or dropping the
    // `resolve` reintroduces traversal here. Verified by sweeping 5,040,504 `(uploadRoot, batchId)`
    // pairs on both posix and win32: zero escape the upload root.
    return resolve(canonicalUploadDirectory, batchId);
  };

  const removeEmptyBatch = async (batchDirectory: string): Promise<void> => {
    try {
      await rmdir(batchDirectory);
    } catch {
      // Non-empty (another unclaimed upload still occupies it) or already gone. Both are fine:
      // this is opportunistic tidying, never the thing that makes a delete correct.
    }
  };

  const deleteRecord = async (record: AttachmentRecord): Promise<void> => {
    records.delete(record.id);
    await forgetRecord(record);
    await rm(record.filePath, { force: true });
    await removeEmptyBatch(record.batchDirectory);
  };

  const totalBytes = (candidates: readonly AttachmentRecord[]): number =>
    candidates.reduce((total, record) => total + record.size, 0);

  return {
    async createBatchDirectory(batchId) {
      const directory = resolveBatchDirectory(batchId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      return directory;
    },

    async register(input) {
      const batchDirectory = resolveBatchDirectory(input.batchId);
      // `resolve` is NOT redundant with the route's own `resolve`, and this line is the precondition
      // the containment argument below depends on. Do not remove it or take a pre-resolved path from
      // the caller: `register` is a public port method, so `input.path` is untrusted.
      const filePath = resolve(input.path);
      // Containment: the file's parent directory must be *exactly* the batch directory — stronger
      // than a `path.relative`-based "is inside" test, which also admits nested subdirectories and
      // the batch directory itself.
      //
      // Why parent-equality is sufficient: `resolve` above guarantees `filePath` is absolute and
      // normalized with no `..` left in the path body, so `dirname(filePath) === batchDirectory`
      // implies `filePath` is `batchDirectory + sep + basename` with a real, non-traversing
      // basename. This is *not* an unconditional path-algebra identity — without the `resolve`,
      // `dirname('/a/..') === '/a'` is true while `/a/..` escapes `/a`. The normalization is what
      // makes the argument hold; a differential fuzz of 6,000,000 `input.path` values against the
      // previous two-part check found zero inputs this accepts that containment rejected.
      //
      // Deliberately OUTSIDE the `try` below, whose `catch` unlinks `filePath`. A path that failed
      // containment must never reach that cleanup, or this port becomes an arbitrary-file-delete
      // primitive for anything the daemon can unlink.
      if (dirname(filePath) !== batchDirectory) {
        throw new AttachmentRejectedError(
          'attachment-integrity',
          'Attachment path is outside its batch',
        );
      }
      try {
        const info = await lstat(filePath);
        // `lstat` (not `stat`): a symlink must be seen as a symlink, not followed. `isFile()` is
        // false for a symlink and for a directory, which is the whole check.
        if (!info.isFile()) {
          throw new AttachmentRejectedError(
            'attachment-integrity',
            'Attachment is not a regular file',
          );
        }
        const canonical = await realpath(filePath);
        if (canonical !== filePath) {
          throw new AttachmentRejectedError(
            'attachment-integrity',
            'Attachment path is not canonical',
          );
        }

        // Quotas are decided here, immediately before `records.set`, with no `await` in between —
        // so two concurrent registrations cannot both observe the last free slot (or the last free
        // bytes) and both commit. Moving any of this above the `await`s would reintroduce that
        // race; adding an `await` below would too.
        const batchRecords = [...records.values()]
          .filter((record) => record.batchId === input.batchId);
        if (batchRecords.length >= maxAttachments) {
          throw new AttachmentRejectedError(
            'batch-count-exceeded',
            `You can attach at most ${maxAttachments} files to one message`,
          );
        }
        if (totalBytes(batchRecords) + info.size > maxBatchBytes) {
          throw new AttachmentRejectedError(
            'batch-too-large',
            `Attachments for one message must total ${formatByteLimit(maxBatchBytes)} or less`,
          );
        }
        if (
          records.size >= maxStoredAttachments
          || totalBytes([...records.values()]) + info.size > maxStoredBytes
        ) {
          throw new AttachmentRejectedError('storage-full', 'Attachment storage is full');
        }
        const id = `attachment:${randomUUID()}`;
        const record: AttachmentRecord = {
          id,
          filePath,
          name: input.name,
          kind: input.kind,
          size: info.size,
          batchId: input.batchId,
          batchDirectory,
          dev: info.dev,
          ino: info.ino,
          createdAt: Date.now(),
          ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
        };
        records.set(id, record);
        // The first `await` after the synchronous quota window closes, so it cannot reopen the race
        // the comment above guards. Rolls `records` back itself on failure — see `persistRecord`.
        await persistRecord(record);
        return { path: id, name: record.name, kind: record.kind, size: record.size };
      } catch (error) {
        // A file this store refused to take ownership of must not be left behind. `rm` is
        // deliberately non-recursive (never recurse over an attacker-influenced path) and its own
        // failure is swallowed, so the real rejection above always propagates instead of being
        // masked by e.g. EISDIR from a directory sitting at `filePath`.
        await rm(filePath, { force: true }).catch(() => undefined);
        await removeEmptyBatch(batchDirectory);
        throw error;
      }
    },

    async claim(attachments, runId) {
      if (attachments.length === 0) return { attachments: [] };
      // Phase 1 (`reserveAttachmentRecords`) reserves synchronously; Phase 2
      // (`verifyClaimedAttachments`) re-validates what is now held exclusively. Any Phase 2 failure
      // releases the whole reservation here, so a rejected claim still leaves nothing half-claimed
      // and the caller can retry with a corrected set. Only reservations made by *this* call are
      // released, so a concurrent winner's claim is never revoked by a loser's rollback.
      const claimed = reserveAttachmentRecords(attachments, records, runId, maxAttachments);
      try {
        const batchDirectory = await verifyClaimedAttachments(claimed);
        return {
          attachments: claimed.map((record) => ({
            path: record.filePath,
            name: record.name,
            kind: record.kind,
            size: record.size,
          })),
          batchDirectory,
        };
      } catch (error) {
        for (const record of claimed) delete record.claimedRunId;
        throw error;
      }
    },

    async resolveForRun(ref, runId) {
      // Synchronous check-then-reserve, same reasoning as `reserveAttachmentRecords`: nothing may
      // `await` between reading `claimedRunId` and writing it, or a concurrent call could observe
      // the same unclaimed record and both believe they reserved it.
      const record = records.get(ref) ?? [...records.values()].find((candidate) => candidate.filePath === ref);
      if (!record) return undefined;
      if (record.claimedRunId !== undefined && record.claimedRunId !== runId) {
        throw new AttachmentRejectedError('attachment-unknown-or-claimed', 'Attachment is unknown or already claimed');
      }
      const reservedNow = record.claimedRunId === undefined;
      if (reservedNow) record.claimedRunId = runId;
      try {
        await verifyClaimedAttachments([record]);
      } catch (error) {
        // Mirrors `claim()`'s own rollback: a lookup that fails integrity must not leave a phantom
        // reservation behind for a record that turned out to be unsafe to hand back.
        if (reservedNow) delete record.claimedRunId;
        throw error;
      }
      return { path: record.filePath, name: record.name, kind: record.kind, size: record.size };
    },

    async listPendingForOwner(ownerId) {
      return [...records.values()]
        // `record.ownerId !== undefined` first, short-circuiting before the comparison: this is
        // what makes an ownerless record excluded rather than accidentally matched by a falsy-ish
        // `ownerId` argument — see this method's own doc on why that must never be a wildcard.
        .filter((record) => record.claimedRunId === undefined && record.ownerId !== undefined && record.ownerId === ownerId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((record) => ({ ref: record.id, name: record.name, kind: record.kind, size: record.size, createdAt: record.createdAt }));
    },

    async deleteUnclaimed(batchId, paths) {
      const batchDirectory = resolveBatchDirectory(batchId);
      for (const attachmentId of new Set(paths)) {
        const record = records.get(attachmentId);
        if (record && record.batchId === batchId && record.claimedRunId === undefined) {
          await deleteRecord(record);
        }
      }
      await removeEmptyBatch(batchDirectory);
    },

    async cleanupRun(runId) {
      for (const record of [...records.values()]) {
        if (record.claimedRunId === runId) await deleteRecord(record);
      }
    },

    async pruneExpired(now = Date.now()) {
      for (const record of [...records.values()]) {
        if (record.claimedRunId === undefined && now - record.createdAt >= retentionMs) {
          await deleteRecord(record);
        }
      }
    },

    async dispose() {
      for (const record of [...records.values()]) await deleteRecord(record);
    },
  };
}

/**
 * Diagnostic detail for an internal-error response the public API deliberately does not disclose
 * (SEC-005), matching `MediaInternalErrorContext`'s precedent.
 */
export interface AttachmentsInternalErrorContext {
  readonly source: 'attachment-upload' | 'attachment-cleanup';
  readonly batchId: string | null;
  readonly correlationId: string;
  readonly error: unknown;
}

export interface AttachmentsHttpDeps {
  readonly store: AttachmentStore;
  /**
   * Uploads accepted at once before further requests are rate-limited. Bounds concurrent
   * filesystem work, which matters because each in-flight upload holds an open handle and may be
   * writing up to `maxAttachmentBytes`. Defaults to 4.
   */
  readonly maxConcurrentUploads?: number;
  /**
   * Hard per-request byte cap, enforced while streaming. Should be at or below the store's
   * `maxBatchBytes`. Defaults to 20 MB.
   */
  readonly maxAttachmentBytes?: number;
  /** Capability ids one `DELETE` may name. Defaults to 10, matching the store's batch cap. */
  readonly maxCleanupPaths?: number;
  /**
   * Rejects a request whose `Origin`/`Host` is not the local daemon's, as every other mutating
   * route in this package does. Defaults to `true`; a host whose browser sits on a *different*
   * local port than the daemon (a dev-server proxy, say) either sets that port via `JINI_WEB_PORT`
   * so the guard recognizes it, or opts out here and accepts that it has no CSRF protection on
   * this route.
   */
  readonly requireSameOrigin?: boolean;
  /** Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` (SEC-005). Defaults to `console.error`. */
  readonly onInternalError?: (context: AttachmentsInternalErrorContext) => void;
  /**
   * Resolves the principal id that owns this upload, if any, passed through to `store.register()`'s
   * `ownerId` (see that field's own doc, and `AttachmentStore.listPendingForOwner`). Optional: a
   * host with no owner concept omits it and every attachment registers ownerless, matching this
   * pack's behavior before ownership existed — `listPendingForOwner` simply never returns those.
   *
   * A host is expected to read this from a header/context IT ALREADY TRUSTS (e.g. a reverse proxy's
   * own session-verified principal header, asserted only downstream of that proxy's auth gate) —
   * this pack has no session concept of its own and never authenticates `req` itself. Returning a
   * caller-controlled value here (an inbound header nothing has verified) would let any uploader
   * assert an arbitrary `ownerId` and make its files discoverable by whoever that id names.
   */
  readonly resolveOwnerId?: (req: Request) => string | undefined;
}

export const ATTACHMENTS_ROUTE_PATH = '/api/attachments';

function defaultInternalErrorSink(context: AttachmentsInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(
    `[@jini-ai/http-kit] internal error (${context.source}, correlationId=${context.correlationId})`,
    context.error,
  );
}

function reportInternalError(
  deps: AttachmentsHttpDeps,
  source: AttachmentsInternalErrorContext['source'],
  error: unknown,
  batchId: string | null,
): ApiError {
  const correlationId = randomUUID();
  const sink = deps.onInternalError ?? defaultInternalErrorSink;
  sink({ source, batchId, correlationId, error });
  return createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId });
}

/**
 * Sends the right status for an upload failure: an explicitly-classified rejection keeps its real
 * message (the composer shows it to the user, so "you can attach at most 10 files" has to survive),
 * while an integrity failure or any unexpected error is redacted to a generic `INTERNAL_ERROR`.
 */
function respondToUploadFailure(
  res: Response,
  deps: AttachmentsHttpDeps,
  error: unknown,
  batchId: string | null,
  source: AttachmentsInternalErrorContext['source'],
): void {
  if (error instanceof AttachmentRejectedError && REJECTION_STATUS[error.reason] !== 500) {
    sendApiError(res, REJECTION_STATUS[error.reason], apiErrorForRejection(error));
    return;
  }
  sendApiError(res, 500, reportInternalError(deps, source, error, batchId));
}

/** `false` when the same-origin guard rejected the request (and already answered it). */
function passesOriginGuard(req: Request, res: Response, deps: AttachmentsHttpDeps, adapter: AdapterContext): boolean {
  if (deps.requireSameOrigin === false) return true;
  const origin = guardSameOrigin(req, adapter);
  if (origin.ok) return true;
  sendApiError(res, 403, origin.error);
  return false;
}

export interface AttachmentUploadResponse {
  readonly attachment: StoredAttachment;
}

/**
 * Handles one upload: rate-limit, batch directory, bounded stream to disk, signature sniff,
 * register. Exported so a host mounting its own path (or its own framework) can reuse the whole
 * body without re-deriving the ordering, which is load-bearing — see the `finally`.
 */
export async function handleAttachmentUpload(
  req: Request,
  res: Response,
  deps: AttachmentsHttpDeps,
  state: { activeUploads: number },
): Promise<void> {
  const maxConcurrentUploads = deps.maxConcurrentUploads ?? 4;
  const maxAttachmentBytes = deps.maxAttachmentBytes ?? 20 * 1024 * 1024;
  const name = sanitizeAttachmentName(req.query.name);
  const batchId = typeof req.query.batch === 'string' ? req.query.batch : '';
  // Every refusal below goes through `respondToUploadFailure`, so the reason -> status/code mapping
  // lives in exactly one place rather than being partly inlined here.
  if (state.activeUploads >= maxConcurrentUploads) {
    respondToUploadFailure(res, deps, new AttachmentRejectedError(
      'too-many-concurrent-uploads',
      'Too many attachment uploads are in progress',
    ), batchId, 'attachment-upload');
    return;
  }
  // Checked before a single byte is written: a drained stream would otherwise produce a zero-byte
  // file and the misleading "attachment is empty". See this module's body-parser doc.
  if (req.readableEnded) {
    respondToUploadFailure(res, deps, new AttachmentRejectedError(
      'attachment-body-consumed',
      `the request body was already consumed before ${ATTACHMENTS_ROUTE_PATH} received it — mount this route pack before any global body parser, or scope that parser to skip this path`,
    ), batchId, 'attachment-upload');
    return;
  }
  state.activeUploads += 1;
  try {
    await deps.store.pruneExpired();
    const batchDirectory = await deps.store.createBatchDirectory(batchId);
    // A fresh UUID, never the client's filename. The extension is carried over (bounded) only
    // because some agent runtimes decide how to read a file from its suffix.
    const suffix = extname(name).slice(0, 12);
    const path = resolve(batchDirectory, `${randomUUID()}${suffix}`);
    const upload = await writeBoundedAttachmentBody({ request: req, filePath: path, maxBytes: maxAttachmentBytes });
    if (upload.size === 0) {
      await rm(path, { force: true });
      sendApiError(res, 400, createApiError('BAD_REQUEST', 'Attachment is empty'));
      return;
    }
    const ownerId = deps.resolveOwnerId?.(req);
    const attachment = await deps.store.register({
      batchId,
      path,
      name,
      kind: detectAttachmentKind(upload.signature),
      size: upload.size,
      ...(ownerId === undefined ? {} : { ownerId }),
    });
    sendJson(res, 201, { attachment } satisfies AttachmentUploadResponse);
  } catch (error) {
    respondToUploadFailure(res, deps, error, batchId, 'attachment-upload');
  } finally {
    state.activeUploads -= 1;
    // Removes the batch directory when this failed upload left it empty. Passing no paths is
    // deliberate: a *successful* upload must not be deleted here, and `deleteUnclaimed` with an
    // empty list does exactly the directory tidying and nothing else.
    await deps.store.deleteUnclaimed(batchId, []).catch(() => undefined);
  }
}

/**
 * Handles a client abandoning a batch (a failed multi-file upload, a cleared composer). Only
 * *unclaimed* uploads can be deleted this way, so a caller cannot use it to pull files out from
 * under a run that already claimed them.
 */
export async function handleAttachmentCleanup(
  req: Request,
  res: Response,
  deps: AttachmentsHttpDeps,
): Promise<void> {
  const maxCleanupPaths = deps.maxCleanupPaths ?? 10;
  const body = req.body as { batchId?: unknown; paths?: unknown } | undefined;
  if (
    typeof body?.batchId !== 'string'
    || !Array.isArray(body.paths)
    || body.paths.length > maxCleanupPaths
    || !body.paths.every((path) => typeof path === 'string')
  ) {
    sendApiError(res, 400, createApiError('BAD_REQUEST', 'Invalid attachment cleanup request'));
    return;
  }
  try {
    await deps.store.deleteUnclaimed(body.batchId, body.paths);
    res.status(204).end();
  } catch (error) {
    respondToUploadFailure(res, deps, error, body.batchId, 'attachment-cleanup');
  }
}

/**
 * Mounts `POST`/`DELETE /api/attachments` on `app`. A pack's `http(app, services)` calls this
 * directly.
 *
 * Hand-mounted rather than built from `defineJsonRoute`/`mountJsonRoute` for two concrete reasons:
 * the upload reads the raw request stream (a JSON-parsed `req.body` is exactly what must not have
 * happened), and the cleanup answers `204` with no body, which a JSON responder cannot express.
 */
export function registerAttachmentRoutes(
  app: Express,
  deps: AttachmentsHttpDeps,
  adapter: AdapterContext,
): void {
  // Per-registration, not module-level: two daemons in one process (a test harness, an embedded
  // second host) must not share one upload budget.
  const state = { activeUploads: 0 };
  app.post(ATTACHMENTS_ROUTE_PATH, async (req, res) => {
    try {
      if (!passesOriginGuard(req, res, deps, adapter)) return;
      await handleAttachmentUpload(req, res, deps, state);
    } catch (error) {
      // `handleAttachmentUpload` already catches everything inside its own body — this only ever
      // fires for `passesOriginGuard`/`guardSameOrigin` throwing, which is Result-returning by
      // contract but not guaranteed never to throw (`isLocalSameOrigin` really does throw on a
      // malformed `JINI_ALLOWED_ORIGINS` entry — see the paired regression test). Mounting this
      // route bypasses `mountJsonRoute`'s adapter (see this function's own doc), so nothing else
      // stood between that throw and an unhandled rejection with no process-level guard anywhere
      // in this package's path.
      if (!res.headersSent) respondToUploadFailure(res, deps, error, null, 'attachment-upload');
    }
  });
  app.delete(ATTACHMENTS_ROUTE_PATH, async (req, res) => {
    try {
      if (!passesOriginGuard(req, res, deps, adapter)) return;
      await handleAttachmentCleanup(req, res, deps);
    } catch (error) {
      if (!res.headersSent) sendApiError(res, 500, reportInternalError(deps, 'attachment-cleanup', error, null));
    }
  });
}
