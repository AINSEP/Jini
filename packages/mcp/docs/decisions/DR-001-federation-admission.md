# DR-001: Operator-owned federation admission

Status: recorded from existing design; no runtime changes.

## Context

Remote tool hints are self-reported and cannot confer authority. A separate operator write list is useful only if it cannot bypass the base allowlist. A picker that disagrees with the runtime gate teaches the operator the wrong security model.

## Decision

Check the operator allowlist before consulting write overrides or remote hints. Remote metadata may restrict a tool but never promote it. Keep destructive tools refused under the supported policy, even when both lists name them. Report write-list drift and every refusal. Build describe/admit/report views from one classification path. Host-installed preset hooks are composition data, not a third-party extension runtime.

## Consequences and current limits

Admission reports and tool registration agree by construction. Each admitted operation still reaches the same fail-closed authorization evaluator as its equivalent route. Memory adapters exercise the seam but do not imply durable trust/configuration storage.

## Defect prevented

A tool gaining authority by claiming read-only, a write-list entry bypassing the allowlist, or an admin view showing a tool as admitted while the runtime denies it.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/federation/trust.ts](../../src/federation/trust.ts), [src/federation/refusal-notice.ts](../../src/federation/refusal-notice.ts), [src/federation/registrations.ts](../../src/federation/registrations.ts).

Related: [shared decision](../../../../docs/decisions/DR-002-single-authorization-boundary.md).
