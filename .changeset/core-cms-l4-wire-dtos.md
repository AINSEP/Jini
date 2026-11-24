---
"@jini-ai/core": patch
"@jini-ai/cms": patch
---

The admin external-MCP and agent-plugin wire DTOs are declared once in Core (`@jini-ai/core/contracts/site/cms-external-mcp`, `@jini-ai/core/contracts/site/cms-agent-plugins`); the CMS route specs answer with them, and their helpers take object arguments. Wire bodies and statuses are unchanged.
