# DR-001: Deterministic schema guards and index transitions

Status: recorded from existing design; no runtime changes.

## Context

Independent single-failure checks can all pass while a combined-invalid submission returns the wrong error. Likewise separate kind-change and queryability-change branches miss the case where both change. Generated DDL is a security boundary even after upstream validation.

## Decision

After authorization, registration checks key grammar, reserved legacy keys, field identifiers, closed field kinds, storage-only restrictions and the queryable cap in order, stopping at the first failure. Schema replacement rejects terminal tombstones and checks expected version before empty-field or per-field validation. Validate identifiers before DDL construction and obtain cast fragments from a fixed mapping. Resolve index state once from each field's before/after kind and queryable pair, including additions and removals.

## Consequences and current limits

Error precedence remains predictable under compound failures. An index should exist exactly when the final field is queryable and use its final kind. Current services commit rows/revisions before index effects; atomic schema-plus-DDL execution is a host integration responsibility. The vocabulary has expanded beyond the original scalar set; JSON remains storage-only.

## Defect prevented

A stale-version conflict masked by empty-field validation, a reserved key masked by another error, interpolated DDL injection, or a stale/missing index after simultaneous field changes.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/content-types/write-service.ts](../../src/content-types/write-service.ts), [src/content-types/index-provisioning.ts](../../src/content-types/index-provisioning.ts).
