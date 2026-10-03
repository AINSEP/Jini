# DR-001: Browser evidence uses a verified origin

Status: recorded from existing design; no runtime changes.

## Context

A page-evidence tool performs privileged outbound work on behalf of a caller. If it reconstructs the origin from the inbound request host, an attacker can redirect that work and poison the evidence boundary.

## Decision

Join evidence paths only to canonicalOrigin from the injected registry, with same-origin validation. Preserve the actionable failure when a trusted origin is unavailable. Reuse the repository verified-origin policy instead of trusting request headers or a per-tool setting.

## Consequences and current limits

The host supplies verified-origin resolution. Evidence collection does not itself establish origin ownership or general network-destination trust. See the repository origin record for parsing and development capability rules.

## Defect prevented

Browser evidence fetched against an attacker-controlled Host value rather than the verified site.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/web-evidence/same-origin.ts](../../src/web-evidence/same-origin.ts), [src/web-evidence/collect-page-evidence.ts](../../src/web-evidence/collect-page-evidence.ts).

Related: [shared decision](../../../../docs/decisions/DR-001-verified-origin-trust.md).
