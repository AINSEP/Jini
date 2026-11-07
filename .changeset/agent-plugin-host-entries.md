---
"@jini-ai/server": patch
"@jini-ai/agent-plugins": patch
"@jini-ai/user-management": patch
---

Add the opt-in entries `@jini-ai/server/agent-plugin-host` and `@jini-ai/server/hosted-mcp`, with optional peers on `@jini-ai/agent-plugins`, `@jini-ai/integrations`, `@jini-ai/mcp`, `@jini-ai/oauth`, `@jini-ai/plugins` and `@jini-ai/ui`. Add the entries `@jini-ai/agent-plugins/lifecycle/host-tools` and `@jini-ai/agent-plugins/lifecycle/mail`. `@jini-ai/user-management` declares `@jini-ai/oauth` as an optional peer. The new entries are empty for now; their contents arrive in later releases.
