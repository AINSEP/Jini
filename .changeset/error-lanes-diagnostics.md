---
"@jini-ai/diagnostics": minor
---

**Breaking signature:** `errorType(error)` is now `errorType({ error })`. The telemetry label (`error.type`, `exception.type`, span status text) keeps its old shape: an approved code (`ECONNREFUSED`, `SQLITE_CONSTRAINT`), else the class label. What changed is which values qualify: a code outside core's approved list and a custom class name (`PostgresError`) no longer print raw; they read as the class label, often `Error`. Stored log-source `error` fields are now class labels (`Error(ENOENT)`) rather than messages. **Host action:** update `errorType` callers to pass `{ error }`; if a dashboard or alert keys on a custom class or code, register it with `registerLoggableErrors` from `@jini-ai/core`.
