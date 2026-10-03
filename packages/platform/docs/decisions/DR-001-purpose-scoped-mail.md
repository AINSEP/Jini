# DR-001: Disjoint mail lanes and durable notification gates

Status: recorded from existing design; no runtime changes.

## Context

Interactive authentication mail and background notification mail once shared an untyped purpose value, so the notification durability gate could not distinguish them. Unknown future values must not default to the less restrictive path.

## Decision

Use a closed, disjoint lane vocabulary. Only explicitly known interactive values choose the permissive interactive lane; legacy/unknown values resolve to notification. In production, require a ready durable path for the sending notification capability and return an observable structured refusal when it is missing. Resolve runtime mode once before sends and keep it stable for the decorator lifetime.

## Consequences and current limits

Local mode still classifies lanes for observability without introducing a production durability refusal. This local behavior does not waive explicit host mode validation or production readiness checks. Readiness is capability-specific; one ready durable route must not authorize unrelated notification senders.

## Defect prevented

A purpose collision letting background mail bypass durability checks, unknown lane values failing open, or environment mutation changing mail policy mid-process.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/mail/purpose-scoped-mailer.ts](../../src/mail/purpose-scoped-mailer.ts), [src/mail/__tests__/purpose-scoped-mailer.test.ts](../../src/mail/__tests__/purpose-scoped-mailer.test.ts).
