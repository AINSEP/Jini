---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The routine routes are returned as data: `routineRoutes({ deps, host })` replaces `registerRoutineRoutes` (removed, no alias). The preset mounts the list through `mountRoutes`. Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
