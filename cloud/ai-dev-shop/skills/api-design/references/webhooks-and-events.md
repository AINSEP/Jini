# Webhooks and Events

## Use When

- the producer should notify consumers asynchronously after a state change
- fan-out to multiple downstream consumers is required
- the consumer does not need the result inline with the initiating request
- push delivery is more appropriate than polling

## Do Not Use As A Substitute For

- synchronous command/reply workflows
- immediate confirmation that a business operation succeeded end to end
- internal domain events that were never designed for external consumption

## Contract Rules

- Use past-tense event names that describe facts, not commands. Example: `invoice.created`.
- Every delivery includes a stable event ID, event type, occurrence time, producer identifier, version, and payload.
- Define signing or authentication rules for every webhook endpoint.
- Define retry policy, backoff, duplicate-delivery expectations, and failure visibility.
- Define idempotency and deduplication behavior for consumers.
- Define ordering guarantees explicitly. Most webhook systems should assume at-least-once delivery and possible reordering.
- Define replay or redelivery strategy for missed events.

## Envelope Guidance

- Use a standard event envelope when multiple producers or platforms need a common shape.
- CloudEvents is the cleanest default when cross-platform interoperability matters.
- Keep business payload versioning separate from transport-specific headers or delivery metadata.

## Minimum Webhook/Event Review Questions

- Can the consumer process the same event more than once safely?
- Can the consumer prove authenticity of the sender?
- Does the producer expose delivery logs, replay, or redelivery for support incidents?
- Is the event truly a stable contract, or just an internal implementation detail leaking outward?

## References

- CloudEvents: https://cloudevents.io/
- OpenAPI Specification: https://spec.openapis.org/oas/latest.html
