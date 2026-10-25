---
"@jini-ai/diagnostics": minor
"@jini-ai/daemon": minor
---

Observability vendor adapters as provider subpaths: `@jini-ai/diagnostics/observability/opentelemetry` (moved from Tovu core) and `@jini-ai/diagnostics/observability/sentry`, each returning `{ port, dispose }` with optional peer SDKs. Review fixes: attribute strings and `Error.name` redacted and capped; fan-out isolates each adapter's tracker creation and end; Sentry root operations start fresh traces and never call `NodeClient#init()` or channel injection. `withToolCallObservability` exports a fixed label for unregistered tool ids and adds `user.id` (pseudonymous principal).
