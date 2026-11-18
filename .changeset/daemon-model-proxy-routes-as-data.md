---
"@jini-ai/daemon": minor
"@jini-ai/server": patch
---

The model-proxy routes are returned as data: `modelProxyRoutes({ deps, host })` replaces `registerModelProxyRoutes` (removed, no alias). Each of the six routes is a web `Response`: a failure before the stream exists answers JSON (403 origin, 400 body or request, 500 with a request ID), and the provider call is not awaited before the stream is returned, so the stream opens at once and a client that leaves closes it. The routes read their own JSON body (limit from the host) and have no heartbeat (as before). The fixed paths and the `:provider` catch-all can be listed in any order. A success answer carries a `Content-Length` and no `ETag`.
