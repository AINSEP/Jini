---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The active-context routes are returned as data: `activeContextRoutes({ deps, host })` replaces `registerActiveContextRoutes` (removed, no alias; each call still builds its own store). The preset mounts the list through `mountRoutes`. Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
