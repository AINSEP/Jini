---
"@jini-ai/daemon": patch
"@jini-ai/infra": patch
---

AI tracing no longer reopens a trace when `dispose()` runs while the underlying start is pending; `waitForTerminal()` observes its abort signal while a durable start append is still pending; the fenced-outbox conformance overlap case reports a synchronously throwing `awaitOverlap` hook as a barrier failure (contender settled, nothing unhandled) and `awaitOverlap` is documented.
