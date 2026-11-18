---
"@jini-ai/daemon": patch
---

The surface helpers answer with a web `Response` instead of writing to an Express `res`. `restoreSurface({ store, exchangeId, principalId, toolId, scheduler, signal }, { params })` replaces `tryRestoreSurface` (removed, no alias) and returns `{ handled: false }` (nothing written; the caller may fall back) or `{ handled: true, response }`; the first card frame opens the newline-delimited JSON answer and starts the 15 s keepalive on the host's scheduler. `deliverSurfaceCallback` takes `scheduler` and `signal` instead of `res` and returns the `Response` (403, 409 and 202 bodies unchanged; a restored card streams). `createLineStream` takes the caller's `signal` instead of the whole request.
