import { describeErrorForLog } from '@jini-ai/core/model-facing-tool-errors';
import { useRef, useState, type KeyboardEvent } from 'react';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../core/conversation-title.js';
import type { ConversationTitleEditorProps } from './ConversationTitleEditor.js';

/** Commit or cancel a draft once, even when keyboard activation also triggers blur. */
export function useConversationTitleEditor({ title, onCommit, onCancel }: Pick<ConversationTitleEditorProps, 'title' | 'onCommit' | 'onCancel'>, _options = {}) {
  const original = useRef(title ?? '');
  const [draft, setDraft] = useState(original.current);
  const finished = useRef(false);

  // Enter/Escape can unmount a focused input and cause blur; only the first completion may act.
  const finish = async ({ cancel = false } = {}) => {
    if (finished.current) return;
    finished.current = true;
    const next = draft.trim().slice(0, MAX_CONVERSATION_TITLE_LENGTH);
    if (cancel || !next || draft === original.current) {
      onCancel();
      return;
    }
    try {
      await onCommit(next);
    } catch (error) {
      console.error('[@jini-ai/chat] ConversationTitleEditor onCommit host effect failed:', describeErrorForLog({ err: error }));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void finish({ cancel: event.key === 'Escape' });
    }
  };
  return { draft, setDraft, finish, handleKeyDown };
}
