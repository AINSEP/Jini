---
"@jini-ai/daemon": minor
"@jini-ai/agent-runtime": minor
---

Claude's filesystem policy, scratch config-dir staging, run-scoped MCP config file and subagent-start settings now live in `@jini-ai/agent-runtime` `defs/claude/` and reach the daemon through four new optional `AgentRuntimeStrategies` slots (`filesystem`, `configDir`, `mcpConfigFile`, `subagentStart`). The daemon no longer exports `prepareClaudeConfigDirIfNeeded`, `resolveSourceClaudeConfigDir` or `mergeMcpJsonContent`; `RUNTIME_STRATEGY_HOST_ENV_NAMES` now also lists `CLAUDE_CONFIG_DIR`, and `strategies.for({ def })` always carries the shared `filesystem` policy.
