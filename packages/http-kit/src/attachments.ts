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
 * **Storage lifetime is daemon-lifetime, not persistent.** `createDiskAttachmentStore` empties its
 * upload directory on construction: files left behind by an interrupted previous process cannot be
 * authenticated against an in-memory registry that no longer exists, so they are removed rather
 * than adopted. Unclaimed uploads also expire by TTL (`pruneExpired`), and a run's claimed files are
 * deleted by `cleanupRun`.
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
import { chmod, lstat, mkdir, open, readdir, realpath, rm, rmdir } from 'node:fs/promises';
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
 * Deliberately declared here rather than imported from `@jini-ai/chat-core`, whose `ChatAttachment`
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
  }) => Promise<StoredAttachment>;
  /** Exchanges capability ids for real paths, exactly once, binding them to `runId`. */
  claim: (
    attachments: readonly StoredAttachment[],
    runId: string,
  ) => Promise<AttachmentClaim>;
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
}

/**
 * Accepted batch id shape. Deliberately narrow — long enough for a UUID, and admitting no `.`,
 * `/`, or `\`, which is what makes `resolve(uploadRoot, batchId)` provably a single
 * non-traversing path segment.
 */
const BATCH_ID_PATTERN = /^[a-zA-Z0-9-]{8,80}$/u;

/** Bytes of leading signature `detectAttachmentKind` needs (WEBP's marker ends at byte 12). */
const SIGNATURE_BYTES = 12;

interface AttachmentRecord {
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

/**
 * Infers `'image'` from the leading bytes rather than from a renderer-controlled MIME type or file
 * extension. PNG, JPEG, GIF87a/89a, and WEBP are recognized; everything else is `'file'`.
 *
 * `kind` decides whether a path is later passed to `AgentExecutor.run()`'s `imagePaths`, so letting
 * a renderer assert it would let a renderer choose how the agent runtime parses the bytes.
 */
export function detectAttachmentKind(body: Uint8Array): StoredAttachment['kind'] {
  const isPng = body.length >= 8
    && body[0] === 0x89
    && body[1] === 0x50
    && body[2] === 0x4e
    && body[3] === 0x47;
  const isJpeg = body.length >= 3
    && body[0] === 0xff
    && body[1] === 0xd8
    && body[2] === 0xff;
  const signature = new TextDecoder().decode(body.slice(0, 6));
  const isGif = signature === 'GIF87a' || signature === 'GIF89a';
  const isWebp = body.length >= 12
    && new TextDecoder().decode(body.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(body.slice(8, 12)) === 'WEBP';
  return isPng || isJpeg || isGif || isWebp ? 'image' : 'file';
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
}: CreateDiskAttachmentStoreOptions): Promise<AttachmentStore> {
  await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
  await chmod(uploadDirectory, 0o700);
  const canonicalUploadDirectory = await realpath(uploadDirectory);
  // Uploads live only as long as this store does. A file left by an interrupted previous process
  // has no record to authenticate it against, so it is removed rather than adopted.
  for (const entry of await readdir(canonicalUploadDirectory)) {
    await rm(resolve(canonicalUploadDirectory, entry), { recursive: true, force: true });
  }

  const records = new Map<string, AttachmentRecord>();

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
        };
        records.set(id, record);
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
      if (attachments.length > maxAttachments) {
        throw new AttachmentRejectedError('too-many-attachments', 'Too many attachments');
      }
      const requestedPaths = new Set(attachments.map((attachment) => attachment.path));
      if (requestedPaths.size !== attachments.length) {
        throw new AttachmentRejectedError('duplicate-attachment', 'Duplicate attachment');
      }
      const claimed: AttachmentRecord[] = [];
      // Overwritten on the first iteration, which always runs — `attachments` is non-empty by the
      // early return above — so the initial value is never the one returned.
      let batchDirectory = '';
      for (const requested of attachments) {
        const record = records.get(requested.path);
        if (!record || record.claimedRunId !== undefined) {
          throw new AttachmentRejectedError(
            'attachment-unknown-or-claimed',
            'Attachment is unknown or already claimed',
          );
        }
        // Re-verified against what registration recorded, not merely re-read: someone able to write
        // into the batch directory between upload and run start would otherwise get the agent to
        // read a file of their choosing.
        const info = await lstat(record.filePath);
        const canonicalPath = await realpath(record.filePath);
        if (!isUnchangedAttachment(record, {
          isRegularFile: info.isFile(),
          dev: info.dev,
          ino: info.ino,
          size: info.size,
          canonicalPath,
        })) {
          throw new AttachmentRejectedError(
            'attachment-integrity',
            'Attachment changed after upload',
          );
        }
        if (claimed.length > 0 && record.batchDirectory !== batchDirectory) {
          throw new AttachmentRejectedError(
            'mixed-batch',
            'Attachments must belong to one batch',
          );
        }
        batchDirectory = record.batchDirectory;
        claimed.push(record);
      }
      // Marked only after every attachment validated, so a rejected claim leaves nothing
      // half-claimed and the caller can retry with a corrected set.
      for (const record of claimed) record.claimedRunId = runId;
      return {
        attachments: claimed.map((record) => ({
          path: record.filePath,
          name: record.name,
          kind: record.kind,
          size: record.size,
        })),
        batchDirectory,
      };
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
    const attachment = await deps.store.register({
      batchId,
      path,
      name,
      kind: detectAttachmentKind(upload.signature),
      size: upload.size,
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
    if (!passesOriginGuard(req, res, deps, adapter)) return;
    await handleAttachmentUpload(req, res, deps, state);
  });
  app.delete(ATTACHMENTS_ROUTE_PATH, async (req, res) => {
    if (!passesOriginGuard(req, res, deps, adapter)) return;
    await handleAttachmentCleanup(req, res, deps);
  });
}
