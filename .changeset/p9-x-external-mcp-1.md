---
"@jini-ai/mcp": patch
---

Move host-neutral external MCP code from the host. `./external/agent-tools` holds the five-tool external MCP agent catalog (`externalMcpAgentToolCatalog`, `EXTERNAL_MCP_MANAGE_PERMISSION`), and `./external/built-in-connections` reads the desktop-managed server roster. Breaking for hosts: the roster env var is now `JINI_BUILT_IN_MCP_SERVER_IDS` (was the host-prefixed name).
