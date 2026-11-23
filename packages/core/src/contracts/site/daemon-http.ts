/**
 * @file The daemon HTTP pack's pending-attachment summary and frontend-hook input, as types only.
 *
 * An additive copy of the declarations in `@jini-ai/daemon/http` (`attachment-types.ts`,
 * `attachment-records.ts`, `frontend-hook-input.ts`); that package keeps its identical
 * declarations and exports until the paired cutover.
 */

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

/**
 * What `listPendingForOwner` hands back for an unclaimed or same-run claimed attachment: enough for a caller to
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

/**
 * What a frontend host hook may read: the request's method and headers (a web `Request` is one),
 * and the per-request values the host's own adapter put in `locals`. Never the socket peer:
 * which address counts as "the client", and whether the request was HTTPS, is host policy
 * (proxy trust), so the host computes it and passes it in `locals`.
 */
export interface FrontendHookInput {
  readonly request: Pick<Request, 'method' | 'headers'>;
  readonly locals: Readonly<Record<string, unknown>>;
}
