# DR-002: Background error reporting must contain its own storage failures

Status: Documented local regression; original audit unavailable. Recorded 2026-10-02.

## Context

An asynchronous generation request can return before a vendor finishes. If the vendor fails after shutdown closes the task store, the error handler itself can fail while recording the failed state.

## Decision

Contain both the original asynchronous failure and any secondary failure while persisting its status. Report each through the injected internal-error hook without letting the failure handler reject unobserved. Background completion must remain observed after the HTTP response has returned.

## Consequences

Hosts own task-store lifetime and error reporting. The local regression documents a shutdown race; the original audit archive was not recovered, so this record makes no claim about its wider findings.

## Defect prevented

An unhandled rejection caused by a task-store write inside another error handler.

## Source and local evidence

The originating archive could not be recovered. This record preserves the rationale explicitly present in the local evidence; it makes no claim to reconstruct the missing decision. It introduces no behavior change.

- [packages/http-kit/src/__tests__/media.test.ts](../../src/__tests__/media.test.ts).
