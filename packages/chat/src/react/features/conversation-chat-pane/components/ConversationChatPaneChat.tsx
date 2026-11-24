import type { ComponentType } from 'react';
import type { ChatPaneProps } from '../../chat-pane/index.js';
import { definedProps } from '../../../util/defined-props.js';
import { selectionRunContext } from '../rules.js';
import type { ConversationChatPaneLabels, ConversationChatPaneState } from '../types.js';

export interface ConversationChatPaneChatProps {
  state: ConversationChatPaneState;
  labels: Pick<ConversationChatPaneLabels, 'unavailable' | 'placeholder'>;
  variant: ChatPaneProps['variant'];
  Chat: ComponentType<ChatPaneProps>;
}

/** The chat itself, or the unavailable status line while the host has no transport/runtime access. */
export function ConversationChatPaneChat({ state, labels, variant, Chat }: ConversationChatPaneChatProps) {
  const { transport, runtimeAccess, conversations } = state;
  if (transport === undefined || runtimeAccess === undefined) {
    return <p className="jini-conversation-chat-pane__status">{labels.unavailable}</p>;
  }
  return (
    <Chat
      // Remounts the pane on a real conversation switch, never on the incidental `activeId` move a
      // lazy adoption makes mid-turn — see `paneKey`'s own doc on `ConversationChatPaneConversations`.
      key={conversations.paneKey}
      transport={transport}
      runtimeAccess={runtimeAccess}
      runContext={selectionRunContext}
      initialMessages={conversations.initialMessages}
      {...state.conversationIdProp}
      onMessagesChange={conversations.onMessagesChange}
      // Replaces `ChatPane`'s own default header (title + a "New thread" button wired to its own
      // `onReset`, which only clears the local transcript and writes nothing durable) with an empty
      // fragment — not `title`/`undefined` alone, since `resolveChatPaneHeader` falls back to the
      // default on `undefined` too. The real switcher and "New thread" action live in the pane's own
      // header instead, so a second title bar here would stack two headers rather than integrate.
      header={<></>}
      placeholder={labels.placeholder}
      workingDirectory={state.workingDirectory}
      onChangeWorkingDirectory={state.setWorkingDirectory}
      composerHandle={state.composerHandle}
      // `variant`, `workingDirectoryAccess` and `uploadAttachments` may be `undefined`; omit them then.
      {...definedProps({ source: { variant, workingDirectoryAccess: state.workingDirectoryAccess, uploadAttachments: state.uploadAttachments } })}
    />
  );
}
