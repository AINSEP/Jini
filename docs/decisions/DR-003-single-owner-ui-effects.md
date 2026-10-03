# DR-003: Single ownership of navigation effects

Status: recorded from existing design; no runtime changes.

## Context

Memory navigation is reused by several UI surfaces. Placing the same effect in a rule helper and a hook lets one user action cause duplicate selection, navigation or transport work.

## Decision

Keep pure state/rule decisions separate from effects. Own navigation side effects in the feature hook and call them from one coordinated subscription path; helpers return decisions without repeating effects.

## Consequences and current limits

Hosts can replace ports without moving side effects into pure rules. Reused hooks need one owner for each effect rather than duplicate subscriptions in orchestration and helper code.

## Defect prevented

A navigation action firing twice after a seemingly harmless extraction or component refactor.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior. The original upstream decision archive was not recovered; the effect-placement rationale is preserved by the local hook and pure-rule split.

Evidence: [src/features/memory/react/hooks/useMemoryNavigation.hooks.ts](../../packages/ui/src/features/memory/react/hooks/useMemoryNavigation.hooks.ts).
