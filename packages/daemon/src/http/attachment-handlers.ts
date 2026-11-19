import type { AttachmentStore, StoredAttachment } from './attachment-types.js';
import type { DaemonRouteHost } from './route-host.js';
import { type ApiError, createApiErrorResponse, createApiError } from '@jini-ai/protocol';
import { jsonResponse, readQuery, readJsonBody, statusForError } from '@jini-ai/core/contracts/server';
import { AttachmentRejectedError, REJECTION_STATUS, apiErrorForRejection, sanitizeAttachmentName } from './attachment-rejections.js';
import { type FileHandle, open, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { writeBoundedAttachmentBody } from './attachment-body.js';
import { detectAttachmentKind } from './attachment-signatures.js';


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
  const maxAttachmentBytes = deps.maxAttachmentBytes ?? 20 * 1024 * 1024;
  const query = readQuery({ request });
  const name = sanitizeAttachmentName({ requestedName: query.name });
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
