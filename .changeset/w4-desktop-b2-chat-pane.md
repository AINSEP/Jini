---
"@jini-ai/chat": patch
---

Add `@jini-ai/chat/react/conversation-chat-pane`: `ConversationChatPane` composes `ConversationList` + `ChatPane` + an inline delete confirmation + a capture-phase folder drop. The host injects `useTransport`/`useConversations`/`useDeleteConfirmation` and every visible string through `labels`.
