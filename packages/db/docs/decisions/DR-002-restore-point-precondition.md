# DR-002: Unavailable restore mechanisms have no attestation override

Status: Accepted; documents existing constraints. Recorded 2026-10-02.

## Context

Forward migration can destroy row data. An operator claim that an external backup exists is not a verifiable recovery mechanism, while expensive backups require informed cost acknowledgment.

## Decision

Classify restore-point capability as cheap, expensive or unavailable. Expensive creation requires explicit cost acknowledgment; unavailable creation refuses without an attestation escape. Keep restore operations separate from migration planning. Idempotent creation uses the host operation key and recorded capture state.

## Consequences

A host that cannot provide recovery cannot enable a destructive migration by adding an override checkbox. This portable package supplies restore-point handlers, not an entire confirmation or migration transport.

## Defect prevented

A migration proceeding without a usable recovery point or an unnoticed expensive backup operation.

## Source and local evidence

The originating rationale was reviewed and restated for any host. External provenance is maintained outside this repository. This record does not introduce a behavior change.

- [packages/db/src/tools/restore-points.ts](../../src/tools/restore-points.ts).
- [packages/db/src/tools/database-catalog.ts](../../src/tools/database-catalog.ts).
