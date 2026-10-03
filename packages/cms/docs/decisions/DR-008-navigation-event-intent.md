# DR-008: Navigation mutations enqueue one event only on success

Status: Accepted; documents existing constraints. Recorded 2026-10-02.

## Context

Menu create, update, delete and location binding affect public navigation and downstream observers. A rejection must not emit evidence of a mutation that never occurred.

## Decision

Enqueue one created/updated/deleted event for the corresponding successful menu mutation, scoped to its workspace and actor. Trashing emits updated; purging emits deleted. Location assignment emits assigned and, only when replacing a prior binding, unassigned for the displaced menu. Refused version/validation/ownership checks enqueue nothing. Keep event intent with the write boundary; consumers deliver asynchronously and remain idempotent.

## Consequences

The host provides transaction and outbox composition. Recording intent is separate from successful downstream delivery, and repeated subscriber delivery must not repeat a visible effect.

## Defect prevented

Observers reacting to rejected navigation changes, missing successful change events and duplicate delivery effects.

## Source and local evidence

The originating rationale was reviewed and restated for any host. External provenance is maintained outside this repository. This record does not introduce a behavior change.

- [packages/cms/src/navigation/__tests__/menu-service.test.ts](../../src/navigation/__tests__/menu-service.test.ts).
