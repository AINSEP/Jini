import { type ApiError, createApiError } from '@jini-ai/protocol';
import { basename } from 'node:path';


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

/** The subset of `AttachmentRejectionReason` a caller is allowed to see a real message for. */
export const REJECTION_STATUS: Readonly<Record<AttachmentRejectionReason, number>> = {
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
export function apiErrorForRejection(error: AttachmentRejectedError): ApiError {
  const status = REJECTION_STATUS[error.reason];
  if (status === 413) return createApiError({ code: 'PAYLOAD_TOO_LARGE', message: error.message });
  if (status === 429) return createApiError({ code: 'RATE_LIMITED', message: error.message });
  return createApiError({ code: 'BAD_REQUEST', message: error.message });
}

/**
 * Accepted batch id shape. Deliberately narrow — long enough for a UUID, and admitting no `.`,
 * `/`, or `\`, which is what makes `resolve(uploadRoot, batchId)` provably a single
 * non-traversing path segment.
 */
export const BATCH_ID_PATTERN = /^[a-zA-Z0-9-]{8,80}$/u;

/** Renders a byte cap the way a person would read it, for a message a user actually sees. */
export function formatByteLimit(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? `${megabytes} MB` : `${bytes} bytes`;
}

/**
 * Reduces an untrusted upload filename to a display-only basename over a conservative allowlist.
 * Never used as the name of the stored file — see this module's trust-model doc.
 */
export function sanitizeAttachmentName({ requestedName }: { readonly requestedName: unknown }, _optional: Record<string, never> = {}): string {
  if (typeof requestedName !== 'string') return 'attachment';
  return basename(requestedName).replaceAll(/[^a-zA-Z0-9._ -]/gu, '_') || 'attachment';
}
