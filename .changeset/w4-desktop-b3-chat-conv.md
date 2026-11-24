---
"@jini-ai/chat": patch
---

Add `@jini-ai/chat/react/conversations` (`createConversationController`, `useStoredConversations`, `useConversationDeleteConfirmation`) for persisted conversation threads behind an injected store, and `@jini-ai/chat/react/bridged-chat` (`useBridgedChatTransport`, `createStagedAttachmentUploader`) for chat panes whose host reaches its runtime, working directories and attachment staging through one bridge instead of HTTP.
