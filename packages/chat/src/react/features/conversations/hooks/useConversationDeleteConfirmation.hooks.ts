/**
 * @file A conversation-delete confirmation answered from an inline banner rather than a blocking
 * native dialog.
 */
import { useCallback, useRef, useState } from 'react';
import type { ConversationListItem } from '../../../components/ConversationList.js';
import type { ConversationDeleteConfirmationState } from '../types.js';

/**
 * `ConversationList` accepts a `confirmDelete` callback returning `boolean | Promise<boolean>` for
 * exactly this purpose — this one resolves it from a real user click on the host pane's own inline
 * banner (rendered from `pendingTitle`) rather than from a blocking native dialog.
 *
 * @param labels.untitled the title shown for an untitled conversation; defaults to `'Untitled'`,
 *   the same source key `ConversationList` renders.
 */
export function useConversationDeleteConfirmation(
  _required: Record<string, never> = {},
  { labels: { untitled = 'Untitled' } = {} }: { labels?: { untitled?: string } } = {},
): ConversationDeleteConfirmationState {
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);

  const confirmDelete = useCallback((item: ConversationListItem): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // An unresolved earlier prompt loses to a newer one rather than leaving two pending — the
      // user can only be looking at (and answering) one banner at a time.
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setPendingTitle(item.title ?? untitled);
    });
  }, [untitled]);

  const resolvePending = useCallback(({ confirmed }: { confirmed: boolean }) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setPendingTitle(null);
  }, []);

  return { pendingTitle, confirmDelete, resolvePending };
}
