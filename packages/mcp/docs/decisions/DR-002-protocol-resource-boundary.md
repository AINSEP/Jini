# DR-002: Preserve structured tool-resource results

Status: recorded from existing design; no runtime changes.

## Context

Tool results may carry resource content and human-facing surfaces rather than plain text. Flattening a result into an agent message can expose secret-bearing content or lose the structure required to route a confirmation surface.

## Decision

Preserve well-formed content blocks as structured results. Resource classification, human-surface delivery and secret exclusion belong to the caller that knows the resource semantics, rather than a generic tool-result wrapper. Do not infer safe agent-visible text from an arbitrary resource block.

## Consequences and current limits

Generic protocol wrapping preserves structure without claiming to sanitize every resource. Hosts remain responsible for secret-safe surface payloads and the channel-neutral human exchange. The inherited incident no longer depends on a particular delete-token transport, but its generic leakage risk remains relevant.

## Defect prevented

Flattening a confirmation resource into visible text and exposing a secret or making the surface unusable.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/server/tool-protocol.ts](../../src/server/tool-protocol.ts).

Related: [shared decision](../../../../docs/decisions/DR-004-human-surfaces-model-results.md).
