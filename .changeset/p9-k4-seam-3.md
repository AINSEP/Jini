---
"@jini-ai/core": patch
"@jini-ai/diagnostics": patch
---

Move the tracker facade contract into core. `./contracts/site/diagnostics-observability` now owns `Tracker`, `TrackerErrorContext`, `TrackerSpan`, `OperationSpanOptions`, `RequestSpanOptions`, `AgentSpanOptions` and `CaptureEvent` (moved verbatim from `@jini-ai/diagnostics/observability`'s `tracker-types.ts`, overloads and comments preserved; the inline `TraceIds` reference now resolves through core's `contracts/observability`). Diagnostics keeps `createTracker`, `createNoopTracker`, `TrackerProviders`, `TrackerOptions` and its capture-only provider port, and imports the moved names from core. `@jini-ai/diagnostics/observability` still exports the six previously public names as a type-only re-export so this is not a breaking change; consumers should import them from `@jini-ai/core/contracts/site/diagnostics-observability`, and the re-export will be removed at the next major.
