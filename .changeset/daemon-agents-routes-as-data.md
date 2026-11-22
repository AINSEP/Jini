---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The agent inventory routes are returned as data: `agentRoutes({ deps, host })` replaces `registerAgentRoutes` (removed, no alias). The preset mounts the list through `mountRoutes`. Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
