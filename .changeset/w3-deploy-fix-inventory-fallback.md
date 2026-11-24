---
"@jini-ai/agent-runtime": patch
---

`createAgentInventory` / `summarizeAgent`: the model-probe fallback idiom is now a required `orFallback` port on `AgentRuntimePorts` instead of a runtime import from `@jini-ai/core`.
