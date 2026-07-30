# `@jini-ai/protocol`

The Jini wire contract: run, event, journal, registry, and error types shared by every other
package in the engine. Everything here is a plain TypeScript type/interface or a small `zod`
schema — there is no runtime behavior beyond a handful of pure helper functions
(`createApiError`, `isTerminalRunState`). Its only dependency is `zod`, and it must never import
another `@jini-ai/*` package, so every consumer — an HTTP route, a CLI renderer, an MCP tool, a
browser UI — can agree on the same `RunEvent`/`RunStatus`/`ApiError` shapes without pulling in
Node-only or product-specific code.

## Install

```sh
npm install @jini-ai/protocol
```

No peer dependencies. `zod` is a regular dependency, installed automatically.

## What you get

- **Run lifecycle** — `RunState`/`RUN_STATES`, `TERMINAL_RUN_STATES`/`isTerminalRunState`,
  `RunStatus`, and `RunCancelRequest` for an explicit cancellation contract.
- **Run events** — `RunEvent<Name, Payload>` (the transport-neutral envelope, not tied to SSE),
  `RunProtocolEvent`, and the concrete lifecycle/agent payloads (`RunStartPayload`,
  `RunChunkPayload`, `RunEndPayload`, `RunAgentPayload`).
- **Errors** — `ApiError`/`ApiErrorResponse`/`ApiValidationIssue`, `GENERIC_ERROR_CODES`/
  `GenericErrorCode`/`ApiErrorCode` (open union — a pack's own codes type-check without a kernel
  edit), `createApiError`/`createApiErrorResponse`, and `RunErrorPayload`.
- **Durable event log port** — `EventLog`, `EventLogEntry`, `EventLogAppendInput`,
  `EventLogReplayResult` (the async, dedupe-aware, gap-detecting log interface that
  `@jini-ai/daemon`'s in-memory implementation and `@jini-ai/sqlite`'s durable adapter both
  implement).
- **Agent catalog vocabulary** — `AgentDefinition`, `ModelProvider`, `ModelCatalogOption`,
  `CredentialStatus`, `AgentDiagnostic`/`AgentDiagnosticReason`/`AgentDiagnosticSeverity`,
  `AgentFixIntent` — what a coding agent, its model list, and its unavailability diagnostics look
  like on the wire, shared between `@jini-ai/agent-runtime` and any UI that renders a model
  picker or an agent-health card.
- **Registry schemas** — `zod` schemas + inferred types for a package registry's manifest,
  entries, versions, trust/signature metadata, and publish/search/doctor/yank request-response
  shapes (`RegistryEntrySchema`, `RegistryManifestSchema`, `ResolvedRegistryEntrySchema`,
  `RegistryBackend`/`RegistryBackendFactory`, etc.).
- **Journal** — `JournalEntry`/`JournalProvenance` for provenance-tagged records.
- **Run-context encoding** — `RunContextPayload`, `encodeRunContextRef`/`decodeRunContextRef`: a
  shared, optional `{prompt, history}` encoding for `RunCreateRequest.contextRef`, so a host
  driving a chat-shaped agent doesn't have to invent its own encoding (`contextRef` itself stays
  an opaque string as far as the kernel is concerned — using this helper is never required).
- **Common shapes** — `JsonValue`, `BoundedJsonConstraints`, `OkResponse`, `IdResponse`,
  `EntityResponse`/`EntityListResponse`, `Nullable`.

## Usage

```ts
import {
  createApiError,
  isTerminalRunState,
  type RunStatus,
  type RunEvent,
  type RunChunkPayload,
  type EventLogEntry,
} from '@jini-ai/protocol';

function handleEvent(evt: RunEvent<'stdout', RunChunkPayload>) {
  if (isTerminalRunState(status.state)) {
    // flush and close the transport
  }
}

const status: RunStatus = { id: 'run_123', state: 'running' } as RunStatus;

const err = createApiError('NOT_FOUND', 'run not found', { details: { runId: 'run_123' } });

function toEntry(e: EventLogEntry): { cursor: string; event: string } {
  return { cursor: e.id, event: e.event };
}
```

## What's swappable

This package defines contracts only — nothing to inject. `EventLog` is the one interface meant
to be *implemented* by other packages (`@jini-ai/daemon`'s in-memory log, `@jini-ai/sqlite`'s
durable adapter, `RegistryBackend`/`RegistryBackendFactory` similarly for a registry storage
backend) rather than by protocol itself, which only carries the shapes.

## Runtime

Universal — no Node/browser-specific APIs.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0.
