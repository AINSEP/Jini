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
 * still the same file: `lstat` must report a regular non-symlink whose `dev`/`ino`/`size` and
 * recorded modification/change timestamps match, and `realpath` must equal the recorded path
 * (so neither the file nor any parent directory was swapped for a symlink between upload and run
 * start). Legacy sidecars establish their timestamp baseline on first verified read. Every
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
 * // ... httpExtensions: [(app, { adapter }) => registerAttachmentRoutes({ app, deps: { store }, adapter })]
 * onRunStarted: (context) => {
 *   void (async () => {
 *     try {
 *       const claimed = await store.claim({ attachments: attachmentRefsFrom(context.request), runId: context.run.id });
 *       await executor.run({
 *         runId: context.run.id,
 *         // ... prompt, cwd, agentId
 *       }, {
 *         ...(claimed.batchDirectory === undefined ? {} : {
 *           imagePaths: claimed.attachments.filter((a) => a.kind === 'image').map((a) => a.path),
 *           extraAllowedDirs: [claimed.batchDirectory],
 *           uploadRoot: claimed.batchDirectory,
 *         }),
 *       });
 *     } finally {
 *       await store.cleanupRun({ runId: context.run.id });
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
 * "attachment is empty". `attachmentUploadRoutes` detects an already-consumed stream up front (the host hands it no
 * body at all) and reports it as a host misconfiguration (`'attachment-body-consumed'`) instead of failing silently.
 * Mount this list before any global body parser, or scope the parser so it skips this path.
 *
 * **SEC-005 redaction**: a store failure can carry filesystem paths a caller must not see, so
 * anything that is not an explicitly-classified `AttachmentRejectedError` becomes a
 * correlation-id-bearing generic `INTERNAL_ERROR`, with the real error reaching a host-owned sink —
 * the same `reportInternalError` shape `media.ts`/`delegated-tools.ts` use.
 */
import { open, rm, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, extname, resolve } from 'node:path';
import { createApiError, createApiErrorResponse, type ApiError } from '@jini-ai/protocol';
import { jsonResponse, readJsonBody, readQuery, statusForError } from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost } from './route-host.js';
import { AttachmentRejectedError, type AttachmentRejectionReason, type StoredAttachment } from './attachment-types.js';
import type { AttachmentStore } from '@jini-ai/core/contracts/site/daemon-http';
import { detectAttachmentKind } from './attachment-signatures.js';
import { writeBoundedAttachmentBody } from './attachment-body.js';

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
  if (status === 413) return createApiError({ code: 'PAYLOAD_TOO_LARGE', message: error.message });
  if (status === 429) return createApiError({ code: 'RATE_LIMITED', message: error.message });
  return createApiError({ code: 'BAD_REQUEST', message: error.message });
}

/**
 * Reduces an untrusted upload filename to a display-only basename over a conservative allowlist.
 * Never used as the name of the stored file — see this module's trust-model doc.
 */
export function sanitizeAttachmentName({ requestedName }: { readonly requestedName: unknown }, _optional: Record<string, never> = {}): string {
  if (typeof requestedName !== 'string') return 'attachment';
  return basename(requestedName).replaceAll(/[^a-zA-Z0-9._ -]/gu, '_') || 'attachment';
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
  /** Host busy lease follows handler completion, including cleanup after an aborted response. */
  readonly acquireActivity?: () => () => void;
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
  /**
   * Per-request cap chosen from the sanitized file name (the body's content type is fixed, so the name's
   * extension is the only type signal at upload time). A host that lets videos exceed every other type
   * returns the larger number for those names. Wins over {@link maxAttachmentBytes} when given.
   */
  readonly maxAttachmentBytesFor?: (file: { readonly name: string }) => number;
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
  readonly resolveOwnerId?: (required: { readonly request: Request; readonly locals: Record<string, unknown> }) => string | undefined;
}

export const ATTACHMENTS_ROUTE_PATH = '/api/attachments';

/** The two things every handler below needs from outside: the app's own deps and the host's reporter, origin policy and body limit. */
export interface AttachmentCall {
  readonly deps: AttachmentsHttpDeps;
  readonly host: DaemonRouteHost;
}

export function reportInternalError(
  { deps, host, source, error, batchId }: AttachmentCall & { readonly source: AttachmentsInternalErrorContext['source']; readonly error: unknown; readonly batchId: string | null },
  _optional: Record<string, never> = {},
): ApiError {
  const message = source === 'attachment-upload'
    ? 'The file could not be attached. Try again; if it keeps failing, copy the request ID and report this problem.'
    : 'The attachment could not be removed. Try again; if it keeps failing, copy the request ID and report this problem.';
  return host.reportInternalError({ report: { source, batchId, error }, logSource: source, message }, { onInternalError: deps.onInternalError });
}

export const failureAnswer = ({ status, error }: { readonly status: number; readonly error: ApiError }): Response =>
  jsonResponse({ status, body: createApiErrorResponse({ error }) });

/**
 * The answer for an upload failure: an explicitly-classified rejection keeps its real
 * message (the composer shows it to the user, so "you can attach at most 10 files" has to survive),
 * while an integrity failure or any unexpected error is redacted to a generic `INTERNAL_ERROR`.
 */
export function respondToUploadFailure(
  { deps, host, error, batchId, source }: AttachmentCall & { readonly error: unknown; readonly batchId: string | null; readonly source: AttachmentsInternalErrorContext['source'] },
): Response {
  if (error instanceof AttachmentRejectedError && REJECTION_STATUS[error.reason] !== 500) {
    return failureAnswer({ status: REJECTION_STATUS[error.reason], error: apiErrorForRejection(error) });
  }
  return failureAnswer({ status: 500, error: reportInternalError({ deps, host, source, error, batchId }) });
}

export interface AttachmentUploadResponse {
  readonly attachment: StoredAttachment;
}

/**
 * The refusal for an upload that must not start, or `undefined` when it may. Both checks run before
 * a slot is taken or a byte is written, and in this order: the limiter answers first, so a host at
 * its upload budget never pays for diagnosing a misconfigured body parser.
 */
function refusalBeforeUpload(
  { request, state, maxConcurrentUploads }: { readonly request: Request; readonly state: { readonly activeUploads: number }; readonly maxConcurrentUploads: number },
): AttachmentRejectedError | undefined {
  if (state.activeUploads >= maxConcurrentUploads) {
    return new AttachmentRejectedError({ reason: 'too-many-concurrent-uploads', message: 'Too many attachment uploads are in progress' });
  }
  // Checked before a single byte is written: a drained stream would otherwise produce a zero-byte
  // file and the misleading "attachment is empty". The host hands a route that reads raw bytes no body at all when
  // something above it already consumed the stream, so no body here means exactly that. See this module's body-parser doc.
  if (request.body === null) {
    return new AttachmentRejectedError({ reason: 'attachment-body-consumed', message: `the request body was already consumed before ${ATTACHMENTS_ROUTE_PATH} received it — mount this route pack before any global body parser, or scope that parser to skip this path` });
  }
  return undefined;
}

/** The chunks of a web request body, as an async sequence the bounded writer can consume. */
async function* bodyChunks({ body }: { readonly body: ReadableStream<Uint8Array> }): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Creates and exclusively opens one upload before its stream is consumed. Batch cleanup may
 * remove an empty directory between mkdir/chmod/open, so retry that preparation once on ENOENT.
 * Other failures propagate unchanged; the body writer owns the returned handle and partial file.
 * @complexity O(1) filesystem operations and memory; at most two preparation attempts.
 */
async function openAttachmentUpload(
  { store, batchId, name }: { readonly store: AttachmentStore; readonly batchId: string; readonly name: string },
  _optional: Record<string, never> = {},
): Promise<{ path: string; handle: FileHandle }> {
  // A fresh UUID, never the client's filename. The extension is carried over (bounded) only
  // because some agent runtimes decide how to read a file from its suffix.
  const fileName = `${randomUUID()}${extname(name).slice(0, 12)}`;
  const prepare = async (_required: Record<string, never>, _optional: Record<string, never> = {}) => {
    const batchDirectory = await store.createBatchDirectory({ batchId });
    const path = resolve(batchDirectory, fileName);
    return { path, handle: await open(path, 'wx', 0o600) };
  };
  try {
    return await prepare({});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return prepare({});
  }
}

/**
 * The body of one admitted upload: prune, batch directory, bounded stream to disk, signature sniff,
 * register, answer. Throws for the caller to map; the caller owns the slot and the `finally` tidy.
 */
async function storeAttachmentUpload(
  { request, locals, deps, batchId, name, maxAttachmentBytes }: { readonly request: Request & { readonly body: ReadableStream<Uint8Array> }; readonly locals: Record<string, unknown>; readonly deps: AttachmentsHttpDeps; readonly batchId: string; readonly name: string; readonly maxAttachmentBytes: number },
  _optional: Record<string, never> = {},
): Promise<Response> {
  await deps.store.pruneExpired({});
  const { path, handle } = await openAttachmentUpload({ store: deps.store, batchId, name });
  const upload = await writeBoundedAttachmentBody({ request: bodyChunks({ body: request.body }), filePath: path, maxBytes: maxAttachmentBytes }, { handle });
  if (upload.size === 0) {
    await rm(path, { force: true });
    return failureAnswer({ status: 400, error: createApiError({ code: 'BAD_REQUEST', message: 'Attachment is empty' }) });
  }
  const ownerId = deps.resolveOwnerId?.({ request, locals });
  const attachment = await deps.store.register({
    input: {
      batchId,
      path,
      name,
      kind: detectAttachmentKind({ body: upload.signature }),
      size: upload.size,
      ...(ownerId === undefined ? {} : { ownerId }),
    }
  });
  return jsonResponse({ status: 201, body: { attachment } satisfies AttachmentUploadResponse });
}

/**
 * Handles one upload: rate-limit, batch directory, bounded stream to disk, signature sniff,
 * register. Exported so a host mounting its own path can reuse the whole
 * body without re-deriving the ordering, which is load-bearing — see the `finally`.
 */
export async function handleAttachmentUpload(
  { request, locals, deps, host, state }: AttachmentCall & { readonly request: Request; readonly locals: Record<string, unknown>; readonly state: { activeUploads: number } },
  _optional: Record<string, never> = {},
): Promise<Response> {
  const maxConcurrentUploads = deps.maxConcurrentUploads ?? 4;
  const query = readQuery({ request });
  const name = sanitizeAttachmentName({ requestedName: query.name });
  const maxAttachmentBytes = deps.maxAttachmentBytesFor?.({ name }) ?? deps.maxAttachmentBytes ?? 20 * 1024 * 1024;
  const batchId = typeof query.batch === 'string' ? query.batch : '';
  // Every refusal below goes through `respondToUploadFailure`, so the reason -> status/code mapping
  // lives in exactly one place rather than being partly inlined here.
  const refusal = refusalBeforeUpload({ request, state, maxConcurrentUploads });
  if (refusal !== undefined) return respondToUploadFailure({ deps, host, error: refusal, batchId, source: 'attachment-upload' });
  state.activeUploads += 1;
  try {
    return await storeAttachmentUpload({ request: request as Request & { readonly body: ReadableStream<Uint8Array> }, locals, deps, batchId, name, maxAttachmentBytes });
  } catch (error) {
    return respondToUploadFailure({ deps, host, error, batchId, source: 'attachment-upload' });
  } finally {
    state.activeUploads -= 1;
    // Removes the batch directory when this failed upload left it empty. Passing no paths is
    // deliberate: a *successful* upload must not be deleted here, and `deleteUnclaimed` with an
    // empty list does exactly the directory tidying and nothing else.
    await deps.store.deleteUnclaimed({ batchId, paths: [] }).catch(() => undefined);
  }
}

/**
 * Handles a client abandoning a batch (a failed multi-file upload, a cleared composer). Only
 * *unclaimed* uploads can be deleted this way, so a caller cannot use it to pull files out from
 * under a run that already claimed them. Answers `204` with no body.
 */
export async function handleAttachmentCleanup(
  { request, deps, host }: AttachmentCall & { readonly request: Request },
  _optional: Record<string, never> = {},
): Promise<Response> {
  const maxCleanupPaths = deps.maxCleanupPaths ?? 10;
  const read = await readJsonBody({ request }, { maxBytes: host.jsonBodyMaxBytes });
  if (!read.ok) return failureAnswer({ status: statusForError({ error: read.error }), error: read.error });
  const body = read.value as { batchId?: unknown; paths?: unknown } | undefined;
  if (
    typeof body?.batchId !== 'string'
    || !Array.isArray(body.paths)
    || body.paths.length > maxCleanupPaths
    || !body.paths.every((path) => typeof path === 'string')
  ) {
    return failureAnswer({ status: 400, error: createApiError({ code: 'BAD_REQUEST', message: 'Invalid attachment cleanup request' }) });
  }
  try {
    await deps.store.deleteUnclaimed({ batchId: body.batchId, paths: body.paths });
    return jsonResponse({ status: 204, body: undefined });
  } catch (error) {
    return respondToUploadFailure({ deps, host, error, batchId: body.batchId, source: 'attachment-cleanup' });
  }
}
