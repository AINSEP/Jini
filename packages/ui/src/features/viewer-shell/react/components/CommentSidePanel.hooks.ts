/** Submit a nonempty comment and clear its draft only when the host saved it. */
export function createCommentSubmitter({ draft, onDraftChange, createComment }: {
  draft: string; onDraftChange: (draft: string) => void; createComment: (note: string) => boolean | Promise<boolean>;
}, _options = {}) {
  return async () => {
    if (!draft.trim()) return;
    const saved = await createComment(draft.trim());
    if (saved) onDraftChange('');
  };
}
