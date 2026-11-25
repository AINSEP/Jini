---
"@jini-ai/server": minor
---

`createLocalNodeDaemon` takes a new `errors` option (`{ reporter, observability }`). When given, every route the daemon mounts, its own features and `httpExtensions` alike, reports an unexpected failure as one incident with one `ERR-` ID, and a route that handles its own failure gets its ID from the same reporter. `mountRoutes` takes an optional `reporter` for failures the dispatcher answers itself. Without `errors` the daemon behaves exactly as before.
