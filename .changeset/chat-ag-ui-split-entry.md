---
"@jini-ai/chat": patch
---

`@jini-ai/chat/core/ag-ui` now holds only the chat-event to AG-UI projection. The reverse direction (`createAgUiToAgentTranslationState`, `translateAgUiEventToAgentEvent`, `AgUiToAgentTranslationState`) moved to the new subpath `@jini-ai/chat/core/ag-ui/reduction`. No behaviour change.
