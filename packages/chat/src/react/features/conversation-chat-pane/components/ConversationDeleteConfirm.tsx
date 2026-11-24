import type { ConversationChatPaneDeleteConfirmation, ConversationChatPaneLabels } from '../types.js';

export interface ConversationDeleteConfirmProps {
  deleteConfirmation: ConversationChatPaneDeleteConfirmation;
  labels: Pick<ConversationChatPaneLabels, 'confirmDeleteAriaLabel' | 'deletePrompt' | 'cancel' | 'delete'>;
}

/**
 * The inline delete confirmation, rendered only while one is pending. Inline, not `window.confirm`:
 * a native modal blocks the whole renderer, and in a desktop shell that also freezes the IPC the
 * window answers on.
 */
export function ConversationDeleteConfirm({ deleteConfirmation, labels }: ConversationDeleteConfirmProps) {
  if (deleteConfirmation.pendingTitle === null) return null;
  return (
    <div className="jini-conversation-chat-pane__confirm" role="alertdialog" aria-label={labels.confirmDeleteAriaLabel}>
      <p>{labels.deletePrompt({ title: deleteConfirmation.pendingTitle })}</p>
      <div className="jini-conversation-chat-pane__confirm-actions">
        <button type="button" onClick={() => deleteConfirmation.resolvePending({ confirmed: false })}>
          {labels.cancel}
        </button>
        <button
          type="button"
          className="jini-conversation-chat-pane__confirm-delete"
          onClick={() => deleteConfirmation.resolvePending({ confirmed: true })}
        >
          {labels.delete}
        </button>
      </div>
    </div>
  );
}
