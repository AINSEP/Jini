---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The xAI routes are returned as data: `xaiRoutes({ deps, host })` replaces `registerXaiRoutes` (removed, no alias; each call still resolves its defaults once, so the routes of one call share one pending-auth cache and listener slot). The preset mounts the list through `mountRoutes`, and internal failures go through the host's reporter (`XaiHttpDeps.reportInternalError`, optional: a caller running a route's `handle` itself still gets the http-kit reporter). Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
