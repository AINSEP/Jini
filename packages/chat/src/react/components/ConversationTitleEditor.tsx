import { useRef, useState } from 'react';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../core/conversation-title.js';
import { useT } from '../hooks/context.js';

export interface ConversationTitleEditorProps {
  title: string | null;
  onCommit: (title: string) => void | Promise<void>;
  onCancel: () => void;
  className?: string;
  'data-testid'?: string;
}

/**
 * Shared inline rename lifecycle. Enter/blur save once; Escape, empty and unchanged drafts cancel.
 * Snapshots the raw title on mount so a background title refresh cannot become a user edit.
 * Host failures are reported without leaving a rejected promise unhandled.
 * @complexity O(n) time/space to trim a draft of n code units; the saved title is bounded.
 * @example <ConversationTitleEditor title={title} onCommit={rename} onCancel={close} />
 */
export function ConversationTitleEditor({ title, onCommit, onCancel, className = 'jini-conv-rename', 'data-testid': testId }: ConversationTitleEditorProps) {
  const t = useT();
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
      console.error('[@jini-ai/chat] ConversationTitleEditor onCommit host effect failed:', error);
    }
  };

  return <input
    autoFocus
    className={className}
    aria-label={t('Rename chat')}
    data-testid={testId}
    maxLength={MAX_CONVERSATION_TITLE_LENGTH}
    value={draft}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onBlur={() => { void finish(); }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        void finish({ cancel: event.key === 'Escape' });
      }
    }}
  />;
}

export interface ConversationTitleProps {
  title: string | null;
  displayTitle: string;
  onRename: (title: string) => void | Promise<void>;
  disabled?: boolean;
}

/** Clickable title using the same editor as ConversationList; a host keys it by conversation ID.
 * @complexity O(1) outside the shared editor's draft normalization.
 * @example <ConversationTitle key={id} title={rawTitle} displayTitle={label} onRename={rename} />
 */
export function ConversationTitle({ title, displayTitle, onRename, disabled = false }: ConversationTitleProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return editing ? <ConversationTitleEditor title={title} onCancel={() => setEditing(false)} onCommit={(next) => {
    setEditing(false);
    return onRename(next);
  }} /> : <button type="button" className="jini-conv-title-button" aria-label={t('Rename chat')}
    title={displayTitle} disabled={disabled} onClick={() => setEditing(true)}>{displayTitle}</button>;
}
