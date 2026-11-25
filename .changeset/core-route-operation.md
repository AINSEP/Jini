---
"@jini-ai/core": minor
---

Add an operation lifecycle and a reporter mode for JSON routes.

- `runOperation` now takes optional `observability`, `classify` (decide a resolved value: completed, refused, failed) and `settle` (claim a thrown abort as cancelled). It returns `{ ok, value | failure | cancelled, verdict }`. A throwing or rejecting `trackOperation`, a throwing `end` or a throwing reporter no longer turns success into an incident or rejects the call, and work is never retried.
- New helpers on `@jini-ai/core/errors/reporter`: `startOperation`, `endOnce`, `NOOP_OPERATION_TRACKER`, `OperationVerdict`, `OperationRunResult`.
- `record` and `describe` accept `attributes`. Only bounded labels pass (short `[\w.:/-]` strings, finite numbers); URLs, query strings, free text and any value containing a known secret are dropped.
- A reporter records one error object once: a second boundary that sees the same object gets the first error ID and writes nothing.
- `RouteHostContext.errors?: RouteErrorPorts` (`{ reporter, observability }`). With it, `jsonRoute` runs one `http.route` operation per request (registered pattern, method, status), lets `onError` answer first, keeps the original ID when the policy throws, and treats a disconnected client as cancelled. Without it the legacy path is unchanged.
- `ClientFacingError` now lives in its own module; it is still exported from `@jini-ai/core/contracts/server`.
