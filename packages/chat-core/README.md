# @jini-ai/chat-core

Framework-free chat vocabulary and pure parsers for a chat/artifact frontend: the message and
run-event types, the `ChatTransport` port a host implements to reach a real agent runtime, and a
set of pure functions — transcript projection, partial-JSON decoding, tool-event dedup, todo
parsing, question-form parsing, and streaming `<artifact>`-tag recovery. Zero React, zero DOM or
Node built-ins, and no dependency on any product package. `@jini-ai/chat-react` builds its React
bindings on top of this package; a non-React host can consume it directly.

## Install

```sh
npm install @jini-ai/chat-core
```

No peer dependencies. `@jini-ai/agentic` is a regular dependency, pulled in for the
`CapabilityDef` vocabulary this package's `CHAT_CAPABILITIES` manifest is built from.

## What you get

- **Messages and run events** — `ChatMessage`, `ChatRole`, `ChatAttachment`, `AgentEvent` (the
  `status`/`text`/`thinking`/`tool_use`/`tool_result`/`usage`/`raw`/`ext` display-layer union) and
  its `ToolUseEvent`/`ToolResultEvent` narrowings, plus `ChatRunStatus`/`CHAT_RUN_STATUSES` and
  `isTerminalRunStatus`. Named `ChatRunStatus` rather than `RunStatus` (renamed 2026-07-29) because
  `@jini-ai/protocol` owns `RunStatus` for an unrelated, richer shape at the wire layer.
- **The `ChatTransport` port** — `ChatTransport`, `RunHandlers`, `StartRunInput`, `RunContext`,
  `FeedbackChange`, `OnFeedback`. The single seam a host implements once (SSE/fetch, WebSocket, a
  local daemon, an in-memory fake for tests) to start/reattach/stop a run and report feedback; pure
  types over `AbortSignal`, no transport implementation shipped here.
- **Tool-event handling** — `dedupeToolUsesById`, `deriveToolStatus`, `toRenderProps`, plus
  `ToolStatus`/`ToolRenderProps`.
- **Todos** — `TodoItem`/`TodoStatus`, `isTodoWriteToolName`, `parseTodoWriteInput`,
  `latestTodosFromEvents`, `unfinishedTodosFromEvents`, `latestTodoWriteInputFromMessages`
  (aliased as `latestTodoWriteInput`), `latestTodoWriteInputForPinnedCard`.
- **Question forms** — `QuestionForm`/`FormQuestion`/`FormOption`/`DirectionCard`/`QuestionType`,
  `parseQuestionForm`, `parsePartialQuestionForm` (streaming-safe), `splitOnQuestionForms`,
  `findFirstQuestionForm`, `stripTrailingOpenQuestionForm`, `hasUnterminatedQuestionForm`,
  `formatFormAnswers`, `formOptionLabelForValue`/`formOptionValueForLabel`.
- **Transcript projection** — `buildTranscript`, `latestUserPromptFromHistory`,
  `sanitizePriorAssistantTurn`.
- **Partial-JSON decoding** — `repairJsonPrefix`, `parsePartialJson`, for rendering a tool call's
  arguments while they are still streaming in.
- **Artifact-markdown utilities** (`util/`) — the streaming `<artifact>`-tag parser
  (`ArtifactEvent`), post-stream stripping/summarization, pre-write HTML structural validation,
  recovery of an artifact a model emitted outside the `<artifact>` protocol, pointer-reply
  detection ("see design.html"), and the sidecar `ArtifactManifest` create/serialize/parse/infer
  helpers (`ArtifactKind`, `ArtifactRendererId`, `ArtifactExportKind`, `ArtifactStatus`).
- **Chat capability manifest** — `CHAT_CAPABILITIES`, the seven `chat.*` verbs that are a genuine
  chat-product surface (as opposed to the generic `page.*` vocabulary in `@jini-ai/agentic`), plus
  a `CapabilityDef` re-export from `@jini-ai/agentic` kept for an older compatibility shim.

## Usage

```ts
import {
  buildTranscript,
  parsePartialJson,
  dedupeToolUsesById,
  isTerminalRunStatus,
  type ChatMessage,
  type ChatTransport,
} from '@jini-ai/chat-core';

const history: ChatMessage[] = [
  { id: '1', role: 'user', content: 'summarize this repo' },
  { id: '2', role: 'assistant', content: '', runStatus: 'running', events: [] },
];

const transcript = buildTranscript(history);

function onDone(finalEvents: ChatMessage['events'] = []) {
  const toolEvents = dedupeToolUsesById(finalEvents);
  console.log(toolEvents.length, 'tool calls,', isTerminalRunStatus('succeeded'));
}

// Implement once per host — a fetch/SSE adapter, a WebSocket adapter, or a test fake.
declare const myTransport: ChatTransport;
```

## What's swappable

`ChatTransport` is the whole point of this package's port: bind any implementation (SSE, fetch,
WebSocket, an in-memory fake) that satisfies its `startRun`/`reattachRun`/`fetchRunStatus`/
`stopRun`/`reportFeedback?` shape, and every consumer built on it (this package's own helpers,
`@jini-ai/chat-react`'s hooks) works unchanged. The parsers (`buildTranscript`, `parsePartialJson`,
the artifact-markdown suite) are pure functions with no injected seam — they are fixed logic, not
configuration points.

## Runtime

`jini.runtime: "universal"` — no Node or browser-specific APIs.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.
