---
"@jini-ai/protocol": minor
"@jini-ai/agentic": minor
"@jini-ai/core": minor
"@jini-ai/ui": patch
"@jini-ai/chat": minor
---

Add `@jini-ai/protocol/a2ui` (types, parse functions and the reference interpreter; validators typed as `A2uiPropsValidator`, no zod in the API) and MCP-UI resource readers in `/mcp-ui`. Add `@jini-ai/core/contracts/capabilities`. `@jini-ai/agentic` drops its `./a2ui` subpath and capability names; `@jini-ai/ui` drops the a2ui protocol re-exports and the MCP-UI resource readers. `@jini-ai/chat` declares the surfaces port (`ChatSurfacesProvider`) and `ChatPagePort`.
