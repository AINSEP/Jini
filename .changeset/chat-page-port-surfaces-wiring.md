---
"@jini-ai/chat": minor
"@jini-ai/agentic": minor
---

`@jini-ai/chat`: the frontend session bridge takes `page?: ChatPagePort` instead of `pageDriver` (hosts bind a driver once; `ChatPagePort` is exported from `@jini-ai/chat/react`). The `createDomPageDriver`, `currentAgentPage` and `DomPageDriverOptions` re-exports are removed from `@jini-ai/chat/react`; import them from `@jini-ai/agentic/dom`. The A2UI and MCP-UI cards and agent-control WebMCP detection now read `ChatSurfacesProvider`, so `ChatPane` needs one above it. `@jini-ai/protocol` is a required dependency of chat. `@jini-ai/agentic/dom` adds `createDriverPagePort({ driver })`, a structural page port over a `PageDriver`.
