---
"@jini-ai/daemon": minor
"@jini-ai/server": patch
---

The run routes are returned as data: `runRoutes({ deps, host })` replaces `registerRunRoutes`, `registerRunEventStream` and `handleRunEventStreamRequest` (removed, no alias). The event stream is a web `Response` built on core's SSE stream: a replay longer than the live-frame cap is delivered whole (replay frames are queued as backlog), the stream sends no heartbeat (as before), it still has no same-origin gate, and a failure after the stream was committed now also reaches the host's error sink (before, it only ended the stream). Internal failures go through the host's reporter (`RunHttpDeps.reportInternalError`, optional for a caller that runs a route's `handle` itself). A success answer carries a `Content-Length` and no `ETag`.
