# DR-001: Redirect normalization and development scope

Status: recorded from existing design; no runtime changes.

## Context

WHATWG URL parsing can strip controls and backslashes before a guard sees them. Allowing development HTTP for same-origin redirects also risks accidentally weakening cross-origin allowlists.

## Decision

Reject dangerous raw characters, userinfo and parse ambiguity before normalized origin comparison. An explicit development capability may establish an HTTP canonical origin, which permits only matching same-origin HTTP candidates. A candidate that fails that comparison must be HTTPS before any cross-origin allowlist is consulted.

## Consequences and current limits

Normalization and comparisons live in one registry policy. Hosts provide verified origins and explicit allowlists. The repository origin record explains why this boundary also governs diagnostics and canonical links.

## Defect prevented

Parser-normalized malicious URLs passing a guard, or a dev capability widening unrelated cross-origin redirects to HTTP.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/verified-origin/origin.ts](../../src/verified-origin/origin.ts).

Related: [shared decision](../../../../docs/decisions/DR-001-verified-origin-trust.md).
