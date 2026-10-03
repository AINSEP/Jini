# DR-005: Taxonomy validation, cycles and soft joins

Status: recorded from existing design; no runtime changes.

## Context

Hierarchy guards have already produced different errors when several conditions fail together. An immediate-parent cycle test misses self-parenting and longer loops. Polymorphic content joins also need explicit tenant ownership without pretending a database foreign key can validate every content kind.

## Decision

Validate content applicability before ownership and content lens checks. For hierarchy assignments, evaluate hierarchical mode before parent existence/same-taxonomy and then the full ancestor-chain cycle check; a null parent needs no hierarchy assignment. Keep legacy post/page applicability distinct from registry-owned custom-type policy. Refuse same-term merge during planning; disclose membership loss and use the gated-mutation port for merge. Membership assignment is idempotent and deliberately does not append taxonomy-definition revisions.

## Consequences and current limits

Full-chain cycle detection prevents arbitrary-depth loops; deterministic ordering preserves the compound flat-taxonomy/wrong-parent result. Orphan joins are inert on read and require host reconciliation. Workspace guards stay even when current adapters make failure unreachable. Some removal/reconciliation operations remain explicitly unimplemented, and revision absence for membership is deliberate.

## Defect prevented

Infinite hierarchy traversal, wrong compound-failure errors, unnecessary content reads for inapplicable types, cross-tenant membership, or an unconfirmed destructive merge.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/taxonomy/validation-chain.ts](../../src/taxonomy/validation-chain.ts), [src/taxonomy/write-service.ts](../../src/taxonomy/write-service.ts), [src/taxonomy/merge-term.ts](../../src/taxonomy/merge-term.ts).
