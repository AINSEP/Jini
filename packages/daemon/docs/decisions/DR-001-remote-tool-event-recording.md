# DR-001: Remote tool execution records into the owning run

Status: recorded from the existing local incident notes; no runtime changes.

## Context

Tool execution and the run lifecycle may live in different processes. Without a recording boundary, a remote tool outcome never reaches the run event log that the conversation and reconnecting subscribers observe.

## Decision

Record tool-use and tool-result events through an explicit remote recording API into the owning run lifecycle. This API records an outcome; it does not execute the tool or grant permission. The caller executes through its own tool policy and the transport authenticates recording access.

## Consequences

The event shapes stay compatible with in-process delegated execution. Hosts supply a secured transport and correlation context; arbitrary event injection must not become authority to act or write another run. This removes a co-location requirement without creating another execution path.

## Defect prevented

A remotely executed tool succeeding while the owning conversation never receives its lifecycle events.

## Source and enforcement

The inherited local investigation was consulted. Historical archive locations remain outside this record. The original application decision archive was not recovered; this record preserves the limitation.

Evidence: [src/remote-tool-bridge.ts](../../src/remote-tool-bridge.ts).
