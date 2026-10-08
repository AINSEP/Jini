# DR-001: Submission validation, abuse controls and notification isolation

Status: recorded from existing design; no runtime changes.

## Context

A public form accepts untrusted data and stores personal information. Synchronous notification delivery would make an otherwise accepted submission depend on a mail provider; revealing disabled-form state also gives callers an unnecessary enumeration signal.

## Decision

Validate submissions against the addressed active form and retain only declared fields. Missing and disabled forms share the same public failure. A nonempty trimmed honeypot is accepted without storage or events; whitespace alone is not a trip. Apply rate limits per source-IP/form pair. Persist accepted rows and emit one submission event, then keep downstream notification work off the public response path. Separate management, submissions-read and submissions-delete authority.

## Consequences and current limits

Notification subscribers log suppression/failure without turning it into a public submission failure. Hosts supply durable storage/outbox and request context; asynchronous draining alone is not proof of durable delivery. Definition status changes preserve records until explicit purge.

## Defect prevented

Bot submissions persisted despite a honeypot, payload keys bypassing the schema, public requests blocked by slow mail, or management permission unnecessarily granting personal-data reads.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/submit-service.ts](../../src/submit-service.ts), [src/notify-subscriber.ts](../../src/notify-subscriber.ts).
