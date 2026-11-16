---
"@jini-ai/core": minor
"@jini-ai/mcp": minor
---

Hosted MCP config failures carry a typed `category` (`"reauth_required"`) next to their unchanged `reason`, declared as `ExternalMcpConfigFailure` in `@jini-ai/core/contracts/hosted-mcp`, so hosts branch on a type instead of matching reason wording.
