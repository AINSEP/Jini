# DR-003: Store transfer uses explicit owner policy

Status: recorded from existing design; no runtime changes.

## Context

A storage migration can move content and chat data together, but the shared copier cannot know which schemas or tables a particular consumer owns. Embedding exclusions or application defaults in the engine would make the next consumer lose or copy the wrong data.

## Decision

Copy rows according to host-supplied schemas, mappings and exclusion policy. Keep connection/dialect mechanics inside adapters and selection policy at the composition boundary. A new target does not turn the copier into a generic SQL administration console or an owner of domain schema.

## Consequences and current limits

Hosts declare transfer coverage and own preflight, restore-point, cutover and recovery policy. The copier's current API/spec remains authoritative for transaction/failure details; this record does not promise automatic rollback across different stores.

## Defect prevented

A copied store missing a consumer's chat tables, or consumer-specific exclusions silently deleting another application's data.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/kernel/store-copy.ts](../../src/kernel/store-copy.ts), [src/tools/transfer-tools.ts](../../src/tools/transfer-tools.ts).
