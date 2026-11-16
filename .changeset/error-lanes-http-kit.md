---
"@jini-ai/http-kit": minor
---

New `reportRouteInternalError` with `RouteInternalErrorContext`/`RouteInternalErrorSink`: one owner for route 500s. The context gains `logSource`, the default line prints the error class only, a throwing host sink is contained, and the 500 answer carries caller-given plain words plus the request ID. **Host action:** none required; a host `onInternalError` sink keeps receiving the original error.
