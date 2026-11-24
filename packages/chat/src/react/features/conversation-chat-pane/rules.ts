/**
 * Plain decisions for the conversation-chat-pane feature, kept out of the hook body so each is
 * testable as a function without a React renderer.
 */
import type { ChatPaneRunContext } from '../chat-pane/index.js';
import type { ConversationChatPaneConversations, ConversationListView } from './types.js';

/**
 * The picker's model/reasoning choice reaches the transport through `runContext`, not through
 * `startRun`'s own arguments: `ChatTransport.StartRunInput` carries `agentId` but nothing about how
 * that agent should be configured, and `context` is the port's designated opaque per-host payload.
 *
 * An unset `model` or `reasoning` is left out of the context entirely rather than sent as
 * `undefined`. `satisfies` rather than a `ChatPaneRunContext` annotation so the constant keeps its
 * callable type — `ChatPaneRunContext` is a union with a plain object, which a test cannot call.
 */
export const selectionRunContext = (({ selection }) => ({
  ...(selection.model === undefined ? {} : { model: selection.model }),
  ...(selection.reasoning === undefined ? {} : { reasoning: selection.reasoning }),
})) satisfies ChatPaneRunContext;

/**
 * The two values the pane derives from the host's conversations hook.
 *
 * `listItems` is a shallow copy: `ConversationListItem[]` (mutable) is `ConversationList`'s own prop
 * type, while a host's conversations hook may return `readonly` for consistency with its other
 * lists, so the boundary copies here rather than widening the host hook's contract for one caller.
 *
 * @complexity O(n) in the number of conversations (the copy).
 */
export function conversationListView(
  { conversations, activeId }: Pick<ConversationChatPaneConversations, 'conversations' | 'activeId'>,
  _optional: Record<string, never> = {},
): ConversationListView {
  return {
    listItems: [...conversations],
    conversationIdProp: activeId === null ? {} : { conversationId: activeId },
  };
}
