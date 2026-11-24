import { ConversationList } from '../../../components/ConversationList.js';
import { ChatPane } from '../../chat-pane/index.js';
import type { ConversationChatPaneProps } from '../types.js';
import { ConversationChatPaneChat } from './ConversationChatPaneChat.js';
import { ConversationChatPaneHeader } from './ConversationChatPaneHeader.js';
import { ConversationDeleteConfirm } from './ConversationDeleteConfirm.js';

/**
 * `ConversationList` + `ChatPane` + inline delete confirmation + capture-phase folder drop, in one
 * `<aside>`. The host injects its transport/conversations/delete-confirmation hooks and every
 * visible string (`labels`); the pane ships no product copy. The pane's own state hook arrives as
 * the required `useConversationChatPaneHook` prop (normally `useConversationChatPane`), so the
 * component imports no custom hook and a host or test can substitute it.
 */
export function ConversationChatPane({
  onClose,
  labels,
  useTransport,
  useConversations,
  useDeleteConfirmation,
  captureFolderDrop,
  variant,
  className,
  components: { ConversationList: Conversations = ConversationList, ChatPane: Chat = ChatPane } = {},
  useConversationChatPaneHook,
}: ConversationChatPaneProps) {
  const state = useConversationChatPaneHook({ useTransport, useConversations, useDeleteConfirmation, captureFolderDrop });
  const rootClassName = className === undefined ? 'jini-conversation-chat-pane' : `jini-conversation-chat-pane ${className}`;
  return (
    <aside className={rootClassName} aria-label={labels.paneAriaLabel} onDropCapture={state.onDropCapture}>
      <ConversationChatPaneHeader state={state} labels={labels} onClose={onClose} Conversations={Conversations} />
      <ConversationDeleteConfirm deleteConfirmation={state.deleteConfirmation} labels={labels} />
      <ConversationChatPaneChat state={state} labels={labels} variant={variant} Chat={Chat} />
    </aside>
  );
}
