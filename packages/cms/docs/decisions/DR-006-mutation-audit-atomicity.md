# DR-006: Mutation, audit and completion-event boundaries

Status: recorded from existing design; no runtime changes.

## Context

A successful domain mutation without its change-set record cannot be audited or safely reverted. Independently enqueueing the completion event creates another crash window. A synchronous SQL transaction cannot safely contain arbitrary promise-returning port calls.

## Decision

Authorize before duplicate lookup. Capture the inverse before mutation and the resulting entity version afterward. Send the completion event in the optional event field of the change-set insert options so the adapter can co-persist header, items and outbox row. Where the mutation is outside that adapter transaction, retain compensating rollback when supplied. Revert uses the captured post-write version as its conflict guard.

## Consequences and current limits

Co-persistence of the completion event does not include every domain mutation. Without host transaction participation or rollback, a record failure can leave the domain write applied; failures outside the insertion catch may also escape compensation. Consumers must provide their required atomicity. The existing legacy document explains the synchronous-driver constraint but its old positional signature is historical; the current contract uses required and optional objects.

## Defect prevented

A mutation surviving without an audit record, an audit record surviving without its completion event, or revert overwriting a later edit.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/core/commands/command.ts](../../src/core/commands/command.ts), [src/core/commands/change-set.ts](../../src/core/commands/change-set.ts).

Related: [shared decision](../../../../docs/decisions/DR-002-single-authorization-boundary.md).
