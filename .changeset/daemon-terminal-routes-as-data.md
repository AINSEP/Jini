---
"@jini-ai/daemon": minor
"@jini-ai/server": patch
---

The terminal routes are returned as data: `terminalRoutes({ deps, host })` replaces `registerTerminalRoutes` and `registerTerminalEventStream` (removed, no alias). The output stream is a web `Response` on core's SSE stream with no heartbeat (as before). It is refused cross-origin before the session is touched, an unknown session answers a JSON 404, and an already-exited session's replay is delivered whole and then the stream ends (the deferred-end helper `createDeferredEndGate` is removed: ending a stream now keeps the frames already queued). The preset mounts the list. A success answer carries a `Content-Length` and no `ETag`.
