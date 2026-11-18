---
"@jini-ai/server": minor
---

An `httpExtensions` entry now receives `routeHost` (the host object daemon route lists are built with) in its context, and `mountRoutes` is exported, so an extension can mount a `*Routes({ deps, host })` list from `@jini-ai/daemon/http` on the daemon's app.
