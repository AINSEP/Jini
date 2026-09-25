/**
 * @module attachment-preview-cache
 *
 * Module-level cache from a `ChatAttachment.path` (the opaque `attachment:<uuid>` capability id
 * `useComposer.ts`'s `addAttachments` receives back from `project.uploadFiles`) to the original
 * browser `File` the operator picked. Exists so `AttachmentPreviewModal` can show a sent attachment
 * again — image or text — without a round trip to the server.
 *
 * **Why this has to exist at all.** `@jini-ai/http-kit`'s attachment store
 * (`packages/http-kit/src/attachments.ts`) has no read route: `register()`'s only output is an
 * opaque capability id meant for `claim()`/`resolveForRun` (server-side, run-scoped reads), and
 * `claim()` is one-shot. There is no `GET /api/attachments/:id` anywhere in this codebase, and
 * `cleanupRun` deletes a run's claimed files once it ends — so once a browser has sent an
 * attachment, the daemon can no longer hand its bytes back to that same browser even if asked.
 * The browser already had the bytes for free, at the moment the operator picked the file, so this
 * cache captures that one copy instead of trying to add a new authenticated download route to a
 * shared HTTP package as a side effect of a chat-transcript UI fix.
 *
 * **Scope of what this fixes.** Only the CURRENT page session: a reload starts this Map empty
 * again, same as `composer-draft-cache.ts`'s own module doc describes for drafts. That matches the
 * reported gap ("this is in the chat but we can never see it again") - within one open
 * conversation, not across a reload - and does not claim to solve the (separate, larger) problem of
 * persisting attachment bytes for a conversation loaded from storage.
 *
 * Same module-level-singleton shape and tradeoffs as `composer-draft-cache.ts`: partitioned by
 * `path`, which `http-kit` mints as a fresh `randomUUID()` per upload, so two unrelated attachments
 * can never collide on the key. Bounded by `MAX_CACHED_ATTACHMENT_PREVIEWS`, oldest-inserted evicted
 * first, so a long session attaching many files does not grow this map without limit.
 */

/** Cap on distinct attachments tracked at once; see the module doc. */
export const MAX_CACHED_ATTACHMENT_PREVIEWS = 50;

const sources = new Map<string, File>();

/**
 * Records `file` as the original bytes behind `path`, evicting the oldest tracked attachment first
 * if this would introduce a new entry past {@link MAX_CACHED_ATTACHMENT_PREVIEWS}.
 * @complexity Time/space: O(1) amortized.
 */
export function cacheAttachmentPreviewSource(path: string, file: File): void {
  if (!sources.has(path) && sources.size >= MAX_CACHED_ATTACHMENT_PREVIEWS) {
    const oldest = sources.keys().next().value;
    if (oldest !== undefined) sources.delete(oldest);
  }
  sources.set(path, file);
}

/**
 * Reads back the `File` cached for `path`, or `undefined` when this browser never staged it (a
 * different session, a reload, or eviction past the cap) - the only signal a preview needs to fall
 * back to an honest metadata view instead of pretending to render content it does not have.
 * @complexity Time/space: O(1).
 */
export function getAttachmentPreviewSource(path: string): File | undefined {
  return sources.get(path);
}

/** Test-only: empties the module-level cache so test cases cannot leak attachments into each other. */
export function __resetAttachmentPreviewCacheForTests(): void {
  sources.clear();
}
