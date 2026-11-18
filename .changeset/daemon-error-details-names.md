---
"@jini-ai/daemon": minor
"@jini-ai/core": minor
---

`POST /api/delegated-tool-calls` error answers for a tool the route's registry holds now carry `details: { toolId, inputNames, executionId? }`: the tool's id, the sorted property names its descriptor declares (at most 64) and the executor's id for the call. The names come from the descriptor, never from the caller's input. Answers about an unknown tool, a group id or an unknown run are unchanged. `@jini-ai/core/text/diagnostic-vocabulary` exports `schemaPropertyNames`.
