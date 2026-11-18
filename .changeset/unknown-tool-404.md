---
"@jini-ai/protocol": patch
"@jini-ai/core": patch
"@jini-ai/daemon": patch
"@jini-ai/mcp": patch
---

A tool id that is not registered answers `404 UNKNOWN_TOOL` on both delegated-tool gateways, with the closest registered ids in plain words, instead of `403 TOOL_OPERATION_DENIED` (read-only gateway) or `400 BAD_REQUEST` (unconstrained gateway). `@jini-ai/protocol` adds the `UNKNOWN_TOOL` code, `@jini-ai/core` adds `@jini-ai/core/tool-call-text` (`unknownToolSentence`), and the MCP-local unknown-tool answer uses the same sentence. A route mounted without a `toolRegistry` keeps the executor's `400`.
