# DR-001: Bounded webhook retries

Status: recorded from existing design; no runtime changes.

## Context

Webhook destinations fail transiently, but unbounded retries can keep failed deliveries alive forever and amplify load. Delivery attempts need an explicit durable state model and a bounded retry policy.

## Decision

Keep the delivery attempt ceiling explicit; the inherited default is eight attempts. Treat retry eligibility and next-attempt scheduling as delivery state owned by the integration adapter, with destination access using the guarded egress port. Redelivery is an operator capability rather than a raw bypass of destination policy.

## Consequences and current limits

A bounded default limits amplification while retaining recovery from transient failure. Hosts own durable delivery storage, pacing and observability; the current behavior contract describes which adapter paths provide them. This documentation does not change the default.

## Defect prevented

A failed endpoint retried indefinitely, exhausting resources or multiplying duplicate side effects.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/webhooks/delivery.ts](../../src/webhooks/delivery.ts), [src/webhooks/__tests__/delivery.test.ts](../../src/webhooks/__tests__/delivery.test.ts).
