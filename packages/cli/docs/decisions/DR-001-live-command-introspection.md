# DR-001: Introspection follows the live command tree

Status: recorded from existing design; no runtime changes.

## Context

Handwritten command documentation and agent schemas drift as flags and commands change. Introspection should report what the parser accepts, not a second manually maintained catalog.

## Decision

Derive command names, arguments, options and schemas from the live command tree and reshape the same data for supported output formats. Keep introspection pure and reject unsupported format requests through the caller's validation boundary.

## Consequences and current limits

New command wiring becomes visible without duplicating a catalog. Introspection describes the tree but does not execute commands or supply authorization for them.

## Defect prevented

An agent invoking a documented option that the parser no longer supports, or a newly added option remaining undiscoverable.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/__tests__/introspection.test.ts](../../src/__tests__/introspection.test.ts).
