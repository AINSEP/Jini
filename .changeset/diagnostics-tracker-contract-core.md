---
"@jini-ai/core": minor
"@jini-ai/diagnostics": major
---

Tracker contract types (`Tracker`, `TrackerSpan`, `TrackerErrorContext`, `OperationSpanOptions`, `RequestSpanOptions`, `AgentSpanOptions`, `CaptureEvent`) move to `@jini-ai/core/contracts/site/diagnostics-observability`. `@jini-ai/diagnostics/observability` now exports only `TrackerOptions` and `TrackerProviders` as types; import the moved names from core.
