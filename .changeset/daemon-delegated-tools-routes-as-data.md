---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The delegated-tool route is returned as data: `delegatedToolRoutes({ deps, host })` replaces `registerDelegatedToolRoutes` (removed, no alias). The preset mounts the list through `mountRoutes`, and internal failures go through the host's reporter (`DelegatedToolsHttpDeps.reportInternalError`, optional: a caller running the route's `handle` itself still gets the http-kit reporter). Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
