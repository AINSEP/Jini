---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The connectors routes are returned as data: `connectorsRoutes({ deps, host })` replaces `registerConnectorsRoutes` (removed, no alias). The preset mounts the list through `mountRoutes`, and internal failures go through the host's reporter (`ConnectorsHttpDeps.reportInternalError`, optional: a caller running a route's `handle` itself still gets the http-kit reporter). Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
