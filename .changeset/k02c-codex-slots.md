---
'@jini-ai/daemon': minor
'@jini-ai/agent-runtime': minor
---

Codex home staging and MCP delivery move out of the daemon into `@jini-ai/agent-runtime` (`defs/codex/`) behind one new optional `mcpHome` slot on `AgentRuntimeStrategies`. Removed daemon exports: `buildCodexMcpServerToml`, `buildCodexHomeConfigToml`, `resolveSourceCodexHomeDir`, `prepareCodexHomeIfNeeded`, `PreparedCodexHome`, `CodexMcpHomeOptions`, and the `codexHomeDir` option of `computeChildEnv` (now `stagedHome`). New: `prepareRunHomeIfNeeded`, `PreparedRunHome`, `RunHomeSeams`, and the `mcpHome` slot type. `CODEX_HOME` is now supplied through the runtime's `launch.hostEnvNames()`.
