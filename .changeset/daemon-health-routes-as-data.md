---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The health, readiness and version routes are returned as data: `healthRoutes({ deps, host })` replaces `registerHealthRoutes` (removed, no alias). The preset mounts the list through `mountRoutes` at the same position (ahead of the body parser and the gates). Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
