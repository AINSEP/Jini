import { useCallback, type RefObject } from 'react';

/** Fill the pane-owned draft without sending, then focus its composer for editing.
 * @complexity O(pane controls) per selection; O(1) retained state.
 */
export function useChatPaneSuggestion({ rootRef, setDraft }: {
  rootRef: RefObject<HTMLElement | null>; setDraft: (draft: string) => void;
}, _options = {}) {
  return useCallback((suggestion: string) => {
    setDraft(suggestion);
    rootRef.current?.querySelector<HTMLTextAreaElement>('.jini-composer-input:not(:disabled)')?.focus();
  }, [rootRef, setDraft]);
}
