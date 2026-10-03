# DR-004: Human UI resources stay outside model-visible tool results

Status: Accepted; documents existing constraints. Recorded 2026-10-02.

## Context

A tool return value is read by the calling model. Flattening a structured resource into text can expose a confirmation secret even when its author intended the resource only for a human renderer.

## Decision

Preserve supported protocol content envelopes and do not serialize embedded UI resources into generic JSON text. A host delivers confidential human surfaces through its separate event channel. When a response must feed the agent, keep the original tool call open until the human response resolves it; a detached dialog response otherwise never reaches the model or transcript.

## Consequences

Generic wrappers own safe envelope handling; a host owns surface delivery, authentication and exchange lifetime. Do not treat a wrapper fix as a working confirmation transport. Fail closed when no genuine human exchange exists.

## Defect prevented

A model self-approving its own confirmation, leaked resource secrets, and successful mutations whose result never reaches the conversation.

## Source and local evidence

The originating rationale was reviewed and restated for any host. External provenance is maintained outside this repository. This record does not introduce a behavior change.

- [packages/mcp/src/server/tool-protocol.ts](../../packages/mcp/src/server/tool-protocol.ts).
