# DR-005: Portable contracts and host composition

Status: recorded from existing design; no runtime changes.

## Context

A feature-owned transport or capability becomes misleading when other features need it. Ports that merely rename one provider are difficult to replace, and loading host extensions into library core couples every consumer to one application.

## Decision

Keep reusable contracts and policy in the engine, with effects supplied through ports and adapters. Public barrels define supported surfaces. Exercise seams with materially different implementations; where only one production adapter exists, document that limitation. Host-installed routing presets and registries are composition data, distinct from execution of untrusted extension code.

## Consequences and current limits

Hosts own their wiring, schemas and product policy. A memory double demonstrates a contract seam but does not prove production durability or sandboxing. New consumers can replace a provider without changing core decisions.

## Defect prevented

Feature-local infrastructure bypassed by a second consumer, or a registry incorrectly treated as a third-party plugin execution boundary.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [packages/mcp/src/federation/presets.ts](../../packages/mcp/src/federation/presets.ts), [packages/mcp/src/federation/testing/adapter.memory.ts](../../packages/mcp/src/federation/testing/adapter.memory.ts).
