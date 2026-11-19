---
"@jini-ai/daemon": minor
"@jini-ai/server": patch
"@jini-ai/http-kit": minor
---

Require an injected reporter for direct daemon HTTP handlers while route-list factories bind their host's reporter. Move Express run credential middleware to @jini-ai/http-kit/middleware and remove daemon production dependencies on Express and http-kit.
