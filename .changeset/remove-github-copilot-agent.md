---
"@jini-ai/agent-runtime": minor
"@jini-ai/daemon": minor
"@jini-ai/mcp": minor
"@jini-ai/ui": minor
"@jini-ai/core": patch
"@jini-ai/http-kit": patch
"@jini-ai/ui-kit": patch
"@jini-ai/vibecoding": patch
---

Remove the GitHub Copilot CLI agent: its def, `createCopilotStreamHandler`/`CopilotStreamEvent`,
account model discovery and the `@github/copilot-sdk` optional peer, the MCP installer's `copilot`
slug, and its icon. A saved `copilot` agent id no longer resolves (`getAgentDef` returns `null`).
CopilotKit/AG-UI is unrelated and unchanged.

Drop peers no runtime entry loads: `express` from core and http-kit (type-only imports; type
consumers keep `@types/express`), `vue` from ui-kit, `react-dom` from vibecoding.
