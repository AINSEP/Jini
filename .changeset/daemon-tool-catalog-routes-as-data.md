---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The tool-catalog routes are returned as data: `toolCatalogRoutes({ deps, host })` replaces `registerToolCatalogRoutes` (removed, no alias). The preset mounts the list through `mountRoutes`. Answers are unchanged except that a success no longer carries an `ETag` and a conditional request is answered 200 in full, not 304.
