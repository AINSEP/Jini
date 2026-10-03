# DR-001: Database tools are bounded reads and protected operations

Status: recorded from existing design; no runtime changes.

## Context

A timeline is an audit read model, not a raw SQL console. Restores can discard later writes and belong to a separate recovery ceremony. Agents may plan and execute approved operations but cannot fabricate human confirmation.

## Decision

Expose filtered, capped ledger reads with no caller-supplied SQL or direct row-edit surface. Database tool catalogs may offer read-only migration planning and a properly gated execute path; confirmation belongs to authenticated human exchange. Keep restore in the recovery boundary. Restore-point creation checks capabilities and requires explicit cost acknowledgement for expensive captures; unavailable mechanisms refuse without attestation override.

## Consequences and current limits

Timeline caps bound work. Capability checks are structural configuration checks, not proof that a live restore succeeds. Null captured watermarks stay unknown rather than becoming zero. Migration gateways, locks and confirmation transport are host composition, not capabilities of the portable read handlers.

## Defect prevented

A SQL/edit escape around authorized write services, an agent minting its own approval, an unavailable backup bypassed by a checkbox, or unknown recovery loss displayed as an exact zero.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/tools/timeline.ts](../../src/tools/timeline.ts), [src/tools/restore-points.ts](../../src/tools/restore-points.ts), [src/tools/database-catalog.ts](../../src/tools/database-catalog.ts).
