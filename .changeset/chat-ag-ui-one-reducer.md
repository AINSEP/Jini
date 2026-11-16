---
"@jini-ai/chat": patch
---

`@jini-ai/chat/core/ag-ui` no longer exports `reduceAgentWirePayload` or `RunAgentWirePayload`. Reduce daemon payloads with `translateRunAgentPayload` from `@jini-ai/chat/core/run-events`, the one reducer: it drops `tool_input_delta`, attaches the surface-exchange identity to an `mcp-ui` resource, and keeps tool correlation, media, outcome and the usage stop reason.
