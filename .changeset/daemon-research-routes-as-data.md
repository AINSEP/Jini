---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The research route is returned as data: `researchRoutes({ deps, host })` replaces `registerResearchRoutes` (removed, no alias). The preset mounts the list through `mountRoutes`, and internal failures go through the host's reporter (`ResearchHttpDeps.reportInternalError`, optional: a caller running the route's `handle` itself still gets the http-kit reporter). Answers are unchanged except that a success carries a `Content-Length` and no `ETag`.
