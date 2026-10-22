# DR-002: Authorization before disclosure

Status: recorded from existing design; no runtime changes.

## Context

Ordinary commands, administrative tools and federated tools can expose the same mutation through different transports. Repeating permission logic at each surface lets policy drift; returning a duplicate result before authorization reveals an earlier operation to a caller who cannot perform it.

## Decision

Use one fail-closed evaluator for the actual operation. Check current authority before idempotency lookup, state disclosure or mutation. A wrapper inherits the guarded handler where one exists; a handler without an inherited gate must call the evaluator itself. Transport admission and operation authorization are separate boundaries. A second wrapper must not invent a contradictory permission vocabulary.

## Consequences and current limits

Consumers supply the evaluator and authenticate the principal at their composition boundary. Missing or ambiguous grants deny. Catalog filtering reduces tool visibility but never substitutes for authorization. Legacy optional wiring in some services is an integration limitation, not a guarantee of protection.

## Defect prevented

Unauthorized callers learning a prior change-set ID from duplicate handling, or a second tool policy disagreeing with the route that performs the same write.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [packages/user-management/src/server/authorize.ts](../../packages/user-management/src/server/authorize.ts), [packages/mcp/src/federation/registrations.ts](../../packages/mcp/src/federation/registrations.ts), [packages/cms/src/core/commands/command.ts](../../packages/cms/src/core/commands/command.ts).
