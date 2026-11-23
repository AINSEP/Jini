---
"@jini-ai/core": patch
---

Add three host-neutral contracts. `./contracts/site/chat-core` (`AgentEvent`, `ToolResultMediaBlock`) and `./contracts/site/core-run-events` (`RunAgentPayload`, `RunProtocolEventWire`, `TerminalOutcome`, `RunFrameOutcome`, `RunFrameCarry`) are additive copies of the declarations in `@jini-ai/chat/core` and `@jini-ai/chat/core/run-events`; `./contracts/site/core-commands` (`EntityReverter`, `RevertRegistry`) is an additive copy of the declarations in `@jini-ai/cms/core/commands`. The owning packages keep their identical declarations and exports until the paired cutover. `./contracts/site/assistant-mcp-services` (`ConversationToolApprovalStore`, `ConversationToolApprovalKey`) is the host's remembered-approval store port.
