import type { Logger } from '@jini-ai/core/primitives';
import { useState } from 'react';
import { useConversationTitleEditor } from './ConversationTitleEditor.hooks.js';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../core/conversation-title.js';
import { useT } from '../hooks/context.js';

export interface ConversationTitleEditorProps {
  report?: Pick<Logger, 'error'> | undefined;
  title: string | null;
  onCommit: (title: string) => void | Promise<void>;
  onCancel: () => void;
  className?: string;
  'data-testid'?: string;
}

/** Hooks ConversationTitleEditor calls; defaults to the real ones, a test hands in fakes. */
export const defaultConversationTitleEditorHooks = { useT, useConversationTitleEditor };
export type ConversationTitleEditorHooks = typeof defaultConversationTitleEditorHooks;

/**
 * Shared inline rename lifecycle. Enter/blur save once; Escape, empty and unchanged drafts cancel.
 * Snapshots the raw title on mount so a background title refresh cannot become a user edit.
 * Host failures are reported without leaving a rejected promise unhandled.
 * @complexity O(n) time/space to trim a draft of n code units; the saved title is bounded.
 * @example <ConversationTitleEditor title={title} onCommit={rename} onCancel={close} />
 */
export function ConversationTitleEditor({ title, onCommit, onCancel, className = 'jini-conv-rename', 'data-testid': testId, hooks = defaultConversationTitleEditorHooks, report }: ConversationTitleEditorProps & { hooks?: ConversationTitleEditorHooks | undefined }) {
  const t = hooks.useT();
  const { draft, setDraft, finish, handleKeyDown } = hooks.useConversationTitleEditor({ title, onCommit, onCancel }, { report });

  return <input
    autoFocus
    className={className}
    aria-label={t('Rename chat')}
    data-testid={testId}
    maxLength={MAX_CONVERSATION_TITLE_LENGTH}
    value={draft}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onBlur={() => { void finish(); }}
    onKeyDown={handleKeyDown}
  />;
}

export interface ConversationTitleProps {
  report?: Pick<Logger, 'error'> | undefined;
  title: string | null;
  displayTitle: string;
  onRename: (title: string) => void | Promise<void>;
  disabled?: boolean;
}

/** Clickable title using the same editor as ConversationList; a host keys it by conversation ID.
 * @complexity O(1) outside the shared editor's draft normalization.
 * @example <ConversationTitle key={id} title={rawTitle} displayTitle={label} onRename={rename} />
 */
export function ConversationTitle({ title, displayTitle, onRename, disabled = false, useTHook = useT, report }: ConversationTitleProps & { useTHook?: typeof useT }) {
  const t = useTHook();
  const [editing, setEditing] = useState(false);
  return editing ? <ConversationTitleEditor report={report} title={title} onCancel={() => setEditing(false)} onCommit={(next) => {
    setEditing(false);
    return onRename(next);
  }} /> : <button type="button" className="jini-conv-title-button" aria-label={t('Rename chat')}
    title={displayTitle} disabled={disabled} onClick={() => setEditing(true)}>{displayTitle}</button>;
}
