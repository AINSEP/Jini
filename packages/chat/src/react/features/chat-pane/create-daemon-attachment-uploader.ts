/**
 * @module create-daemon-attachment-uploader
 *
 * The client half of `@jini-ai/http-kit`'s attachment capability: a ready-made
 * `ChatPaneProps['uploadAttachments']` that talks to `POST`/`DELETE /api/attachments`.
 *
 * ```tsx
 * <ChatPane transport={transport} uploadAttachments={createDaemonAttachmentUploader({ baseUrl: daemonUrl, fetch })} />
 * ```
 *
 * That one line is the whole wire-up for composer drag-and-drop and the file picker — `ChatPane`
 * gates both on `uploadAttachments` being present (see `ChatPane.tsx`'s `resolveDropTargetProps`).
 *
 * **Why the client enforces quotas at all**, when the daemon enforces them anyway: a user who drags
 * in a 400 MB video should be told immediately, not after the browser has finished streaming it to
 * localhost. These checks are a courtesy, never the security boundary — the daemon re-derives every
 * one of them, and only its answer decides anything.
 *
 * **Bounded concurrency, preserved order.** Two workers pull from a shared index, so at most two
 * requests are in flight while results still land at their input positions. The first failure aborts
 * the rest and deletes whatever already landed, so a partly-uploaded turn never leaves files behind
 * on the daemon waiting for their TTL.
 *
 * **`content-type` is always `application/octet-stream`**, deliberately not `file.type`. The daemon
 * sniffs the real kind from the leading bytes and ignores this header entirely, so forwarding the
 * browser's guess buys nothing — and actively breaks things: a dropped `.json` file gets
 * `content-type: application/json` from the browser, which an app-wide `express.json()` on the
 * daemon then claims, draining the request stream before the upload route can read a byte. A fixed
 * octet-stream type is immune to every body parser.
 */
import type { ChatAttachment } from '@jini-ai/chat';
import type { ChatPaneAttachmentUploadOptions, ChatPaneProps } from './types.js';

export interface CreateDaemonAttachmentUploaderOptions {
  /** Per-file cap checked before any request is sent. Defaults to 20 MB, matching the route pack. */
  readonly maxAttachmentBytes?: number;
  /** Files per composer turn. Defaults to 10, matching the route pack. */
  readonly maxAttachmentCount?: number;
  /** Total bytes per composer turn. Defaults to 50 MB, matching the route pack. */
  readonly maxBatchBytes?: number;
  /** Abort deadline for one call, covering every file in it. Defaults to 30s. */
  readonly timeoutMs?: number;
  /** In-flight uploads. Defaults to 2 — enough to hide latency, few enough to stay ordered and cheap. */
  readonly concurrency?: number;
}

interface UploadResponse {
  attachment?: ChatAttachment;
}

/** Either error envelope a daemon may answer with: this package's `{ error }`, or a bare `{ message }`. */
interface ErrorResponseBody {
  error?: { message?: string };
  message?: string;
}

const DEFAULTS = {
  maxAttachmentBytes: 20 * 1024 * 1024,
  maxAttachmentCount: 10,
  maxBatchBytes: 50 * 1024 * 1024,
  timeoutMs: 30_000,
  concurrency: 2,
} as const;

const BATCH_USAGE_TTL_MS = 60 * 60 * 1_000;
const MAX_TRACKED_BATCHES = 100;

/** Renders a byte cap the way a person reads it, so the message a user sees says "20 MB". */
function formatByteLimit(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? `${megabytes} MB` : `${bytes} bytes`;
}

interface BatchUsage {
  count: number;
  bytes: number;
  touchedAt: number;
}

/**
 * Per-uploader running totals, so a user who drops three files and then two more is held to the
 * same per-turn quota as one who drops five at once. Bounded in both age and size: a composer that
 * is open for days must not accumulate one entry per turn forever.
 */
function pruneBatchUsage(batchUsage: Map<string, BatchUsage>, now: number): void {
  for (const [batchId, usage] of batchUsage) {
    if (now - usage.touchedAt >= BATCH_USAGE_TTL_MS) batchUsage.delete(batchId);
  }
  if (batchUsage.size >= MAX_TRACKED_BATCHES) {
    // Evicts oldest-first (a Map iterates in insertion order) until there is room for one more. A
    // Map at or above the cap is necessarily non-empty, so slicing its keys is total — expressed
    // this way rather than as a `keys().next().value` loop, whose `undefined` case could not happen
    // and so could never be tested.
    const excess = [...batchUsage.keys()].slice(0, batchUsage.size - MAX_TRACKED_BATCHES + 1);
    for (const batchId of excess) batchUsage.delete(batchId);
  }
}

/** Pulls the most useful message out of whichever error envelope the daemon used. */
async function messageForFailedUpload(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ErrorResponseBody;
    return body.error?.message ?? body.message ?? fallback;
  } catch {
    // A non-JSON body (an HTML error page from a proxy, an empty 502) tells the user nothing useful.
    return fallback;
  }
}

interface UploadQuota {
  readonly maxAttachmentBytes: number;
  readonly maxAttachmentCount: number;
  readonly maxBatchBytes: number;
}

/** Refuses a selection that would break a per-file, per-turn count, or per-turn byte quota. */
function assertWithinQuota({ files, current, incomingBytes, quota }: {
  files: readonly File[];
  current: BatchUsage;
  incomingBytes: number;
  quota: UploadQuota;
}): void {
  if (files.some((file) => file.size > quota.maxAttachmentBytes)) {
    throw new Error(`Each attachment must be ${formatByteLimit(quota.maxAttachmentBytes)} or smaller.`);
  }
  if (current.count + files.length > quota.maxAttachmentCount) {
    throw new Error(`You can attach at most ${quota.maxAttachmentCount} files to one message.`);
  }
  if (current.bytes + incomingBytes > quota.maxBatchBytes) {
    throw new Error(`Attachments for one message must total ${formatByteLimit(quota.maxBatchBytes)} or less.`);
  }
}

/** Forwards the composer's abort (including one that already happened) into `controller`; returns the unlink. */
function linkParentAbort({ controller, parent }: {
  controller: AbortController;
  parent: AbortSignal | undefined;
}): () => void {
  if (parent === undefined) return () => {};
  const abortFromParent = () => controller.abort(parent.reason);
  parent.addEventListener('abort', abortFromParent, { once: true });
  if (parent.aborted) abortFromParent();
  return () => parent.removeEventListener('abort', abortFromParent);
}

/**
 * Runs `concurrency` workers over a shared index, writing each result at its input position in
 * `uploaded`. Never rejects: the first failure is returned (and aborts the rest) instead.
 */
async function uploadInOrder({ files, concurrency, controller, uploaded, uploadOne }: {
  files: readonly File[];
  concurrency: number;
  controller: AbortController;
  uploaded: Array<ChatAttachment | undefined>;
  uploadOne: (file: File) => Promise<ChatAttachment>;
}): Promise<unknown> {
  let nextIndex = 0;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index];
      if (file === undefined) return;
      try {
        uploaded[index] = await uploadOne(file);
      } catch (error) {
        // Kept, not thrown: aborting stops the sibling worker, and the *first* failure is the one
        // worth reporting — the aborts it causes are noise.
        firstError ??= error;
        controller.abort();
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return firstError;
}

/** Throws the turn's first upload failure, else the abort that stopped it; returns when neither happened. */
function throwIfUploadFailed({ firstError, signal }: { firstError: unknown; signal: AbortSignal }): void {
  if (firstError !== undefined) throw firstError;
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('Attachment upload was canceled.');
  }
}

/**
 * Builds a `ChatPaneProps['uploadAttachments']` bound to one daemon.
 *
 * @param baseUrl Origin (or same-origin path prefix) the daemon's API is reachable at. Pass `''`
 * when the page is served through a proxy that already forwards `/api`.
 */
export function createDaemonAttachmentUploader({ baseUrl, fetch }: { baseUrl: string; fetch?: typeof globalThis.fetch }, options: CreateDaemonAttachmentUploaderOptions = {}
): NonNullable<ChatPaneProps['uploadAttachments']> {
  const quota: UploadQuota = {
    maxAttachmentBytes: options.maxAttachmentBytes ?? DEFAULTS.maxAttachmentBytes,
    maxAttachmentCount: options.maxAttachmentCount ?? DEFAULTS.maxAttachmentCount,
    maxBatchBytes: options.maxBatchBytes ?? DEFAULTS.maxBatchBytes,
  };
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const concurrency = options.concurrency ?? DEFAULTS.concurrency;
  const endpoint = `${baseUrl.replace(/\/$/u, '')}/api/attachments`;
  // Read per request rather than captured once, so a global installed after construction is used.
  const send: typeof globalThis.fetch = (input, init) => (fetch ?? globalThis.fetch)(input, init);
  // Per-uploader, not module-level: two panes pointed at two daemons must not share a quota.
  const batchUsage = new Map<string, BatchUsage>();

  async function uploadOne(file: File, batchId: string, signal: AbortSignal): Promise<ChatAttachment> {
    const query = new URLSearchParams({ batch: batchId, name: file.name });
    const response = await send(`${endpoint}?${query}`, {
      method: 'POST',
      // Fixed, not `file.type` — see this module's doc.
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
      signal,
    });
    if (!response.ok) {
      throw new Error(await messageForFailedUpload(response, `Could not attach ${file.name}`));
    }
    const body = (await response.json()) as UploadResponse;
    if (!body.attachment) {
      throw new Error(`The daemon did not return an attachment for ${file.name}`);
    }
    return body.attachment;
  }

  async function deletePartialUpload(
    batchId: string,
    attachments: readonly ChatAttachment[],
  ): Promise<void> {
    if (attachments.length === 0) return;
    try {
      // QUICK, not `uploadOne`'s own composed timeout: unlike the upload itself, this has no
      // caller-supplied signal to compose with and no large body — it is a small best-effort JSON
      // DELETE, and an unprotected `fetch` here would hang `uploadAttachments`'s rejection (the
      // `await` below) on a stalled daemon instead of surfacing `firstError` promptly.
      await send(
        endpoint,
        {
          method: 'DELETE',
          signal: AbortSignal.timeout(15_000),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ batchId, paths: attachments.map((attachment) => attachment.path) }),
        },
      );
    } catch {
      // Best effort by design: the daemon expires unclaimed uploads on its own, so a failed cleanup
      // costs disk until the TTL rather than leaking indefinitely. Never worth failing the turn for.
    }
  }

  return async function uploadAttachments(
    files: File[],
    uploadOptions?: ChatPaneAttachmentUploadOptions,
  ): Promise<ChatAttachment[]> {
    if (files.length === 0) return [];
    const now = Date.now();
    pruneBatchUsage(batchUsage, now);
    const batchId = uploadOptions?.batchId ?? crypto.randomUUID();
    const incomingBytes = files.reduce((total, file) => total + file.size, 0);
    const current = batchUsage.get(batchId) ?? { count: 0, bytes: 0, touchedAt: now };
    assertWithinQuota({ files, current, incomingBytes, quota });

    // Reserved up front and rolled back on failure, so two overlapping calls for the same turn
    // cannot each see the same free headroom.
    batchUsage.set(batchId, {
      count: current.count + files.length,
      bytes: current.bytes + incomingBytes,
      touchedAt: now,
    });
    const controller = new AbortController();
    const unlinkParentAbort = linkParentAbort({ controller, parent: uploadOptions?.signal });
    const timeout = globalThis.setTimeout(
      () => controller.abort(new DOMException('Attachment upload timed out', 'TimeoutError')),
      timeoutMs,
    );
    const uploaded: Array<ChatAttachment | undefined> = new Array(files.length);
    const settled = (): ChatAttachment[] =>
      uploaded.filter((attachment): attachment is ChatAttachment => attachment !== undefined);

    // The failure is captured rather than rethrown from inside the `try`, so that the timer/listener
    // teardown in `finally` has exactly two reachable paths (the turn succeeded, or it did not)
    // instead of a third that a rethrowing `catch` would create and nothing could ever exercise.
    let failure: unknown;
    let succeeded = false;
    try {
      const firstError = await uploadInOrder({
        files,
        concurrency,
        controller,
        uploaded,
        uploadOne: (file) => uploadOne(file, batchId, controller.signal),
      });
      throwIfUploadFailed({ firstError, signal: controller.signal });
      succeeded = true;
    } catch (error) {
      failure = error;
    } finally {
      globalThis.clearTimeout(timeout);
      unlinkParentAbort();
    }
    if (succeeded) return settled();
    // Roll the reservation back only after the daemon-side files are gone, so a retry of this turn
    // starts from a clean slate on both sides.
    await deletePartialUpload(batchId, settled());
    batchUsage.set(batchId, current);
    throw failure;
  };
}
