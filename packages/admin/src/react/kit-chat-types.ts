/**
 * @file The chat library's shapes the admin kit restates (see `kit.tsx`'s file doc): messages, run
 * transport, chat-pane agents and the run posters' delivery types. Split out of `kit.tsx` only for
 * size; `./react/kit` re-states them as part of its own public types, nothing else imports this file.
 */
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
/** The chat library's translator (its own locale context). Never the UI translator in `hooks.useT`. */
export type KitChatTranslator = (key: string, vars?: Record<string, string | number>) => string;
export interface KitSecretRedactionSignal { readonly secretRedacted: true; readonly count: number }
export type KitRedactUserText = (required: { readonly text: string }, optional?: { readonly secretField?: boolean })
  => { readonly text: string; readonly secretRedacted: boolean; readonly count: number };
/** Redaction of typed user text before it is posted. Default on in the chat library. */
export interface KitUserTextRedactionOptions {
  readonly redactUserText?: KitRedactUserText; readonly onSecretRedacted?: (signal: KitSecretRedactionSignal) => void;
}
export interface KitPosterRequestOptions { readonly timeoutMs?: number; readonly headers?: Readonly<Record<string, string>> }
export type KitTypedAnswerDelivery = 'delivered' | 'not-pending' | 'failed';
/** Delivers composer text to the question tool the agent waits on; `toolName` is that tool's id. */
export type KitDeliverTypedAnswer = ((input: { text: string }) => Promise<KitTypedAnswerDelivery>) & { readonly toolName: string };
export interface KitChatAttachment { path: string; name: string; kind: 'image' | 'file'; size?: number; order?: number }
export type KitMidRunMessageDelivery = 'delivered' | 'unsupported' | 'not-running' | 'failed' | { readonly delivery: 'delivered'; readonly id: string };
export type KitDeliverMidRunMessage = (input: { runId: string; text: string; attachments?: readonly KitChatAttachment[] }) => Promise<KitMidRunMessageDelivery>;
export type KitA2uiActionDeliveryOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };
/** `path`, `fetch` and `reportFailure` stay required: the host supplies its route, cookie fetch and failure log. */
export interface KitA2uiActionPosterInput {
  readonly baseUrl: string; readonly path: string; readonly fetch: typeof fetch;
  readonly reportFailure: (required: { args: readonly unknown[] }, optional: Record<string, never>) => void;
}
/* chat data shapes admin code reads (restated; the chat library owns the originals) */
export type ChatAttachment = KitChatAttachment;
export type SecretRedactionSignal = KitSecretRedactionSignal;
export type ChatRole = 'user' | 'assistant';
export type ChatRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type ToolResultMediaBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string; readonly title?: string; readonly href?: string };
/** One renderable item of a run's stream. */
export type AgentEvent =
  | { kind: 'status'; label: string; detail?: string; code?: string; data?: Readonly<Record<string, string | number>> }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown; bridgeCall?: { name: string; input: unknown; buffered?: boolean }; toolOrigin?: 'bridge' }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean; media?: readonly ToolResultMediaBlock[]; outcome?: 'unknown' }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number; cumulativeCostUsd?: number; costSessionId?: string; durationMs?: number; stopReason?: string }
  | { kind: 'raw'; line: string }
  | { kind: 'ext'; name: string; data: unknown };
export interface ChatMessage {
  inputPending?: boolean; secretRedaction?: SecretRedactionSignal; id: string; role: ChatRole; content: string;
  agentId?: string; agentName?: string; events?: AgentEvent[]; createdAt?: number; runId?: string; runStatus?: ChatRunStatus;
  resumable?: boolean; lastRunEventId?: string; startedAt?: number; endedAt?: number; folders?: string[]; attachments?: ChatAttachment[];
}
export interface RunHandlers {
  onCheckpoint?: (message: ChatMessage) => void; onEvent: (ev: AgentEvent) => void;
  onToolInputDelta?: (id: string, name: string, delta: string) => void; onError: (err: Error) => void; onDone: (finalEvents: AgentEvent[]) => void;
}
export interface StartRunInput {
  assistantMessageId?: string; history: ChatMessage[]; agentId?: string; conversationId?: string | null; folders?: string[];
  attachments?: ChatAttachment[]; context?: Record<string, unknown>; signal: AbortSignal; cancelSignal?: AbortSignal;
}
export interface ReattachRunOptions { readonly signal?: AbortSignal }
export interface FeedbackChange { messageId: string; runId?: string; rating: 'positive' | 'negative'; reasonCode?: string; note?: string }
/** How the chat pane starts, reattaches to, polls and stops a run. */
export interface ChatTransport {
  startRun(input: StartRunInput, handlers: RunHandlers): Promise<{ runId: string }>;
  reattachRun(runId: string, handlers: RunHandlers, options?: ReattachRunOptions): Promise<void>;
  fetchRunStatus(runId: string): Promise<ChatRunStatus | null>;
  stopRun(runId: string): Promise<void>;
  reportFeedback?(change: FeedbackChange): Promise<void>;
}
/** The chat library's i18n adapter: its translator plus the active locale. */
export interface I18nAdapter { t: (key: string, vars?: Record<string, string | number>) => string; locale: string }
export interface ExtEventCall {
  readonly id?: string; readonly name: string; readonly input: unknown; readonly result?: { readonly content: string; readonly isError: boolean };
}
/** What a host renderer for an `ext` event group receives. `events` is untyped wire data. */
export interface ExtEventRenderProps {
  name: string; events: readonly unknown[]; runStreaming: boolean; transcriptRow?: boolean; runSucceeded: boolean; awaitingAnswer?: boolean;
  runId: string | undefined; call?: ExtEventCall; answered?: boolean; onAnswered?: () => void; onAnswerText?: (answerText: string) => void;
  answerText?: string; answerRecorded?: boolean;
}
/** The a2ui card props a host-side wrapper reads: the ext-event props plus the agent-action relay
 *  (a structural subset of the chat library's card props; the card's clock and registry stay host-side). */
export interface A2uiSurfaceCardProps extends ExtEventRenderProps {
  onAgentAction?: (runId: string | undefined, message: unknown) => void | Promise<KitA2uiActionDeliveryOutcome>;
}
export interface ChatPaneAgentOption {
  id: string; label: string; identityKind?: 'concrete' | 'alias' | 'routing-mode'; resolvedId?: string; reasoning?: readonly ChatPaneAgentOption[];
}
/** One runtime in the chat pane's agent inventory (structurally the daemon's agent summary). */
export interface ChatPaneAgent {
  discoveryPending?: boolean; id: string; name: string; available?: boolean; version?: string | null; authStatus?: 'ok' | 'missing' | 'unknown';
  models?: readonly ChatPaneAgentOption[];
  modelCatalog?: {
    source: 'cli' | 'rpc' | 'provider-api' | 'cli-cache' | 'config-file' | 'offline-fallback';
    freshness: 'fresh' | 'stale' | 'offline-fallback'; fetchedAt: string; expiresAt: string;
    coverage: 'account' | 'provider' | 'configured' | 'observed'; launchFingerprint: string;
  };
  defaultModelResolution?:
    | { status: 'resolved'; id: string; selectionId?: string; source: string; resolvedAt: string; launchFingerprint: string }
    | { status: 'unresolved'; selectionId?: string; reason: string };
  reasoningOptions?: readonly ChatPaneAgentOption[]; reasoningInModelId?: { levels: readonly ChatPaneAgentOption[] };
  supportsCustomModel?: boolean; supportsConcreteModelSelection?: boolean; diagnostic?: string; supportsTools?: boolean;
  supportsNativeToolAccess?: boolean; fullCliAccessOnly?: boolean; fullCliAccessNote?: string;
}
export interface ChatPaneAgentSelection { agentId: string; model?: string; reasoning?: string }
/** The chat pane's agent inventory, rescan and daemon-health access (the host's runtime wiring). */
export interface ChatPaneRuntimeAccess {
  listAgents: () => Promise<readonly ChatPaneAgent[]>; getAgentsRefreshAt?: () => number | undefined;
  rescanAgents: () => Promise<readonly ChatPaneAgent[]>; daemonOnline: () => Promise<boolean>;
}
/** Imperative access to the composer draft, published by the chat pane once mounted. */
export interface ChatPaneComposerHandle {
  insertText: (text: string) => void;
  addFolders: (input: { folders: readonly string[] }, options?: {}) => void;
}
/** The composer's native working-directory access; a falsy value keeps the chat pane's text-input fallback. */
export interface ChatPaneWorkingDirectoryAccess {
  normalizeWorkingDirectory?: (directory: string) => Promise<string | null>;
  pickWorkingDirectory: (currentDirectory?: string) => Promise<string | null>;
  recentDirectories: () => Promise<readonly string[]>;
  directoryExists: (directory: string) => Promise<boolean>;
}
export interface FabPositionInput {
  readonly dockOpen: boolean; readonly avoidBottomPx: number; readonly avoidRightPx?: number; readonly storageKey: string;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>; readonly viewport: Window; readonly pointerEvents: Document;
  readonly edgeMargin: number; readonly sizePx: number; readonly dragThresholdPx: number;
}
/** The draggable chat button's position; `consumeDragFlag()` tells a real click from a drag's tail. */
export interface FabPositionResult {
  style: { right: number; bottom: number }; onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  consumeDragFlag: () => boolean; isDragging: boolean;
}
/* composer discovery (the slash/plus menu) */
export interface ComposerDiscoveryArgument { placeholder: string; required?: boolean }
export interface ComposerDiscoveryItem {
  id: string; label: string; description?: string; kind?: string; keywords?: readonly string[]; insertText?: string; command?: string;
  argument?: ComposerDiscoveryArgument; needsConfirmation?: boolean;
}
export interface ComposerDiscoveryGroup { id: string; label: string; items: readonly ComposerDiscoveryItem[] }
export interface ComposerDiscoverySelection { item: ComposerDiscoveryItem; source: 'plus' | 'slash'; argument?: string | null }
export interface ComposerDiscoveryOutcome { draft?: string }
/* ext-event renderer registry */
export type ExtEventRenderer = (props: ExtEventRenderProps) => ReactNode;
export type ExtEventSlotKey = (required: { data: unknown }) => string | undefined;
export interface ExtEventRendererOptions { slotKey?: ExtEventSlotKey; terminalNotice?: (required: { events: readonly unknown[] }) => boolean }
export interface ExtEventRendererRegistry {
  register(required: { name: string; renderer: ExtEventRenderer }, options?: ExtEventRendererOptions): () => void;
  get(required: { name: string }): ExtEventRenderer | undefined;
  slot(required: { name: string; data: unknown }): string;
  hasTerminalNotice(required: { name: string; events: readonly unknown[] }): boolean;
  clear(): void;
}
/* conversations: the saved list, the last-open store and the save client */
export interface AssistantConversation {
  id: string; title: string | null; titleSource: 'fallback' | 'generated' | 'manual'; messageCount: number; createdAt: number; updatedAt: number;
}
export interface LastConversationStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface LastConversationStore { read(): string | null; write(conversationId: string): void; clear(): void }
export interface AssistantChatsPort {
  listConversations(required: Record<string, never>, optional: Record<string, never>): Promise<AssistantConversation[]>;
  createConversation(required: { firstMessage?: string }, optional: Record<string, never>): Promise<AssistantConversation>;
  renameConversation(required: { id: string; title: string }, optional: Record<string, never>): Promise<void>;
  deleteConversation(required: { id: string }, optional: Record<string, never>): Promise<void>;
  loadMessages(required: { conversationId: string }, optional: Record<string, never>): Promise<ChatMessage[]>;
  saveMessage(required: { conversationId: string; message: ChatMessage }, optional: Record<string, never>): Promise<void>;
}
export interface UseAssistantChats {
  conversations: AssistantConversation[]; activeId: string | null; paneKey: string; initialMessages: ChatMessage[];
  select: (required: { id: string }, optional?: Record<string, never>) => void;
  create: (required: Record<string, never>, optional?: Record<string, never>) => Promise<void>;
  remove: (required: { id: string }, optional?: Record<string, never>) => Promise<void>;
  rename: (required: { id: string; title: string }, optional?: Record<string, never>) => Promise<void>;
  onMessagesChange: (required: { messages: ChatMessage[] }, optional?: Record<string, never>) => void;
  ensureConversationId: (required: Record<string, never>, optional?: Record<string, never>) => Promise<string | null>;
  persistUserTurn: (required: { conversationId: string; message: ChatMessage }, optional?: Record<string, never>) => Promise<void>;
}
export interface AssistantChatsClientPorts {
  readonly statusOf: (required: { error: unknown }, optional: Record<string, never>) => number | undefined;
  readonly sleep: (required: { delayMs: number }, optional: Record<string, never>) => Promise<void>;
  readonly reportPermanent: (required: { conversationId: string; messageId: string; error: unknown }, optional: Record<string, never>) => void;
  readonly requestRunPrefixes: readonly string[];
}
export type SaveOutcome = 'saved' | 'exhausted' | 'permanent' | 'missing';
export type AttemptResult = { done: true; outcome: SaveOutcome } | { done: false };
export interface SaveFailureInput { error: unknown; conversationId: string; message: ChatMessage; attempt: number; isDisposed: () => boolean }
export interface AssistantChatsClient {
  giveUpOutcome(required: { error: unknown }, optional?: Record<string, never>): SaveOutcome;
  handleSaveFailure(required: SaveFailureInput, optional?: Record<string, never>): Promise<AttemptResult>;
  attemptSave(required: Omit<SaveFailureInput, 'error'> & { port: AssistantChatsPort }, optional?: Record<string, never>): Promise<AttemptResult>;
  summarizeFlushOutcomes(required: { results: readonly { message: ChatMessage; outcome: SaveOutcome }[]; isConversationStillActive: boolean }, optional?: Record<string, never>)
    : { idsToRelease: string[]; shouldRefresh: boolean };
  resolveRememberedConversation(required: { remembered: string | null; conversations: readonly AssistantConversation[]; listFailed: boolean }, optional?: Record<string, never>)
    : 'restore' | 'forget' | 'keep';
  useAssistantChats(required: { port: AssistantChatsPort }, optional?: { lastConversation?: LastConversationStore }): UseAssistantChats;
}
/* agent inventory snapshot (session-scoped cache of the last agent list) */
export interface AgentInventoryEntry { readonly id: string; readonly name: string }
export interface AgentInventorySnapshot<T extends AgentInventoryEntry> { read(args: Record<string, never>): readonly T[] | undefined; write(args: { agents: readonly T[] }): void }
export interface AgentInventorySnapshotArgs { readonly storage: Pick<Storage, 'getItem' | 'setItem'>; readonly key: string }
/* assistant client: attachment liveness, durable run following, a2ui poster options */
export interface ChatAttachmentValidatorOptions { readonly fetchImpl?: typeof fetch; readonly concurrency?: number; readonly timeoutMs?: number }
export interface ChatAttachmentValidatorInput {
  readonly fetch: typeof fetch; readonly endpoint: (required: { ref: string }, optional: Record<string, never>) => string;
  readonly isSupportedRef: (required: { ref: string }, optional: Record<string, never>) => boolean; readonly maxProbedAttachments: number;
}
export interface DurableRunBinding { readonly messageId: string; readonly conversationId: string }
export interface DurableSubscriptionPorts {
  readonly read: (required: { runId: string; messageId?: string }, optional: { recover?: boolean }) => Promise<ChatMessage | null | 'gone'>;
  readonly stream: (required: { runId: string; cursor: string; frame: (kind: string, data: string, cursor: string) => void; dropped: (reason?: string) => void }, optional: {}) => () => void;
  readonly schedule: (required: { work: () => void; delayMs: number }, optional: {}) => () => void;
}
export interface CreateA2uiActionPosterOptions { readonly path?: string; readonly timeoutMs?: number; readonly headers?: Readonly<Record<string, string>> }
export type DeliverTypedAnswer = KitDeliverTypedAnswer;
export type UserTextRedactionOptions = KitUserTextRedactionOptions;
