Spec ID: SPEC-JINI-CHAT-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:c49a4450951e87f0cd8d7b4915e49e6313f0142e2bc327119d3cd4d01db482c1
spec_mode: reverse_spec


# API contract: @jini-ai/chat

## Scope and calling convention

This contract describes the source behind `package.json` exports. Prefer `(required, optional = {})` when building consumer adapters. **Existing positional and single-object signatures below are the actual callable API; the two-object convention is not yet universal.** React components receive one props object. Type names refer to current exported declarations; base Clock/JSON/Result contracts are owned by core primitives.

## Entry-point registry

| Import suffix | Surface | Runtime/dependencies |
|---|---|---|
| package root, `/core` | Same framework-free vocabulary, parsers, transcript helpers, capability manifest and storage port types | No React or SQL driver |
| `/react` | Hooks, components, renderer registries, frontend bridge, compatibility pane exports | React; optional host adapters; browser globals for bridge |
| `/react/chat-pane` | Canonical pane composition and its helpers | React, supplied `ChatTransport` |
| `/react/styles/reference.css` | Opt-in structural CSS asset | CSS bundler; no callable API |
| `/store` | `ChatStoreError`, owner-scoped transcript/paging/search/maintenance types | Types and error class only |
| `/store/sqlite` | Kernel adapter, maintenance, compatibility wrappers, schema helper/DDL | Borrowed SQLite kernel/handle; `@jini-ai/db`, Kysely peers |
| `/store/pglite` | Kernel adapter and maintenance | Borrowed PostgreSQL-dialect kernel with `pglite` or `pglite-socket` transport |
| `/store/postgres` | Kernel adapter and maintenance | Borrowed PostgreSQL-dialect kernel with `node-postgres` transport |
| `/store/legacy` | `ChatSessionMode = 'design' \| 'chat' \| 'plan'` | Type only |
| `/store/legacy/sqlite` | Synchronous conversations/messages, mismatch error and `LEGACY_CHAT_DDL` | Borrowed `SqliteDb`; host authorization and schema |

## Core data and transport port

`ChatMessage` requires `{id: string, role: 'user' | 'assistant', content: string}`; optional fields are `agentId`, `agentName`, `events: AgentEvent[]`, `createdAt`, `runId`, `runStatus`, `resumable`, `lastRunEventId`, `startedAt`, `endedAt`, `attachments`. Timestamps are epoch milliseconds. `ChatAttachment` is `{path, name, kind: 'image' | 'file', size?, order?}`. `AgentEvent` is the discriminated `kind` union in [events.ts](../../src/core/events.ts), including text, tools, status, errors and extension events; preserve order and correlation IDs.

```ts
interface ChatTransport {
  startRun(input: StartRunInput, handlers: RunHandlers): Promise<{ runId: string }>;
  reattachRun(runId: string, handlers: RunHandlers, options?: { signal?: AbortSignal }): Promise<void>;
  fetchRunStatus(runId: string): Promise<ChatRunStatus | null>;
  stopRun(runId: string): Promise<void>;
  reportFeedback?(change: FeedbackChange): Promise<void>;
}
// StartRunInput: history, signal required; agentId, conversationId,
// attachments, opaque context, cancelSignal optional.
// RunHandlers: onEvent, onError, onDone required; onToolInputDelta optional.
```

The consumer implements network/authentication, cancellation, replay and status lookup. `signal` detaches the subscription; `cancelSignal` expresses explicit run cancellation. Feedback requires `messageId` and `rating: 'positive' | 'negative'`; `runId`, `reasonCode`, `note` are optional.

## Core functions

All functions below require only their listed values; no I/O collaborator is supplied. `E` below abbreviates `readonly AgentEvent[] | undefined`, and `M` abbreviates the message shape accepted by the referenced source.

| Current signature | Return |
|---|---|
| `isTerminalRunStatus({ status }: { status: ChatRunStatus \| undefined })` | `boolean` |
| `repairJsonPrefix({ buf }: { buf: string })` / `parsePartialJson({ buf }: { buf: string })` | `string` / `unknown` |
| `dedupeToolUsesById({ events }: { events: AgentEvent[] \| undefined })` | `AgentEvent[]` |
| `formatToolOutputForDisplay({ text }: { text: string })` | `string` |
| `deriveToolStatus({ result, runStreaming }: { result: ToolResultEvent \| undefined; runStreaming: boolean }, { runSucceeded = false }: { runSucceeded?: (boolean) \| undefined } = {})` | `ToolStatus` |
| `toRenderProps({ use, result, runStreaming }: { use: ToolUseEvent; result: ToolResultEvent \| undefined; runStreaming: boolean }, { runSucceeded = false }: { runSucceeded?: (boolean) \| undefined } = {})` | `ToolRenderProps` |
| `isTodoWriteToolName({ name }: { name: string })` / `parseTodoWriteInput({ input }: { input: unknown })` | `boolean` / `TodoItem[]` |
| `latestTodosFromEvents({ events }: { events: AgentEvent[] \| undefined })` / `unfinishedTodosFromEvents({ events }: { events: AgentEvent[] \| undefined })` | `TodoItem[]` |
| `latestTodoWriteInputFromMessages({ messages }: { messages: ReadonlyArray<{ events?: AgentEvent[] \| undefined }> \| undefined })`; alias `latestTodoWriteInput` | `unknown \| null` |
| `latestTodoWriteInputForPinnedCard(messages: readonly M[] \| undefined)` | `unknown \| null`; M includes events, runStatus, endedAt |
| `splitOnQuestionForms({ input }: { input: string })` | `FormSegment[]` |
| `findFirstQuestionForm({ input }: { input: string })` | `{form: QuestionForm; raw: string} \| null` |
| `parseQuestionForm({ input }: { input: string })` / `parsePartialQuestionForm({ input }: { input: string })` | `QuestionForm \| null` |
| `stripTrailingOpenQuestionForm({ input }: { input: string })` | `{text: string; hadOpenForm: boolean}` |
| `hasUnterminatedQuestionForm({ input }: { input: string })` / `isRenderableColor({ value }: { value: string })` | `boolean` |
| `formatFormAnswers({ form, answers }: { form: QuestionForm; answers: Record<string, string \| string[]> })` | `string` |
| `formOptionLabelForValue(question: {options?: FormOption[]}, value: string)` / `formOptionValueForLabel({ question, labelOrValue }: { question: { options?: FormOption[] \| undefined }; labelOrValue: string })` | `string` |
| `assistantContentFromEvents({ events }: { events: E })` / `legacyAssistantContentFromEvents({ events }: { events: readonly AgentEvent[] \| undefined })` | `string` |
| `mergeAdjacentTextEvents({ events }: { events: E })` | `AgentEvent[]` |
| `latestUserPromptFromHistory({ history }: { history: ChatMessage[] })` | `string` |
| `sanitizePriorAssistantTurn({ content }: { content: string }, { persistedArtifactFiles = [] }: { persistedArtifactFiles?: (ReadonlyArray<PersistedArtifactFileRef>) \| undefined } = {})` | `string` |
| `buildTranscript({ history }: { history: ChatMessage[] }, options: BuildTranscriptOptions = {})` | `string` |
| `deriveConversationTitle({ prompt }: { prompt: string })` | `string` |
| `humanizeToolName({ name }: { name: string }, { input }: { input?: (unknown) \| undefined } = {})` | `string` |
| `deriveRunActivity({ events }: { events: readonly AgentEvent[] \| undefined })` | `RunActivityState` |
| `formatActivityClock({ totalSeconds }: { totalSeconds: number })` | `string` |
| `describeRunActivity({ activity, clock, t }: { activity: RunActivity; clock: RunActivityClock; t: RunActivityTranslate })` | `string`; supplied translation callback |

Core constants are `CHAT_RUN_STATUSES`, `ASSISTANT_STEP_SEPARATOR`, `RUN_ACTIVITY_IDLE_MS`, `RUN_ACTIVITY_LABELS`, `CHAT_CAPABILITIES`. Question/form, todo/tool, activity, capability and artifact types are exported through [core/index.ts](../../src/core/index.ts).

### Artifact functions

| Current signature | Return |
|---|---|
| `createArtifactParser()` | `{feed(delta: string): Generator<ArtifactEvent>; flush(): Generator<ArtifactEvent>}` |
| `parseArtifacts({ content }: { content: string })` | `ArtifactEvent[]` |
| `stripArtifact({ content }: { content: string })` / `stripRecoveredHtmlFallbackForDisplay({ content }: { content: string }, { sourceText = content }: { sourceText?: (string) \| undefined } = {})` | `string` |
| `matchPersistedArtifactFile({ attrs, persistedFiles }: { attrs: Record<string, string>; persistedFiles: ReadonlyArray<PersistedArtifactFileRef> })` | `PersistedArtifactFileRef \| null` |
| `summarizeArtifactsForTranscript({ content, persistedFiles }: { content: string; persistedFiles: ReadonlyArray<PersistedArtifactFileRef> })` | `string` |
| `splitStreamingArtifact({ content }: { content: string })` | `{head: string; live: StreamingArtifact \| null}` |
| `validateHtmlArtifact({ content }: { content: string })` | `{ok: true} \| {ok: false; reason: string}` |
| `artifactManifestNameFor({ entry }: { entry: string })` / `serializeArtifactManifest({ manifest }: { manifest: ArtifactManifest })` | `string` |
| `createHtmlArtifactManifest(input: {entry: string; title: string; metadata?: Record<string,unknown>; sourceSkillId?: string; designSystemId?: string \| null})` | `ArtifactManifest` |
| `parseArtifactManifest({ raw }: { raw: string })` / `inferLegacyManifest(input: {entry: string; title?: string; metadata?: Record<string,unknown>})` | `ArtifactManifest \| null` |
| `resolveHtmlPointerArtifactTarget(input: HtmlPointerArtifactTargetInput)` | `string \| null` |
| `recoverHtmlArtifactFromPrecedingDocument({ artifactHtml, identifier, sourceText }: RecoverHtmlArtifactInput)` | `string \| null` |
| `resolvePersistedArtifactHtml(input: RecoverHtmlArtifactInput)` | `string` |
| `recoverStandaloneHtmlDocument({ sourceText }: { sourceText: string \| null \| undefined })` / `recoverHtmlDocumentFromMarkdownFence({ sourceText }: { sourceText: string \| null \| undefined })` | `string \| null` |

The two structural input types for pointer/recovery are defined in [pointer.ts](../../src/core/util/pointer.ts) and [recover.ts](../../src/core/util/recover.ts). Internal markdown-range and attribute parsers are excluded by the public artifact barrel.

Minimal core wiring (root and `/core` are equivalent):

```ts
import { buildTranscript } from '@jini-ai/chat';
import { deriveConversationTitle } from '@jini-ai/chat/core';
const prompt = buildTranscript({ history: hostHistory });
const title = deriveConversationTitle({ prompt: hostUserPrompt });
```

## Owner-scoped stores

```ts
createSqliteChatStore(required: { kernel: StorageKernel<DB>; scope: ChatOwnerScope }, optional: { clock?: Clock } = {}): ChatStore;
createSqliteChatMaintenance(required: { kernel: StorageKernel<DB> }): ChatHistoryMaintenance;
createPgliteChatStore(required: { kernel: StorageKernel<DB>; scope: ChatOwnerScope }, optional: { clock?: Clock } = {}): ChatStore;
createPgliteChatMaintenance(required: { kernel: StorageKernel<DB> }): ChatHistoryMaintenance;
createPostgresChatStore(required: { kernel: StorageKernel<DB>; scope: ChatOwnerScope }, optional: { clock?: Clock } = {}): ChatStore;
createPostgresChatMaintenance(required: { kernel: StorageKernel<DB> }): ChatHistoryMaintenance;
createChatHistoryStore({ db, scope }: { db: SqliteConnectionSource; scope: ChatOwnerScope }, optional: { clock?: Clock } = {}): ChatStore; // SQLite compatibility
createChatHistoryMaintenance({ db }: { db: SqliteConnectionSource }): ChatHistoryMaintenance;
ensureChatHistoryTables({ db }: { db: Pick<SqliteClient, 'exec'> }): void;
```

`scope = {scopeId, ownerKind: 'user' | 'guest', ownerId}` requires nonempty string IDs. The host resolves authority and hashes guest identifiers before binding. The host supplies an opened, migrated `StorageKernel<DB extends ChatDatabase>` with both `ai_chats` and `ai_chat_messages`, owns its lifetime and transaction context, and enables SQLite foreign keys. Each adapter also exports `ChatDatabase`, `AiChatsTable`, `AiChatMessagesTable`; SQLite exports `CHAT_HISTORY_DDL`. Maintenance has no owner scope and requires privileged host wiring.

| Store call, current signature | Async result |
|---|---|
| `list()` / `get(id: string)` | `ChatConversation[]` / `ChatConversation \| null` |
| `create({id, title?, titleSource?, expiresAt?})` | `ChatConversation` |
| `rename(id: string, title: string, source: ChatTitleSource = 'manual')` | `ChatConversation \| null` |
| `touch(id: string, options?: {expiresAt?: number})` / `delete(id: string)` | `void` |
| `messages(conversationId: string)` | `ChatMessage[]` |
| `appendMessage(conversationId: string, message: ChatMessage)` | `ChatMessage \| null` |
| `pageConversations(options?: ChatPageOptions)` | `ChatPage<ChatConversation>` |
| `pageMessages(input: {conversationId: string}, options?: ChatPageOptions)` | `ChatPage<ChatMessage>` |
| maintenance `sweepExpired(now: number, limit = 500)` | deleted conversation count |

`ChatPageOptions = {limit?, cursor?}`; `ChatPage<T> = {items: readonly T[], nextCursor?: string}`. `ChatConversation` contains id/title/titleSource/messageCount/createdAt/updatedAt and optional expiresAt. `ChatHistoryStore` is the eight-method non-paging subset. `ChatStoreFactory(scope)` returns `ChatStore`. Optional `ChatSearchCapability.search(input: {query, conversationId?}, options?)` returns `Promise<ChatPage<ChatSearchHit>>`, with declared immediate/eventual consistency; these SQL factories supply no search implementation.

```ts
import { createSqliteChatStore } from '@jini-ai/chat/store/sqlite';
const store = createSqliteChatStore(
  { kernel: hostKernel, scope: { scopeId: 'workspace', ownerKind: 'user', ownerId: 'actor' } },
  { now: hostClock },
);
await store.create({ id: hostIds.next() });
const page = await store.pageConversations({ limit: 20 });
```

Other store entry wiring:

```ts
import type { ChatStore } from '@jini-ai/chat/store';
import type { ChatSessionMode } from '@jini-ai/chat/store/legacy';
import { createPgliteChatStore } from '@jini-ai/chat/store/pglite';
import { createPostgresChatStore } from '@jini-ai/chat/store/postgres';
const embedded: ChatStore = createPgliteChatStore({kernel: hostPgliteKernel, scope});
const network: ChatStore = createPostgresChatStore({kernel: hostPostgresKernel, scope});
const mode: ChatSessionMode = 'chat';
```

### Legacy SQLite entry point

All calls below borrow `db: SqliteDb`, are synchronous, and require host-owned authorization; they do not enforce owner scopes. `DbRow` is an open record from `@jini-ai/db/core`.

| Current signature | Result |
|---|---|
| `listConversations({ db, projectId }: { db: SqliteDb; projectId: string })` / `getConversation({ db, id }: { db: SqliteDb; id: string })` | normalized records array / record or null |
| `normalizeConversationSessionMode({ value }: { value: unknown })` | `ChatSessionMode` |
| `insertConversation({ db, c }: { db: SqliteDb; c: DbRow })` / `updateConversation({ db, id, patch }: { db: SqliteDb; id: string; patch: DbRow })` | normalized record or null |
| `deleteConversation({ db, id }: { db: SqliteDb; id: string })` | `void` |
| `listMessages({ db, conversationId }: { db: SqliteDb; conversationId: string })` / `upsertMessage({ db, conversationId, m }: { db: SqliteDb; conversationId: string; m: DbRow })` | normalized messages / message or null |
| `getMessageTelemetryFinalizationState({ db, messageId }: { db: SqliteDb; messageId: string })` | `{exists: boolean; finalizedAt: number \| null}`; source shape in [messages.ts](../../src/store/legacy/sqlite/messages.ts) |
| `appendMessageStatusEvent({ db, messageId, event }: { db: SqliteDb; messageId: string; event: DbRow })` / `appendMessageAgentEvent({ db, messageId, event }: { db: SqliteDb; messageId: string; event: DbRow })` / `deleteMessage({ db, id }: { db: SqliteDb; id: string })` | `void` |

`LEGACY_CHAT_DDL` supplies explicit bootstrap SQL. `MessageConversationMismatchError({messageId, actualConversationId, requestedConversationId})` is exported. Example: `db.exec(LEGACY_CHAT_DDL); listConversations({ db, projectId: 'workspace' });` after the host provisions the related schema and authorizes the caller.

## React hooks and registries

React entry points additionally export the props/results/slot types named by their explicit barrels. Component signatures and wiring are in [ui.spec.md](ui.spec.md). Hooks require a React render context; their collaborator objects retain the current one-object convention.

| Current signature | Return / dependency |
|---|---|
| `useRunStream({ transport }: { transport: ChatTransport })` | `UseRunStreamResult`: state plus start/reattach/cancel/reset |
| `useConversation(options: UseConversationOptions)` | `UseConversationResult`; required transport |
| `useComposer(options: UseComposerOptions = {})` | `UseComposerResult`; optional slots, draft persistence and attachment callbacks |
| `useToolTimeline(events, options: UseToolTimelineOptions = {})` | `UseToolTimelineResult` |
| `useExtEventGroups({ events }: { events: AgentEvent[] \| undefined }, { slotOf = (name) => name }: { slotOf?: ((name: string, data: unknown) => string) \| undefined } = {})` | `ExtEventGroup[]` |
| `usePinnedTodos({ messages }: { messages: ReadonlyArray<ChatMessage> \| undefined })` / `useQuestionForms({ messages }: { messages: ReadonlyArray<ChatMessage> \| undefined })` | `UsePinnedTodosResult` / `UseQuestionFormsResult` |
| `parseSubmittedAnswers({ form, userMessageContent }: { form: QuestionForm; userMessageContent: string })` | `QuestionFormAnswers \| null` |
| `useArtifactStream({ content }: { content: string }, { registry }: { registry?: (RendererRegistry) \| undefined } = {})` | `UseArtifactStreamResult` |
| `useChatFabDrag({ onClick }: { onClick: () => void })` / `clampChatFabToViewport(position, size: {width; height})` | `UseChatFabDragResult` / `ChatFabPosition` |
| `useLatestOperation()` / `normalizeOperationError({ error }: { error: unknown })` | `LatestOperation` / `Error` |
| `useT()` / `useI18n()` / `useAnalytics()` / `useProjectContext()` | translation function / `I18nAdapter` / `AnalyticsAdapter` / optional `ProjectContextValue` |
| `useChatTransport()` / `useArtifactRegistry()` | required `ChatTransport` / optional `RendererRegistry` |
| `useJiniChatSlots()` / `useOnFeedback()` | `JiniChatSlots` / optional `OnFeedback` |
| `definedProps({ source }: { source: T })` | same object type with undefined-valued properties removed |
| `appendComposerDiscovery({ draft, insertText }: { draft: string; insertText: string })` | `string` |
| `interleaveMessageBlocks<Row extends {id:string}>({ events, content, rows }, { slotOf = ev => ev.name } = {})` | `MessageBlock<Row>[] \| null`; exact input in [message-blocks.ts](../../src/react/message-blocks.ts) |
| `registerToolRenderer({ name, renderer }: { name: string; renderer: ToolRenderer })` / `getToolRenderer({ name }: { name: string })` / `clearToolRenderers()` | unregister function / renderer or undefined / void |
| `registerExtEventRenderer({ name, renderer }, options: ExtEventRendererOptions = {})` / `getExtEventRenderer({ name })` / `clearExtEventRenderers()` | unregister / renderer or undefined / void |
| `extEventSlot({ name, data }: { name: string; data: unknown })` / `mcpUiSurfaceSlotKey({ data }: { data: unknown })` | string / string or undefined |
| `registerMcpUiSurfaceRenderer({sandboxProxyUrl, onToolCall?, onOpenLink?, name?, maxHeight?})` | unregister function |
| `new RendererRegistry()` | register(renderer) → unregister; resolve(context) → match or null; list() → readonly renderers |

`CHAT_FAB_DRAG_THRESHOLD_PX = 4`, `CHAT_FAB_EDGE_MARGIN_PX = 8`, `MCP_UI_EXT_EVENT_NAME = 'mcp-ui'` are public constants. `createDomPageDriver({root, pages}: DomPageDriverRequired, options: DomPageDriverOptions = {}): PageDriver` and `currentAgentPage({root}: {root: ParentNode}, optional = {}): string | undefined` are compatibility re-exports from `@jini-ai/agentic/dom`, whose driver/page vocabulary remains owned by that package.

## Pane and browser wiring

| Current signature | Return / consumer supplies |
|---|---|
| `useChatPane(options: UseChatPaneOptions)` | `UseChatPaneResult`; required transport/agents; optional selection, run context, directory access, attachment callbacks and initial state |
| `useChatPaneAgentControl(pane: UseChatPaneResult, options: UseChatPaneAgentControlOptions = {})` | `void`; optional bridgeAccess and opt-in controls |
| `useChatPaneRuntimeInventory({ access, initialAgents = EMPTY_AGENTS, pollIntervalMs = 5_000, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, }: UseChatPaneRuntimeInventoryOptions)` / `useChatPaneWorkingDirectory(options)` | named `Use…Result`; runtime/directory access ports |
| `defaultChatPaneSelection({ agent }: { agent: ChatPaneAgent })` / `resolveChatPaneSelection({ agents, requested }: { agents: readonly ChatPaneAgent[]; requested: ChatPaneAgentSelection })` | selection; exact resolver parameters in [rules.ts](../../src/react/features/chat-pane/rules.ts) |
| `orderChatPaneAgents({ agents }: { agents: readonly ChatPaneAgent[] })` | `ChatPaneAgent[]` |
| `createDaemonAttachmentUploader({ baseUrl, fetch }, options: CreateDaemonAttachmentUploaderOptions = {})` | `(files: File[], options?: ChatPaneAttachmentUploadOptions) => Promise<ChatAttachment[]>` |
| `createMcpUiToolCaller(baseUrl: string, options: CreateMcpUiToolCallerOptions = {})` | `McpUiToolCallHandler`, resolving `unknown` |
| `createFrontendSessionBridge({ baseUrl, request, openStream }: FrontendSessionBridgeArgs, options: FrontendSessionBridgeOptions = {})` | `FrontendSessionBridge`: bridgeAccess, ready promise of `{sessionId,bindToken}`, bindToken(), close(); subscribe/respondSuccess/respondError belong to bridgeAccess |

`CHAT_PANE_AGENT_TOOLS` is the pane capability manifest. Runtime access supplies listAgents/rescanAgents/daemonOnline; directory access supplies pickWorkingDirectory/recentDirectories/directoryExists and optional normalizeWorkingDirectory. Attachment and MCP UI caller helpers take an explicit native fetch; the frontend bridge takes request/openStream effects. New embed helpers require host fetch/storage/page-action ports. Browser File/DOM availability is host owned. The bridge requires `{ baseUrl, request, openStream }`; its optional second object provides pageDriver/executor-prefix handlers and invocation/error callbacks.

```tsx
import { JiniChatProvider } from '@jini-ai/chat/react';
import { ChatPane } from '@jini-ai/chat/react/chat-pane';
import '@jini-ai/chat/react/styles/reference.css';
<JiniChatProvider transport={hostTransport}>
  <ChatPane transport={hostTransport} agents={hostAgents} />
</JiniChatProvider>;
```

## Export gaps and evidence

Run-event, AG-UI, run finalizer, embed, fetch/SSE transport, browser session-store and page-action entries are all exported. The unexported internal model-picker and MCP-UI proof-of-concept modules were removed after confirming that only their own tests reached them; model selection remains a host-injected slot.

Evidence: package exports; [core barrel](../../src/core/index.ts), [React barrel](../../src/react/index.ts), [pane barrel](../../src/react/chat-pane.ts), store adapters and their isolation/paging/transaction contract tests. Tests were read, not executed. Known source/comment mismatches are recorded in behavior and UI contracts.

## Shared clocks and helper arguments

Finalizers use `Clock` from `@jini-ai/core/primitives`, with `nowMs()`.
`ExtEventSlotKey` receives `{ data }`. Composer helpers use `{ draft }`, `{ groups, query }`,
`{ draft, item }` or `{ composerRect }` as appropriate; attachment-preview helpers use
`{ path, file }` for caching and `{ path }` for reads. Host transport callbacks keep their
existing framework/port ABI. Dedicated run-event, AG-UI, finalizer, embed, transport and browser
subpaths are listed in package exports rather than folded into the root React/core barrel.

## New dedicated entries

`./core/run-events` is universal. Exports RunAgentPayload, RunProtocolEventWire, RunNotices, TerminalOutcome, RunFrameOutcome, and object-shaped pure functions `asString({value})`, `parseUsageEvent({payload})`, `translateRunAgentPayload({payload})`, `terminalReasonNotice({reason,notice})`, `readTerminalOutcome({raw})`, `terminalOutcomeNotice({raw,notices})`, `terminalFailureError({raw})`, `readTerminalReason({raw,wrapped})`, `parseFrame({rawFrame})`, `isDaemonRunId({runId,excludedPrefixes})`, `runInterruptedNotice({notice})`, `runContentFromEvents({events})`, `runEventsForSave({events})`, `translateRunFrame({kind,raw,notices})`. Notices/event vocabulary and excluded run prefixes are host inputs. [Source](../../src/core/run-events/entry.ts).

`./core/ag-ui` is universal with official AG-UI types. Exports EventIdGenerator (`next({prefix,ordinal})`), CustomEventNames (usage/status/extensionPrefix), RunAgentWirePayload, AgUiEvent, AgUiTranslationState and `reduceAgentWirePayload({payload})`, `createAgUiTranslationState({ids,customEventNames})`, `translateAgentEventToAgUi({event,state})`, `closeAgUiRun({state})`. Host emits RUN_STARTED/RUN_FINISHED/RUN_ERROR separately. Each run needs a fresh state. [Source](../../src/core/ag-ui/entry.ts).

`./server/run-finalizer`: `createAssistantRunFinalizer({ledger,daemon,clock: Clock,scheduler,runIdClassifier,notices,onError}, {reconnectDelayMs = 2000,maxReconnects = 30,checkpointIntervalMs = 1000} = {})`. Methods are `watch({principalId,conversationId,message}): void`, `idle({}): Promise<void>`, `activeCount({}): number`. Ledger checkpoint(RunProgress)/settle(RunSettlement) must atomically refuse foreign runs/terminal rows; daemon openEvents/runStatus take `{runId,principalId}`; scheduler schedule({task,delayMs})/cancel({handle})/sleep({delayMs}) and classifier isDaemonRunId({runId}) are required. RunRef/RunProgress/RunSettlement and these ports/options/result interfaces are exported. [Source](../../src/server/run-finalizer/entry.ts).

`./transports/fetch-sse`: `createFetchSseTransport(args: FetchSseTransportArgs, options: FetchSseTransportOptions = {}): ChatTransport`. Args require endpoint/agentId/native fetch/ids({})/decode({source})/requestBuilder/frameMapper/history message/count limits and no-user/missing-body/request-failed copy; options supply createAbortController/onLifecycle. `buildJsonChatRequest({message,history,...request})` creates POST JSON; `mapJsonChatSseFrame({frame,directiveEventName,streamError})` returns optional event/error/done. DecodedSseFrame, SseDecoderPort, HistoryTurn, FetchSseRequest and FetchSseFrameResult are exported. Returned methods preserve ChatTransport's existing positional ABI. [Source](../../src/embed-widget/transports/fetch-sse.ts).

`./browser/session-store`: `createBrowserSessionStore({storage,transcriptKey,actionKey,maxMessages,maxBytes,validateMessage}): BrowserSessionStore`. Native storage uses getItem/setItem/removeItem. load({}) returns `{open,messages}`, save({state}), clear({}), enqueue({action}) and drain({}) manage a bounded transcript and single queued action. Keys must be nonempty/distinct; maxMessages is a nonnegative safe integer, maxBytes a safe integer at least 28. SessionStoragePort/PersistedEmbedState/BrowserSessionStoreArgs are exported. [Source](../../src/embed-widget/browser/session-store.ts).

`./browser/page-actions`: `isQueuedPageAction({value})`, `isPageActionDirective({value})`, `extractPageActions({events,directiveEventName})`, `splitPageActions({actions})`, `findTargetElement({title,root,selection})` and `createBrowserPageActions(args: BrowserPageActionsArgs)`. Required args are root, selection selectors, allowPath/navigate/reducedMotion/scroll ports, timers, highlightClass/fadeAnimationName and nonnegative finite cleanupFallbackMs. Returned PageActionPort exposes allows({action}), navigate({action}), execute({action}), clearHighlight({}); BrowserPageActionController adds applyHighlight/scrollToElement({element}). ResolvedPageTarget, PageAction/NavigateAction/NonNavigateAction, DirectiveCarryingEvent, SplitPageActions, TargetSelectionPolicy and PageActionTimerPort are exported. [Source](../../src/embed-widget/browser/page-actions.ts).

`./react/embed` exports EmbedChatWidget(EmbedChatWidgetArgs), EmbedChatHeader(EmbedChatHeaderArgs) and `mountEmbedChat({element,widget}): {unmount({}):void}`. Widget args require agent, copy, transport, session, pageActions, directiveEventName, keyboard and scheduleFrame({callback}) returning cancellation. Copy types EmbedChatCopy/EmbedHeaderCopy and EscapeKeyPort are exported; EscapeKeyPort.subscribe({onEscape}) returns unsubscribe. [UI](ui.spec.md).

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Function and declared parameters | Declaration |
|---|---|
| `A2uiSurfaceCard({ events, runId, onAgentAction }: A2uiSurfaceCardProps)` | [A2uiSurfaceCard.tsx](../../src/react/components/A2uiSurfaceCard.tsx) |
| `AgentRuntimePicker({ agents, value, onChange, onRescan, scanning = false, daemonOnline = true, placement = 'up', executionMode = 'local', apiModeAvailable = false, onExecutionModeChange, byokRuntime, onByokModelChange, // No default here (was '/agent-icons'): omitted means "let AgentIcon fall back to its own // bundled icon set" — see AgentIcon.tsx's BUNDLED_ICON_URLS. A host that still wants to vendor // its own asset directory can pass this explicitly, same as before. agentIconBasePath, }: AgentRuntimePickerProps)` | [AgentRuntimePicker.tsx](../../src/react/features/chat-pane/components/AgentRuntimePicker.tsx) |
| `AttachmentTray({ attachments, onRemove, renderItem }: AttachmentTrayProps)` | [AttachmentTray.tsx](../../src/react/components/AttachmentTray.tsx) |
| `ChatFab({ open, onToggle, label = 'chat' }: ChatFabProps)` | [ChatFab.tsx](../../src/react/components/ChatFab.tsx) |
| `ConversationList({ conversations, activeConversationId, onSelect, onCreate, onDelete, onRename, onSearch, confirmDelete, createDisabled = false, emptyState, }: ConversationListProps)` | [ConversationList.tsx](../../src/react/components/ConversationList.tsx) |
| `Markdown({ children }: MarkdownProps)` | [Markdown.tsx](../../src/react/components/Markdown.tsx) |
| `McpUiSurfaceCard({ events, sandboxProxyUrl, onToolCall, onOpenLink, maxHeight, call, runStreaming }: McpUiSurfaceCardProps)` | [McpUiSurfaceCard.tsx](../../src/react/components/McpUiSurfaceCard.tsx) |
| `MessageList({ messages, isStreaming = false, scrollIntent = false, onScrolled, activeQuestionFormMessageId = null, questionFormSubmittedAnswersByMessageId, onQuestionFormSubmit, projectFileNames, onRequestOpenFile, renderAttachment, pendingPrompt = null, }: MessageListProps)` | [MessageList.tsx](../../src/react/components/MessageList.tsx) |
| `MessageRow({ message, runStreaming = false, runSucceeded = false, questionFormInteractive = false, questionFormSubmittedAnswers, onQuestionFormSubmit, projectFileNames, onRequestOpenFile, renderAttachment, }: MessageRowProps)` | [MessageRow.tsx](../../src/react/components/MessageRow.tsx) |
| `NextStepActions({ actions, onSelect }: NextStepActionsProps)` | [NextStepActions.tsx](../../src/react/components/NextStepActions.tsx) |
| `QuestionsPanel({ form, interactive, submitDisabled = false, submittedAnswers, generating = false, onSubmit }: QuestionsPanelProps)` | [QuestionsPanel.tsx](../../src/react/components/QuestionsPanel.tsx) |
| `TodoCard({ todos, runStreaming = false, onDismiss }: TodoCardProps)` | [TodoCard.tsx](../../src/react/components/TodoCard.tsx) |
| `ToolCard({ use, result, runStreaming, runSucceeded, projectFileNames, onRequestOpenFile }: ToolCardProps)` | [ToolCard.tsx](../../src/react/components/ToolCard.tsx) |

| Additional exported names | Kind and source |
|---|---|
| `A2uiAgentActionOutcome`, `A2uiSurfaceCardProps` | type; [A2uiSurfaceCard.tsx](../../src/react/components/A2uiSurfaceCard.tsx) |
| `AgentOption`, `AgentSelection`, `AnnotationAdapter`, `AttachmentTraySlot`, `ComposerDiscoveryArgument`, `ComposerDiscoveryGroup`, `ComposerDiscoveryItem`, `ComposerDiscoveryOutcome`, `ComposerDiscoverySelection`, `ComposerPlusItem`, `ComposerSlots`, `FilePreviewSlot`, `MentionResult`, `MentionSource`, `ModelAgentPickerSlot` | type; [slots.ts](../../src/react/slots.ts) |
| `AgentRuntimePickerProps`, `ByokRuntimeSummary`, `ChatPaneActivity`, `ChatPaneAgentBridgeAccess`, `ChatPaneAgentControlOptions`, `ChatPaneAgentOption`, `ChatPaneAgentToolAction`, `ChatPaneAgentToolDef`, `ChatPaneAgentToolInputSchema`, `ChatPaneAgentToolRisk`, `ChatPaneComposerHandle`, `ChatPaneProps`, `ChatPaneRunContext`, `ChatPaneRunContextInput`, `ChatPaneRuntimeAccess`, `ChatPaneVariant`, `ChatPaneWorkingDirectoryAccess`, `McpUiToolCallRequest`, `RuntimePickerPlacement`, `UseChatPaneRuntimeInventoryResult`, `UseChatPaneWorkingDirectoryOptions`, `UseChatPaneWorkingDirectoryResult` | type; [index.ts](../../src/react/features/chat-pane/index.ts) |
| `ArtifactExportKind`, `ArtifactKind`, `ArtifactRendererId`, `ArtifactStatus` | type; [types.ts](../../src/core/util/types.ts) |
| `ArtifactFile`, `ArtifactRenderContext`, `ArtifactRenderMatch`, `ArtifactRenderer` | type; [artifact-types.ts](../../src/react/artifact-types.ts) |
| `ArtifactStreamItem` | type; [useArtifactStream.ts](../../src/react/hooks/useArtifactStream.ts) |
| `AssistantRunFinalizer`, `AssistantRunFinalizerArgs`, `AssistantRunFinalizerOptions` | interface; [entry.ts](../../src/server/run-finalizer/entry.ts) |
| `AttachmentTrayProps` | type; [AttachmentTray.tsx](../../src/react/components/AttachmentTray.tsx) |
| `CapabilityDef`, `CapabilityInputSchema`, `CapabilityRisk` | type; [index.ts](../../../agentic/src/index.ts) |
| `ChatFabProps` | type; [ChatFab.tsx](../../src/react/components/ChatFab.tsx) |
| `ChatRole` | type; [messages.ts](../../src/core/messages.ts) |
| `ComposerDraftPersistence`, `MentionPopoverState` | type; [useComposer.ts](../../src/react/hooks/useComposer.ts) |
| `ComposerProps` | type; [Composer.tsx](../../src/react/components/Composer.tsx) |
| `ConversationListItem`, `ConversationListProps` | type; [ConversationList.tsx](../../src/react/components/ConversationList.tsx) |
| `DefinedProps` | type; [defined-props.ts](../../src/react/util/defined-props.ts) |
| `DirectionCard`, `FormQuestion`, `QuestionType` | type; [types.ts](../../src/core/question-form/types.ts) |
| `ExtEventErrorBoundary` | class; [ExtEventErrorBoundary.tsx](../../src/react/components/ExtEventErrorBoundary.tsx) |
| `ExtEventErrorBoundaryProps` | type; [ExtEventErrorBoundary.tsx](../../src/react/components/ExtEventErrorBoundary.tsx) |
| `ExtEventRenderProps`, `ExtEventRenderer` | type; [ext-event-renderer-registry.ts](../../src/react/ext-event-renderer-registry.ts) |
| `HtmlArtifactValidationResult` | type; [validate.ts](../../src/core/util/validate.ts) |
| `JiniChatProviderProps` | type; [JiniChatProvider.tsx](../../src/react/components/JiniChatProvider.tsx) |
| `MarkdownProps` | type; [Markdown.tsx](../../src/react/components/Markdown.tsx) |
| `McpUiSurfaceCardProps` | type; [McpUiSurfaceCard.tsx](../../src/react/components/McpUiSurfaceCard.tsx) |
| `MessageListProps` | type; [MessageList.tsx](../../src/react/components/MessageList.tsx) |
| `MessageRowProps` | type; [MessageRow.tsx](../../src/react/components/MessageRow.tsx) |
| `NextStepAction`, `NextStepActionsProps` | type; [NextStepActions.tsx](../../src/react/components/NextStepActions.tsx) |
| `OperationToken` | type; [useLatestOperation.ts](../../src/react/hooks/useLatestOperation.ts) |
| `ParsedQuestionForm` | type; [useQuestionForms.ts](../../src/react/hooks/useQuestionForms.ts) |
| `QuestionFormFileSubmission`, `QuestionFormHandle`, `QuestionFormProps` | type; [QuestionForm.tsx](../../src/react/components/QuestionForm.tsx) |
| `QuestionsPanelProps` | type; [QuestionsPanel.tsx](../../src/react/components/QuestionsPanel.tsx) |
| `ReattachRunOptions`, `RunContext` | type; [index.ts](../../src/core/index.ts) |
| `RunDaemonClient`, `RunIdClassifier`, `RunLedger`, `Scheduler` | type; [ports.ts](../../src/server/run-finalizer/ports.ts) |
| `RunStreamState`, `RunStreamStatus`, `StartRunOptions` | type; [useRunStream.ts](../../src/react/hooks/useRunStream.ts) |
| `SendMessageOptions` | type; [useConversation.ts](../../src/react/hooks/useConversation.ts) |
| `TodoCardProps` | type; [TodoCard.tsx](../../src/react/components/TodoCard.tsx) |
| `TodoStatus` | type; [todos.ts](../../src/core/todos.ts) |
| `ToolCardProps` | type; [ToolCard.tsx](../../src/react/components/ToolCard.tsx) |
| `ToolResultMediaBlock` | type; [events.ts](../../src/core/events.ts) |
| `ToolTimelineRow` | type; [useToolTimeline.ts](../../src/react/hooks/useToolTimeline.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./core`, `./react`, `./react/chat-pane`, `./react/styles/reference.css`, `./store`, `./store/sqlite`, `./store/pglite`, `./store/postgres`, `./store/legacy`, `./store/legacy/sqlite`, `./core/run-events`, `./core/ag-ui`, `./server/run-finalizer`, `./react/embed`, `./transports/fetch-sse`, `./browser/session-store`, `./browser/page-actions`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
