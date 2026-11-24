/**
 * Accepted `ref` shape. `attachment:` matches the id `AttachmentStore.register` mints
 * (`` `attachment:${randomUUID()}` ``); the tail is deliberately the same `[A-Za-z0-9-]` allowlist
 * `attachmentSidecarFileName` reduces an id to, rather than a UUID-exact pattern, so a later change
 * to that id format does not silently start 404ing every attachment. Narrow enough either way: no
 * `.`, `/`, or `\` can appear.
 */
export const CHAT_ATTACHMENT_REF_PATTERN = /^attachment:[A-Za-z0-9-]{8,80}$/u;

/**
 * Which check refused a read. Internal diagnosis only — the HTTP layer maps every one of these to
 * the same 404 body (see this file's authorization doc), so nothing here reaches a caller.
 */
export type ChatAttachmentRefusal =
  | "malformed-ref"
  | "no-record"
  | "record-unreadable"
  | "record-outside-upload-root"
  | "not-owner"
  | "too-large"
  | "integrity";

export type ChatAttachmentReadResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly refusal: ChatAttachmentRefusal };

