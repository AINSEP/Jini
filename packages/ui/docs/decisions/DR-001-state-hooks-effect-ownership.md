# DR-001: Reusable navigation hooks own state while the host owns effects

Status: Documented local invariant; original archive unavailable. Recorded 2026-10-02.

## Context

A feature-local navigation hook controls tabs and modals but may be mounted independently by several consumers. Installing streams or reload effects there would duplicate work.

## Decision

Keep this hook free of transport effects. The single-instance host orchestrator reacts to tab changes and owns streams and OAuth subscriptions. See the repository decision on single-owner UI effects for the shared rule.

## Consequences

State remains reusable and independently inspectable. A host must supply one effect owner; extracting a hook does not transfer the side-effect lifecycle to every hook instance.

## Defect prevented

Double-fired reloads, repeated subscriptions and mismatched cleanup ownership.

## Source and local evidence

The originating archive could not be recovered. This record preserves the rationale explicitly present in the local evidence; it makes no claim to reconstruct the missing decision. It introduces no behavior change.

- [packages/ui/src/features/memory/react/hooks/useMemoryNavigation.hooks.ts](../../src/features/memory/react/hooks/useMemoryNavigation.hooks.ts).
