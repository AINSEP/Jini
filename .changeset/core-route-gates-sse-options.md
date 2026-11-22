---
"@jini-ai/core": patch
---

`@jini-ai/core/contracts/server` adds `sameOriginRefusal` (the same-origin check for hand-built routes, answering the standard 403 `Response` or `undefined`) and `withRouteMiddleware` (the per-route form of `withServerMiddleware`), and `createSseStream` takes `keepAliveMs: false` (no timer, nothing written while idle) and `send(..., { backlog: true })` (a replay frame that does not count against `maxQueuedEvents`).
