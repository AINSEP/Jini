---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The daemon status routes are returned as data: `daemonStatusRoutes({ deps, host })` replaces `registerDaemonStatusRoutes` (removed, no alias). The preset mounts the list through `mountRoutes`. Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
