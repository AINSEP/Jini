import type { ComponentType } from 'react';
import type { ConversationListProps } from '../../../components/ConversationList.js';
import type { ConversationChatPaneLabels, ConversationChatPaneState } from '../types.js';

export interface ConversationChatPaneHeaderProps {
  state: Pick<ConversationChatPaneState, 'transport' | 'listItems' | 'conversations' | 'deleteConfirmation'>;
  labels: Pick<ConversationChatPaneLabels, 'eyebrow' | 'title' | 'close' | 'closeAriaLabel'>;
  onClose: () => void;
  Conversations: ComponentType<ConversationListProps>;
}

/** The pane's own title bar: eyebrow + title, the conversation switcher, and the close button. */
export function ConversationChatPaneHeader({ state, labels, onClose, Conversations }: ConversationChatPaneHeaderProps) {
  const { transport, listItems, conversations, deleteConfirmation } = state;
  return (
    <header className="jini-conversation-chat-pane__head">
      <div>
        <p>{labels.eyebrow}</p>
        <h2>{labels.title}</h2>
      </div>
      <div className="jini-conversation-chat-pane__head-actions">
        {/* The conversation switcher lives in the pane's own header, not `ChatPane`'s (see
            `header={<></>}` on the chat for why) — it doubles as the "New thread" affordance via its
            own "New" button, which creates a REAL conversation and switches to it rather than
            silently discarding whatever is on screen. */}
        {transport !== undefined && (
          <Conversations
            // A mutable copy of the hook's readonly list — see `conversationListView`.
            conversations={listItems}
            activeConversationId={conversations.activeId}
            onSelect={conversations.select}
            onCreate={conversations.create}
            onDelete={conversations.remove}
            onRename={conversations.rename}
            confirmDelete={deleteConfirmation.confirmDelete}
          />
        )}
        <button type="button" onClick={onClose} aria-label={labels.closeAriaLabel}>{labels.close}</button>
      </div>
    </header>
  );
}
