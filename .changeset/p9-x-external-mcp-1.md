---
"@jini-ai/mcp": patch
---

Move host-neutral external MCP code from the host. `./external/built-in-connections` reads the desktop-managed server roster and marks each server's ownership by exact id. Breaking for hosts: the roster env var is now `JINI_BUILT_IN_MCP_SERVER_IDS` (was the host-prefixed name). The external MCP agent tool catalog stays with the host: its model-facing descriptions name host tools and host screens.
