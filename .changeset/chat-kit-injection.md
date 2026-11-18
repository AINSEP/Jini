---
"@jini-ai/chat": minor
---

Chat's React components render through a host-supplied `ChatKit` (`ChatKitProvider`, `useChatKit`, same-name facades) instead of importing `@jini-ai/ui`, and its model-selection / native-tool policy arrives as a `ChatAgentPolicyPort` (`kit.agents`). Mount `<ChatKitProvider kit={...}>` at every React root that renders chat; `mountEmbedChat` now takes `kit`. `defaultChatPaneSelection`, `resolveChatPaneSelection` and `findChatPaneSendBlocker` take a required `policy`. `RecoveryPorts` gains a required `agentFailures: ChatAgentFailurePort`. The `./testing` storage suites use `@jini-ai/db/testing/*`.
