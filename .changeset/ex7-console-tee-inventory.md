---
"@jini-ai/diagnostics": patch
"@jini-ai/agent-runtime": patch
"@jini-ai/core": patch
---

`createRedactedOutputSink` accepts optional `retain` (a shared `RetainedOutputTail`) and `tailKeepChars`, keeping a bounded, interleaved tail of a child's redacted output for boot-failure messages. Add `@jini-ai/agent-runtime/inventory` (`createAgentInventory`, `summarizeAgent`: the cached, injected-probe agent-picker lister) and its types-only DTO owner `@jini-ai/core/contracts/agents/inventory` (`AgentInventorySummary`, `AgentInventoryOption`).
