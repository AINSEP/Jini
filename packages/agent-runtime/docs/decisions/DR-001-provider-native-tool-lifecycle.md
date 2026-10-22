# DR-001: Provider adapters preserve native continuation and tool events

Status: Documented local incident rationale; original audit unavailable. Recorded 2026-10-02.

## Context

Similar chat APIs differ in continuation payloads and headers. Earlier local adapter notes describe a missing required header and a native tool loop that incorrectly reused another provider wire shape.

## Decision

Keep provider-specific required headers and endpoint semantics. Native tool-call arguments remain native objects where required, and synthetic event identifiers stay internal unless the protocol supports them. Emit tool-use events for resolved calls even when no executor is supplied. Associate tool results using the adapter declared native mechanism and preserve execution errors.

## Consequences

A shared-looking API is not proof of wire compatibility. The local adapter comments are incident evidence; the original external audit archive was not located. This record preserves that limitation rather than inventing missing findings.

## Defect prevented

Provider request rejection, missing tool lifecycle events and continuation payloads using an incompatible wire schema.

## Source and local evidence

The originating archive could not be recovered. This record preserves the rationale explicitly present in the local evidence; it makes no claim to reconstruct the missing decision. It introduces no behavior change.

- [packages/agent-runtime/src/providers/azure-chat.ts](../../src/providers/azure-chat.ts).
- [packages/agent-runtime/src/providers/ollama-chat.ts](../../src/providers/ollama-chat.ts).
