---
"@jini-ai/mcp": patch
---

MCP: add `external/agent-tools`, `external/operations-tools`, `federation/external-mcp-admissions` and `external/external-mcp-host-copy`. The external MCP setup and diagnostics tool catalogs are `create…({ copy })` factories taking the host's settings-screen location and read-tool name; the operations services object also carries the host copy and the probe limiter, and the admissions reader is bound to the host's log formatter through `createServerAdmissionsReader`.
