---
"@jini-ai/daemon": minor
"@jini-ai/server": patch
---

The memory routes are returned as data: `memoryRoutes({ deps, host })` replaces `registerMemoryRoutes` and `registerMemoryEventStream` (removed, no alias). The change feed is a web `Response` on core's SSE stream with no heartbeat (as before); it is still refused cross-origin before anything is subscribed, and every listener it adds is removed in one place however the stream ends. The routes can be listed in any order: a literal segment is matched before `:id`. The preset and the reference web host mount the list. A success answer carries a `Content-Length` and no `ETag`.
