---
"@jini-ai/core": minor
"@jini-ai/daemon": minor
---

Tools may declare an `outputSchema`, and `createToolExecutor` (and `createAssistantToolExecutor`) accept an injected `outputValidation` that checks raw settled output before guidance, notes, truncation or the completed audit. `enforce` turns a mismatch into one fixed internal failure; `report` emits one value-free `TOOL_OUTPUT_SCHEMA_MISMATCH` diagnostic and keeps the result.
