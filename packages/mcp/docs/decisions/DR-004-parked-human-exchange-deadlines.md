# DR-004: Parked human exchanges need explicit deadlines

Status: recorded from existing design; no runtime changes.

## Context

A delegated tool call that waits for a human can exceed a short transport default even while its confirmation is still valid. Delivery and the parked response traverse multiple hops, so a surface emitter alone cannot prevent premature timeout.

## Decision

Set the delegated-call timeout explicitly so the exchange's own deadline can operate within the outer agent/session ceiling. Emit the surface while the handler is parked. For informational input, return the answer; for a gated action, authenticate the out-of-band human answer, act server-side and return the outcome. Expiry, cancellation and no-answer produce an explicit result.

## Consequences and current limits

Deadline coordination belongs to the host and every transport hop. Engine documentation does not impose the originating application's numeric TTL. Removing a secret-bearing second-call token must not remove principal/scope/run binding or single-use exchange bookkeeping.

## Defect prevented

The inherited short delegated-hop default timing out before a human can answer, deadlocking a parked call before its surface is delivered, or moving human approval into model-controlled context.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/server/tools/__tests__/delegated-tool.test.ts](../../src/server/tools/__tests__/delegated-tool.test.ts).
