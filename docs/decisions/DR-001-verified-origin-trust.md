# DR-001: Verified origins across redirects and diagnostics

Status: recorded from existing design; no runtime changes.

## Context

Canonical links, browser diagnostics and redirects all need a trusted origin. An inbound Host or authority header is controlled by the request sender, and independent settings drift. URL parsers also normalize away characters that a security boundary needs to reject.

## Decision

Obtain canonical origins through the injected verified-origin registry. Reject malformed candidates, userinfo, backslashes, whitespace and controls before trusting normalized URLs. Compare normalized scheme, host and port. HTTP is allowed for same-origin only when the canonical origin comes from an explicit development capability; every cross-origin allowlist path remains HTTPS-only. Missing verification fails closed.

## Consequences and current limits

Hosts own verification and explicit destination allowlists. Diagnostics may join a relative path to the verified canonical origin, never to the incoming request host. Canonical-origin trust is distinct from third-party egress permission and from address-level SSRF protection.

## Defect prevented

Host-header poisoning, same-origin checks accepting parser-normalized malicious text, and a development HTTP exception accidentally permitting cross-origin HTTP.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [packages/http-kit/src/verified-origin/origin.ts](../../packages/http-kit/src/verified-origin/origin.ts), [packages/diagnostics/src/web-evidence/same-origin.ts](../../packages/diagnostics/src/web-evidence/same-origin.ts).
