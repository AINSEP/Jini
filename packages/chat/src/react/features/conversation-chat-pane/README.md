# conversation-chat-pane

`ConversationChatPane` (`@jini-ai/chat/react/conversation-chat-pane`): one `<aside>` that composes
`ConversationList` (the thread switcher, which doubles as "New thread") with `ChatPane`, an inline
delete confirmation (never `window.confirm`), and a capture-phase folder drop that writes a dropped
folder's path into the composer as text (`@jini-ai/ui/core` `captureFolderPathDrop`; quoted when the
path has whitespace).

- `components/` — `ConversationChatPane` and its markup-only parts (header, delete confirm, chat).
- `hooks/useConversationChatPane.hooks.ts` — the pane's state; host hooks arrive as required args.
- `rules.ts` — `selectionRunContext` (model/reasoning into `runContext`) and `conversationListView`.
- `types.ts` — the structural host-hook return types, `ConversationChatPaneLabels`, props.

## Wiring

The host injects, with no defaults:

- `useTransport` → `ConversationChatPaneTransport` (`transport`, `runtimeAccess`,
  `workingDirectoryAccess`, `getPathForFile`, `uploadAttachments`; all `undefined` without a bridge).
- `useConversations` → `ConversationChatPaneConversations` (persisted threads, `activeId`, `paneKey`).
- `useDeleteConfirmation` → `ConversationChatPaneDeleteConfirmation` (inline confirm state).
- `labels: ConversationChatPaneLabels` — every visible string; the pane ships no product copy.
- optional `variant` (passed to `ChatPane`), `className` (added beside `jini-conversation-chat-pane`
  for a host skin), `components` (`ConversationList`, `ChatPane` stand-ins).

The host's desktop renderer composes it from its own transport/conversation hooks and copy. Markup
emits only `jini-conversation-chat-pane` and its `__head`, `__head-actions`, `__confirm`,
`__confirm-actions`, `__confirm-delete`, `__status` elements; styling is the host's.
