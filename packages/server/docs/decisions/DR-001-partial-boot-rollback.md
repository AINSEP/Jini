# DR-001: Partial boot rollback and readiness

Status: recorded from existing design; no runtime changes.

## Context

A module can acquire resources during prepare and then fail, or prepare successfully before its start fails. Stopping only modules that reached started leaves partial resources alive. Optional modules must not make the entire service unavailable.

## Decision

Run prepare in declaration order before start. The inherited design requires explicit rollback of acquired resources in reverse order. Each failing module owns its partial-acquisition cleanup contract. Record optional failures and continue. Distinguish process liveness from readiness of required capabilities; readiness state is a snapshot of lifecycle outcomes.

## Consequences and current limits

The current orchestrator unwinds completed preparations on prepare failure and completed starts on start failure. It does not call stop on the failing module, and prepared-but-unstarted modules after a start failure remain host-owned. Hosts must supply the remaining cleanup rather than infer full rollback from this record. Stop failures are contained. Status reporting is authenticated host wiring; liveness alone does not prove readiness.

## Defect prevented

Resources leaked by a partially prepared or start-failing module, or a liveness endpoint incorrectly reporting functional readiness.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/lifecycle/boot-lifecycle.ts](../../src/lifecycle/boot-lifecycle.ts), [src/lifecycle/__tests__/boot-lifecycle.test.ts](../../src/lifecycle/__tests__/boot-lifecycle.test.ts).
