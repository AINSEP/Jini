# DR-003: Permission renames add grants before retiring vocabulary

Status: Accepted; documents existing constraints. Recorded 2026-10-02.

## Context

A permission-catalog rename can strand old policies or erase unrelated grants if migration mutates the existing grant rows. It also needs to be safe across interrupted and repeated boot.

## Decision

For each deprecated permission, add only the corresponding missing replacement grants. Never delete or modify existing permission rows in the migration. Repeating the pass adds nothing already present. Catalog and gate cutover is a separate reviewed step, with deprecated vocabulary retained until consumers have migrated.

## Consequences

Existing unrelated grants and original grants survive failure and retry. An additive grant fan-out does not by itself prove that old runtime gates have been removed. See the repository permission-catalog migration record for retirement criteria.

## Defect prevented

Lost authorization on upgrade and destructive or non-idempotent grant migration.

## Source and local evidence

The originating rationale was reviewed and restated for any host. External provenance is maintained outside this repository. This record does not introduce a behavior change.

- [packages/user-management/src/server/permission-migrations.ts](../../src/server/permission-migrations.ts).
- [docs/decisions/permission-catalog-migration.md](../../../../docs/decisions/permission-catalog-migration.md).
