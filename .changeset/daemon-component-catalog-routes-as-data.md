---
"@jini-ai/daemon": patch
---

The component-catalog routes are returned as data: `componentCatalogRoutes({ deps, host })` replaces `registerComponentCatalogRoutes` (removed, no alias). Answers are unchanged except that a success carries a `Content-Length` and no `ETag`. A new `gatedJsonRoute` helper builds a route-list entry from a JSON spec.
