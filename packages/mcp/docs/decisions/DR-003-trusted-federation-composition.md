# DR-003: Federation presets compose trusted ports

Status: Accepted; documents existing constraints. Recorded 2026-10-02.

## Context

A convenient preset may resemble a plugin loader while actually constructing trusted hooks and registries. Confusing these mechanisms obscures which code is sandboxed and which permissions are enforced.

## Decision

Presets compose trusted host implementations through injected ports; they do not load arbitrary third-party code or provide sandbox isolation. Use memory and production adapters against the same federation seams. Route tool execution through the single host authorizer, preserving handler-owned gates instead of evaluating permissions twice.

## Consequences

Hosts retain transport, persistence and trust decisions. Explicit registries keep the federation mechanism swappable without implying that registration itself authorizes execution.

## Defect prevented

Treating a trusted preset as a sandbox, hidden provider coupling and inconsistent duplicate permission gates.

## Source and local evidence

The originating rationale was reviewed and restated for any host. External provenance is maintained outside this repository. This record does not introduce a behavior change.

- [packages/mcp/src/federation/presets.ts](../../src/federation/presets.ts).
- [packages/mcp/src/federation/registrations.ts](../../src/federation/registrations.ts).
- [packages/mcp/src/federation/testing/adapter.memory.ts](../../src/federation/testing/adapter.memory.ts).
