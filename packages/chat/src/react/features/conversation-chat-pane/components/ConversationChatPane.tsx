import { ConversationList } from '../../../components/ConversationList.js';
import { ChatPane } from '../../chat-pane/index.js';
import { useConversationChatPane } from '../hooks/useConversationChatPane.hooks.js';
import type { ConversationChatPaneProps } from '../types.js';
import { ConversationChatPaneChat } from './ConversationChatPaneChat.js';
import { ConversationChatPaneHeader } from './ConversationChatPaneHeader.js';
import { ConversationDeleteConfirm } from './ConversationDeleteConfirm.js';

/**
 * `ConversationList` + `ChatPane` + inline delete confirmation + capture-phase folder drop, in one
 * `<aside>`. The host injects its transport/conversations/delete-confirmation hooks and every
 * visible string (`labels`); the pane ships no product copy.
 */
export function ConversationChatPane({
  onClose,
  labels,
  useTransport,
  useConversations,
  useDeleteConfirmation,
  variant,
  className,
  components: { ConversationList: Conversations = ConversationList, ChatPane: Chat = ChatPane } = {},
  useConversationChatPaneHook = useConversationChatPane,
}: ConversationChatPaneProps & { useConversationChatPaneHook?: typeof useConversationChatPane }) {
  const state = useConversationChatPaneHook({ useTransport, useConversations, useDeleteConfirmation });
  const rootClassName = className === undefined ? 'jini-conversation-chat-pane' : `jini-conversation-chat-pane ${className}`;
  return (
    <aside className={rootClassName} aria-label={labels.paneAriaLabel} onDropCapture={state.onDropCapture}>
      <ConversationChatPaneHeader state={state} labels={labels} onClose={onClose} Conversations={Conversations} />
      <ConversationDeleteConfirm deleteConfirmation={state.deleteConfirmation} labels={labels} />
      <ConversationChatPaneChat state={state} labels={labels} variant={variant} Chat={Chat} />
    </aside>
  );
}
