---
"@jini-ai/diagnostics": patch
---

Add `installGlobalErrorReporting` to `@jini-ai/diagnostics/observability`: window `error`/`unhandledrejection` listeners that cap what was thrown and hand `{ message, stack }` to a host sink, with a teardown.
