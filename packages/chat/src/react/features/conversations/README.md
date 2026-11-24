# conversations

Persisted conversation threads behind an injected store. Subpath: `@jini-ai/chat/react/conversations`.

- `createConversationController({ bridge }, { log, onChange })` — framework-free controller: which
  thread is open, its transcript, and writing settled turns back, with every race guard (switch
  sequence, lazy adoption, tombstones for deleted threads) documented in place.
- `useStoredConversations({ getStore }, { log })` — the React binding; returns
  `UseStoredConversations<S>` (`conversations`, `activeId`, `paneKey`, `initialMessages`, `select`,
  `create`, `remove`, `rename`, `onMessagesChange`).
- `useConversationDeleteConfirmation({}, { labels })` — returns `ConversationDeleteConfirmationState`
  (`pendingTitle`, `confirmDelete`, `resolvePending`) for `ConversationList`'s `confirmDelete`,
  answered from an inline banner instead of a blocking native dialog.

## Wiring

The host injects:

- `getStore` — its store lookup, structurally a `ConversationStorePort<S>` (`listConversations`,
  `loadConversationMessages`, `createConversation`, `deleteConversation`, `renameConversation`,
  `saveConversationMessage`), e.g. a preload bridge over IPC; `S` is the host's own summary DTO.
- `log` — optional, referentially stable failure reporter; the host prefixes its own label.
- `labels.untitled` — optional title for untitled threads in the delete banner.

The host's desktop renderer composes these in its conversations hook (bridge lookup + log label)
and passes the results to its conversation chat pane.
