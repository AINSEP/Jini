---
"@jini-ai/daemon": minor
"@jini-ai/agent-runtime": minor
---

`AgentRuntimeStrategies` gains an optional `mcpBridge` slot (`prepare`): the CLI-specific permission preparation before an MCP bridge launch is now bound by the agent-runtime for the definition instead of selected by id inside the daemon. `resolveMcpBridgeForRun` takes the slot as `deps.mcpBridge` and no longer accepts `deps.ensureAntigravityMcpPermission`; the antigravity permission code moved to `@jini-ai/agent-runtime`'s `defs/antigravity`.
