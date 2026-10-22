# @jini-ai/chat/core

> This README currently documents only the `./core` subpath — chat-core's own content, moved here
> verbatim. `./react` (formerly `@jini-ai/ui`'s `./chat` export) is landing in the same 2026-08-03
> consolidation; this file will be extended to cover it once that move is complete rather than
> rewritten twice. See the archived provenance ledger for `./core`'s own provenance.

Framework-free chat vocabulary and pure parsers for a chat/artifact frontend: the message and
run-event types, the `ChatTransport` port a host implements to reach a real agent runtime, and a
set of pure functions — transcript projection, partial-JSON decoding, tool-event dedup, todo
parsing, question-form parsing, and streaming `<artifact>`-tag recovery. Zero React, zero DOM or
Node built-ins, and no dependency on any product package. `@jini-ai/chat`'s `./react` subpath
builds its React bindings on top of this layer; a non-React host can consume `./core` directly.

Was `@jini-ai/chat-core`, its own top-level npm package (0.1.0–0.1.2), through 2026-08-03 — now
retired in favor of this subpath. See `../../index.ts`'s file doc for the migration note.

## Install

```sh
npm install @jini-ai/chat
```

```ts
import { ChatMessage } from '@jini-ai/chat/core'; // or the bare '@jini-ai/chat' alias
```

Core needs no optional peers. `@jini-ai/agentic` is a regular dependency, pulled in for the
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
} from '@jini-ai/chat/core';

const history: ChatMessage[] = [
  { id: '1', role: 'user', content: 'summarize this repo' },
  { id: '2', role: 'assistant', content: '', runStatus: 'running', events: [] },
];

const transcript = buildTranscript({ history });

function onDone(finalEvents: ChatMessage['events'] = []) {
  const toolEvents = dedupeToolUsesById({ events: finalEvents });
  console.log(toolEvents.length, 'tool calls,', isTerminalRunStatus({ status: 'succeeded' }));
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

See the archived provenance ledger for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.

## Durable transcript store

`@jini-ai/chat/store` exports the async `ChatStore`, its immutable owner scope, pages,
optional search capability contract, and `ChatStoreError`. It loads without SQL, drivers,
Node builtins or React. The existing eight-method `ChatHistoryStore` remains available
from core; existing hosts and fakes need no paging methods.

SQL adapters are explicit Node entries: `store/sqlite`, `store/pglite`, `store/postgres`.
They borrow the host's already-opened, migrated `@jini-ai/db` kernel. They do not open,
close, migrate or configure it. PGlite accepts embedded and socket transports. PostgreSQL
requires the node-postgres transport. Each entry rejects mismatched transport/dialect.
Install db and Kysely for these entries, and inject your own selected driver into db.
Core supplies the shared `Clock` contract. Pass `{ clock }` as the second factory argument
(`clock.nowMs()`); omitting it keeps system wall time. All three SQL dialects share the
same object-method contract. `list()` is a zero-argument read. `pageConversations({},
{ limit, cursor })` keeps paging in the optional bag; maintenance uses
`sweepExpired({ now }, { limit })`. Existing hosts and fakes must update positional methods.
All database and React peers are optional; Kysely dev tests pin 0.29.6 and PGlite 0.5.8.

```ts
import { createSqliteChatStore } from '@jini-ai/chat/store/sqlite';
const store = createSqliteChatStore({ kernel, scope: {
  scopeId: 'workspace', ownerKind: 'user', ownerId: 'account',
} });
const page = await store.pageConversations({}, { limit: 50 });
const conversation = await store.get({ id: 'conversation' });
await store.appendMessage({ conversationId: 'conversation', message });
await store.rename({ id: 'conversation', title: 'Title' }, { source: 'manual' });
```

The host authenticates and binds the scope; guest IDs must already be hashed. Every read
and mutation enforces all three scope fields, including paging. Missing and foreign IDs
have identical results. Duplicate creates throw a generic `conflict` without disclosing
ownership. Driver failures become `unavailable`, retaining the original cause.

Pages default to 50 and accept integer limits 1..200; invalid bounds and continuations
are structured errors. Conversation pages use `(updatedAt DESC, id ASC)`, message pages
`(position ASC, id ASC)`. ID ties use UTF-8 byte ordinal ordering (SQLite BINARY / PG C),
independent of locale. Opaque versioned cursors bind the owner, read kind and conversation;
validation happens before reading. Deleted anchors remain usable. Pages are live views:
activity can reorder conversations between calls, so a cursor does not promise a snapshot.
Each page selects at most limit+1 rows. Compatibility `list` and `messages` return all rows
and can cost O(N); new consumers should page.

Message upserts keep the original parent, position, role, agent identity and creation time.
They only persist existing ai_* columns; `resumable` and `lastRunEventId` remain absent.
Malformed optional JSON leaves text readable and the damaged value absent. No search
implementation is shipped: the optional capability is absent on every SQL adapter.

Appends join transactions on the exact injected kernel and acquire the conversation lock
before position allocation. A host ledger must share that kernel and take its run lock
before calling append; a second kernel for the same file cannot substitute for that context.

Separate privileged `createSqliteChatMaintenance` / PGlite / Postgres factories delete at
most 500 expired conversations per call (limits 1..500). The host schema supplies cascades;
SQLite borrowers must have foreign keys enabled. Stores never expose cross-owner maintenance.

SQLite also retains positional `createChatHistoryStore(db, scope, now?)` and
`createChatHistoryMaintenance(db)` wrappers over db's memoized borrowed kernel. The explicit
`ensureChatHistoryTables(db)` helper uses the unchanged DDL and is never called by a factory.
The temporary sqlite-chat entry delegates here; its richer local legacy model stays separate.

Postgres contract tests require `JINI_CHAT_TEST_POSTGRES_URL` naming a disposable
`jini_chat_test_*` database and fail if it is unavailable; use `pnpm run test:postgres`.
PGlite socket tests bind a local socket and must run on a host permitting that operation.

## Legacy local-project SQLite API

`@jini-ai/chat/store/legacy` exports the old `ChatSessionMode` vocabulary. `./store/legacy/sqlite`
exports the unchanged synchronous conversation/message CRUD and `LEGACY_CHAT_DDL`, receiving a
borrowed structural `SqliteDb`. This is the local single-user `conversations`/`messages` model,
separate from the owner-scoped `ai_chats`/`ai_chat_messages` ChatStore. Server storage composes its
schema with projects and rich daemon sessions. No chat constructor opens a driver or migrates a host DB.

## Design decisions

- [Queued page actions are consumed before execution](docs/decisions/DR-001-single-shot-page-actions.md).
- [Streaming adapters close message boundaries on interruption](docs/decisions/DR-002-stream-interruption-boundaries.md).
- [Human surfaces survive reconnect with honest status](docs/decisions/DR-003-human-surface-rehydration.md).

## Kernel contracts

Run finalization receives `Clock` from `@jini-ai/core/primitives` and reads `nowMs()`;
`RunActivityClock` remains a separate activity value object. Public core/React helpers receive
required argument objects: e.g. `isTerminalRunStatus({ status })`,
`assistantContentFromEvents({ events })`, `useRunStream({ transport })`, and
`registerExtEventRenderer({ name, renderer }, { slotKey })`. A slot-key callback receives `{ data }`.
`interleaveMessageBlocks({ events, content, rows }, { slotOf })` retains its reconstruction checks.
The isolated `core/run-events`, `core/ag-ui`, `server/run-finalizer`, `react/embed`,
`transports/fetch-sse`, `browser/session-store` and `browser/page-actions` subpaths are published.
`FrontendSessionBridgeArgs` is exported from `react`; hosts pass baseUrl and openStream, optionally request or native fetch.
The SSE transport takes an injected decoder; browser hosts must supply a browser-safe module.

## React integration boundaries

Model/provider selection belongs to the host-injected `ModelAgentPickerSlot`, because choosing
an LLM or agent is a provider concern rather than a chat-domain concern. The unused internal
picker was removed after a fresh caller check confirmed that only its own tests reached it.
It had already been removed from the public React barrel in August 2026; no public export changes.

The retired picker combined provider grouping, credential badges and a searchable trigger/popover
from earlier UI implementations. Its rules were independent of chat state and React; the hook
owned open/query state and outside-click/Escape subscriptions. Static host-supplied lists needed
no transport, while a host could inject a live-catalogue fetch. The popover rendered inline for
testability because chat had no positioning/collision primitive; hosts handled clipping with CSS.
Credential ordering preferred configured providers, preserving model order on ties. Unknown
providers received a fallback label rather than disappearing; unknown selected IDs remained custom
values, and auto-selection was opt-in. Search was omitted below eight options, blank search kept
all groups, and subtitles avoided repeating the provider label. Badge labels used host i18n;
the protocol catalogue type had a local alias to avoid an unrelated runtime model-type collision.

The unexported official MCP-UI proof of concept and its fixtures were also removed. It evaluated
the upstream resource builder and client through ESM: client 7.1.1's CommonJS entry failed in
the original experiment. Its pre-fetched HTML bypassed resource fetching; delivery still required
a sandbox proxy's readiness handshake. The jsdom probe checked iframe creation, sandboxing and
sizing rather than a live handshake, and jsdom dropped the client's `border: none` shorthand.
The live `McpUiSurfaceCard` delegates to `@jini-ai/ui/mcp-ui`, whose official client integration
owns the sandbox lifecycle. Chat therefore no longer declares either MCP-UI vendor dependency.
The distribution excludes both removed directories' compiled output, including stale files left
by a build over an existing `dist` directory.

## A2UI renderer integration

`A2uiSurfaceCard` composes the agentic interpreter with the shared core system clock and an
action-ID sequence. It preserves wall-clock timestamps and the existing
`a2ui-action-<sequence>-<base36 timestamp>` IDs. Catalog, registry and interpreter calls use
their required argument objects; React cleanup wraps the interpreter's object-argument
unsubscribe. Text values retain the catalog's validated wire shape through `DynamicValueSchema`.

Package typechecking includes `src/**/__tests__/**` so fixture API drift is reported alongside
production errors. Store contract fixtures use the typed chat store and storage kernel,
including fixture-owned host tables. Paging fixtures require a continuation before reusing it,
and stored message fixtures conform to the current event and attachment contracts. Development
declarations for jsdom and better-sqlite3 are provided by their `@types` dependencies.

## Browser fetch defaults

`createFrontendSessionBridge({ baseUrl, openStream, fetch?, request? }, options)`
uses native fetch by default, with a 15-second deadline. An explicit `request`
continues to take precedence. `createDaemonAttachmentUploader({ baseUrl, fetch? }, options)`
uses the same fetch for upload and partial-upload cleanup; omission uses
`globalThis.fetch`. Cleanup has its own 15-second abort deadline and does not
inherit the failed upload's cancellation. Upload quotas and its 30-second batch
deadline are unchanged. Browser timeout reasons remain native; platform is no
longer a dependency of this package.
