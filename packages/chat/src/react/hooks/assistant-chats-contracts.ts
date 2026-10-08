import type { ChatMessage } from "../../core/messages.js";
import type { AssistantConversation } from "../../core/assistant-client/messages.js";
/**
 * @file What `useAssistantChats` needs from the outside world, as an interface rather than a set of
 * module imports.
 *
 * The hook used to import `lib/assistant-chats`'s functions directly, which meant the only way to
 * test it was to stub the global `fetch` and assert on the URLs and methods that came out — the
 * tests described HTTP when what they meant to describe was "which conversation did this message
 * get written to". Worse, behaviour that has nothing to do with transport (the write retry and its
 * backoff) could only be exercised by hand-building `Response` objects with the right status codes.
 *
 * Declaring the seam here follows the `useX(dependencies)` / `useWiredX()` pair this workspace
 * already uses throughout `@jini-ai/ui` (see `features/html-viewer/react/hooks/usePresentMode.ts`
 * for the canonical shape, and `foundry/docs/jini-port/skills/fixing-open-design-web.md` for the
 * rules). `ports.ts` declares, `assistant-chats-dependencies.ts` binds, and nothing else imports the
 * real provider.
 *
 * `AssistantConversation` is imported here `import type`, which is erased at compile time — so this
 * file still has no runtime dependency on `lib/assistant-chats`, and `dependencies.ts` remains the
 * single place the real implementation is reached.
 *
 * ## What is deliberately NOT in this port
 *
 * `persistableMessages` and `HttpError`. The first is a pure rule — no I/O, no host — and per the
 * pattern a hook imports rules directly rather than having them injected; making it swappable would
 * let a fake quietly change which messages count as settled, which is the one thing every test here
 * needs to hold still. The second is the error type an implementation is expected to throw for a
 * non-2xx response, and it is part of this contract even though it is not a method: {@link
 * AssistantChatsPort.saveMessage}'s retry classifies failures by it.
 */
export interface AssistantChatsPort {
  listConversations(required: Record<string, never>, optional: Record<string, never>): Promise<AssistantConversation[]>;
  /** `firstMessage` seeds the server-side title heuristic; omit it for an untitled empty chat. */
  createConversation(required: { firstMessage?: string }, optional: Record<string, never>): Promise<AssistantConversation>;
  renameConversation(required: { id: string; title: string }, optional: Record<string, never>): Promise<void>;
  deleteConversation(required: { id: string }, optional: Record<string, never>): Promise<void>;
  loadMessages(required: { conversationId: string }, optional: Record<string, never>): Promise<ChatMessage[]>;
  /**
   * Writes one message.
   *
   * Expected to reject with an `HttpError` for a non-2xx response and with anything else for a
   * transport failure — the hook retries the second kind, and the first only for 429/5xx. An
   * implementation that swallows failures into a resolved promise silently disables the retry.
   */
  saveMessage(required: { conversationId: string; message: ChatMessage }, optional: Record<string, never>): Promise<void>;
}

export interface UseAssistantChats {
  conversations: AssistantConversation[];
  activeId: string | null;
  /**
   * `ChatPane`'s `key`. Deliberately NOT `activeId`.
   *
   * Remounting the pane is correct for a user-initiated switch and destructive at any other time: it
   * re-seeds from `initialMessages` and discards whatever the pane currently holds. `activeId` now
   * also changes when an untitled pane silently adopts a freshly created conversation mid-run (see
   * `onMessagesChange`), and re-keying on that would wipe the reply being streamed. So the two are
   * separate: this changes only on `select`/`create`/`remove`, `activeId` tracks where writes go.
   */
  paneKey: string;
  /** Messages to seed the pane with. Changes identity only on a real conversation switch. */
  initialMessages: ChatMessage[];
  select: (required: { id: string }, optional?: Record<string, never>) => void;
  create: (required: Record<string, never>, optional?: Record<string, never>) => Promise<void>;
  remove: (required: { id: string }, optional?: Record<string, never>) => Promise<void>;
  rename: (required: { id: string; title: string }, optional?: Record<string, never>) => Promise<void>;
  onMessagesChange: (required: { messages: ChatMessage[] }, optional?: Record<string, never>) => void;
  /**
   * This pane's conversation id, adopting one if none is active yet. Awaited by
   * `assistant-transport.ts`'s `startRun` so turn 1's run carries the identity its agent-CLI session
   * id gets filed under — see the hook's own implementation doc for the amnesia defect that needs it.
   * Resolves `null` (never rejects) when creation fails.
   */
  ensureConversationId: (required: Record<string, never>, optional?: Record<string, never>) => Promise<string | null>;
  /**
   * Writes one user turn durably, awaited by `assistant-transport.ts`'s `startRun` BEFORE it
   * dispatches the run — see the implementation's own doc for the defect (a failed run's user
   * message reaching no agent and no later prompt). Never rejects; a failed write releases the id
   * so the delta-driven `flush` can still pick it up.
   */
  persistUserTurn: (required: { conversationId: string; message: ChatMessage }, optional?: Record<string, never>) => Promise<void>;
}


export interface AssistantChatsClientPorts {
  readonly statusOf: (required: { error: unknown }, optional: Record<string, never>) => number | undefined;
  readonly sleep: (required: { delayMs: number }, optional: Record<string, never>) => Promise<void>;
  readonly reportPermanent: (required: { conversationId: string; messageId: string; error: unknown }, optional: Record<string, never>) => void;
  readonly requestRunPrefixes: readonly string[];
}

export type SaveOutcome = "saved" | "exhausted" | "permanent" | "missing";
export type AttemptResult = { done: true; outcome: SaveOutcome } | { done: false };
export interface SaveFailureInput {
  error: unknown; conversationId: string; message: ChatMessage; attempt: number; isDisposed: () => boolean;
}
export interface AssistantChatsClient {
  giveUpOutcome(required: { error: unknown }, optional?: Record<string, never>): SaveOutcome;
  handleSaveFailure(required: SaveFailureInput, optional?: Record<string, never>): Promise<AttemptResult>;
  attemptSave(required: Omit<SaveFailureInput, "error"> & { port: AssistantChatsPort }, optional?: Record<string, never>): Promise<AttemptResult>;
  summarizeFlushOutcomes(required: { results: readonly { message: ChatMessage; outcome: SaveOutcome }[]; isConversationStillActive: boolean }, optional?: Record<string, never>): { idsToRelease: string[]; shouldRefresh: boolean };
  resolveRememberedConversation(required: { remembered: string | null; conversations: readonly AssistantConversation[]; listFailed: boolean }, optional?: Record<string, never>): "restore" | "forget" | "keep";
  useAssistantChats(required: { port: AssistantChatsPort }, optional?: { lastConversation?: import("./last-conversation-store.js").LastConversationStore }): UseAssistantChats;
}
