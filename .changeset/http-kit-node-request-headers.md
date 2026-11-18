---
"@jini-ai/http-kit": minor
---

`@jini-ai/http-kit/node-bridge` exports `nodeRequestHeaders({ incoming })`, the loop the bridge already used to give a route handler its request headers. A host that builds a web request's headers itself (for a route of its own that calls code written for a web request) now reads a header exactly as the bridge does.
