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
 * error. The route pack turns the `reason` into a status code and lets the `message` through only
 * for caller-safe rejections below 500. Classified server-side failures and unexpected errors are
 * redacted to a generic `INTERNAL_ERROR`, preserving the server-state disclosure boundary.
 */
export class AttachmentRejectedError extends Error {
  readonly reason: AttachmentRejectionReason;

  constructor({ reason, message }: { readonly reason: AttachmentRejectionReason; readonly message: string }, _optional: Record<string, never> = {}) {
    super(message);
    this.name = 'AttachmentRejectedError';
    this.reason = reason;
  }
}

/**
 * Accepted batch id shape. Deliberately narrow — long enough for a UUID, and admitting no `.`,
 * `/`, or `\`, which is what makes `resolve(uploadRoot, batchId)` provably a single
 * non-traversing path segment.
 */
export const BATCH_ID_PATTERN = /^[a-zA-Z0-9-]{8,80}$/u;
