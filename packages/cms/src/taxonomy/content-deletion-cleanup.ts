

export interface EntryTermsCleanupPort {
  deleteByContent(params: { workspaceId: string; contentType: string; contentId: string }): Promise<number>;
}

export interface OnContentDeletedRequired {
  event: { workspaceId: string; contentType: string; contentId: string };
  entryTerms: EntryTermsCleanupPort;
}

/** Content-deletion event subscriber. Best-effort (a missed event leaves an orphaned
 * `entry_terms` row that is inert on read; a periodic/boot reconciliation sweep — modeled by
 * re-invoking this same function for the orphan — is the backstop, never a hard failure). A
 * no-op for content with no
 * assigned terms, never an error. Repository failures are warnings through the optional
 * logger port; logger failure also cannot turn cleanup into a hard failure. Hosts should
 * wire the logger for diagnostics; legacy callers without it remain silent. */
export async function onContentDeleted(
  required: OnContentDeletedRequired,
  optional: {
    logger?: {
      warn(required: { message: string }, optional: { meta: { event: OnContentDeletedRequired["event"] }; error: unknown }): void | Promise<void>;
    }
  } = {}
): Promise<void> {
  const { event, entryTerms } = required;
  try {
    await entryTerms.deleteByContent({
      workspaceId: event.workspaceId,
      contentType: event.contentType,
      contentId: event.contentId,
    });
  } catch (error) {
    try {
      await optional.logger?.warn({ message: "content-deletion taxonomy cleanup failed" }, { meta: { event }, error });
    } catch {
      // Cleanup is best effort even when its diagnostic sink is unavailable.
    }
  }
}
