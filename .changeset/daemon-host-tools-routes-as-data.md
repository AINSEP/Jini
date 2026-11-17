---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The host-tools routes are returned as data: `hostToolsRoutes({ deps, host })` replaces `registerHostToolsRoutes` (removed, no alias; the old positional open-in deps bag is now `deps`). The preset mounts the list through `mountRoutes`. Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
