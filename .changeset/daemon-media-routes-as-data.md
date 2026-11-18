---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The media routes are returned as data: `mediaRoutes({ deps, host })` replaces `registerMediaRoutes` (removed, no alias). The preset mounts the list through `mountRoutes`, and internal failures go through the host's reporter (`MediaHttpDeps.reportInternalError`, optional: a caller running a route's `handle` itself still gets the http-kit reporter). Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
