---
'@jini-ai/daemon': minor
'@jini-ai/agent-runtime': minor
---

`AgentRuntimePort` gains `strategies.for({ def })` (tool-call receipts and the MCP env-content variable). A host that implements the port itself must supply it; `createAgentRuntimeBindings` already does. The daemon's `createCliToolCallReceiver` now takes the bound `strategy` instead of a CLI `kind`, and `resolveMcpBridgeForRun` / `buildMcpBridgeDelivery` take the bound `mcpDelivery`. The receipt adapters and config env-name constants moved into agent-runtime's defs.
