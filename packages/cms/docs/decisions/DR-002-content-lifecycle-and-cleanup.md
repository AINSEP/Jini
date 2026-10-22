# DR-002: Terminal lifecycle and gated cleanup

Status: recorded from existing design; no runtime changes.

## Context

Irreversible deletion needs stronger evidence than an ordinary status change. A tombstoned key must not be reused while its old data and indexes still exist, and a rejected confirmation must never trigger local removal.

An entry type is tenant-owned, and schema and lifecycle changes must not silently expose foreign rows or stop operators from maintaining existing data. Deprecation is a wind-down state; tombstone is a terminal state with different write rules.

## Decision

Content types move active to deprecated and back, or deprecated to terminal tombstone. Cleanup planning checks tombstone state, retention and export-reference presence in that order. Delegate confirmation-token, actor and plan-staleness checks to the gated-mutation port before any local removal. Successful removal is scoped and transactional through the host adapter.

Creation resolves a same-workspace active owning type before validating fields. Existing-entry update, publish and unpublish reject tombstoned types but allow deprecated types. Validate the structured field envelope and field kinds against the current schema; on read, hide keys no longer declared. Import preserves transferred identity/state, checks expected version and forbids changing an existing entry's owning type. Writes retain revisions and optional watermark attribution through the host transaction.

## Consequences and current limits

Tombstoning and cleanup remain separate operations. The library checks export-reference presence rather than verifying an export artifact. It does not mint confirmations or establish the cleanup repository's tenant scope; the host must bind both correctly. Index and event effects are not automatically part of the row transaction.

Operators can maintain existing data while preventing new manual authoring against a deprecated type. Current shared update resolution tolerates a missing type, and event enqueue follows the row transaction; consumers must account for these limits rather than infer stronger ownership or outbox atomicity.

## Defect prevented

Resurrecting a tombstoned type, deleting after a failed gateway check, or running irreversible cleanup against the wrong tenant or without the required retention ceremony.

Cross-workspace type references, unsupported field payloads, silently moving an imported entry around the tombstone guard, or treating deprecation as a total ban on existing-entry maintenance.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/content-types/lifecycle.ts](../../src/content-types/lifecycle.ts), [src/content-types/cleanup.ts](../../src/content-types/cleanup.ts), [src/entries/write-service.ts](../../src/entries/write-service.ts), [src/entries/field-validation.ts](../../src/entries/field-validation.ts).
