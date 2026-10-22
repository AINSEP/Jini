# DR-002: Structural egress guard and bounded bodies

Status: recorded from existing design; no runtime changes.

## Context

Leaving SSRF validation to each feature adapter caused shared HTTP consumers to inherit different protection. DNS rebinding and IPv4-mapped IPv6 make URL-only or IPv4-only checks insufficient. Consumers also need response bytes without reaching past the guard.

## Decision

Provide a policy-enforcing client around the raw transport. Resolve and vet all addresses, normalize mapped IPv6 before classification, and pin an admitted address for connection while retaining hostname/TLS identity. Revalidate every redirect and strip cross-origin authentication headers. Enforce byte/time bounds, including decoded bodies, and expose byte-preserving guarded responses through the port.

## Consequences and current limits

Hosts choose explicit narrowing policy and development allowances. Raw transports are a trusted composition boundary, not a shortcut for domain code. Policy metadata alone does not prove all budgets are enforced; the current behavior spec lists DNS/idle/total-deadline and rate-limit limitations.

## Defect prevented

A second feature bypassing SSRF protection, mapped-IPv6 private addresses passing classification, redirect credential leakage, or a media consumer using raw fetch merely to obtain bytes.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/http/guarded/client.ts](../../src/http/guarded/client.ts), [src/http/guarded/__tests__/body-bytes.test.ts](../../src/http/guarded/__tests__/body-bytes.test.ts).
