# DR-001: Gated mutation order and atomic redemption

Status: recorded from existing design; no runtime changes.

## Context

A destructive action needs an informed human decision on a current plan. Correct single-failure checks are insufficient: recomputing a stale plan before rejecting the wrong actor leaks state, and separate token reads/writes let concurrent callers both mutate.

## Decision

Keep plan read-only, confirmation human-controlled, and execution ordered: current authorization, token existence/status/expiry, actor identity, scope, live plan hash, atomic redemption, mutation. Unknown tokens share the expired-token result. Bind tokens to plan hash, scope and confirmer. Require tryRedeem to perform a single conditional transition across the store's concurrency boundary. Populate composite actor/delegator references and refuse workspace mismatch.

## Consequences and current limits

Hosts explicitly choose a positive finite token lifetime; this engine does not inherit a fixed application lifetime. A consumed token stays consumed if mutation fails, so compensation and retry policy belong to the host. Soft actor references carry attribution, not a cross-database foreign key or authentication proof. Live grant evaluation prevents cached confirmation-time authority surviving demotion.

## Defect prevented

Disclosing stale-plan state to a caller barred from redemption, token guessing gaining an issuance oracle, replay or racing redemption executing twice, or attributing a write to another workspace.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/gated-mutations/gateway.ts](../../src/gated-mutations/gateway.ts), [src/gated-mutations/token.ts](../../src/gated-mutations/token.ts).
