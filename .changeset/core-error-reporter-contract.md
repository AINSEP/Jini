---
"@jini-ai/core": major
---

Update the error reporter to use the observability port and report incidents with their error ID, label, operation, and tracker trace IDs. Read `OperationTracker.traceIds()` when the tracker provides it. Incident replies include the recovery action, and caller-facing refusals use the supplied fallback for `own-message` bindings.

Replace `ErrorReporterPorts.tracker` with `observability: Pick<ObservabilityPort, 'reportError'>`. Pass `operation` and `tracker` to `describe`, and pass `operation` to `record`. To bracket a unit of work with one operation tracker and one failure report, use `runOperation`.

`IncidentTrackerReport` and `createRecordingTracker` have been removed. Use `ErrorReport` from `@jini-ai/core/contracts/observability` and `createRecordingObservability` from `@jini-ai/core/errors/testing`. `createRecordingReporter().reports` now contains `ErrorReport` entries.
