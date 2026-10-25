---
"@jini-ai/diagnostics": minor
---

PROTOTYPE (cloud/observability-1025, not for release): `ObservabilityPort` gains `trackOperation` (feature-level unit of work) and `reportError` (incident report, adapter-redacted). Breaking for hand-written port implementations: both methods are required. Noop stays zero-allocation; `describeReportedError` gives error-tracker adapters a redacted, capped type/message/stack.
