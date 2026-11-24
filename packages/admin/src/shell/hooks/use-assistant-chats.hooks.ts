import { useMemo } from "react";
import type { ChatMessage } from "../../react/kit.js";
import type { AssistantChatsPort, AssistantConversation } from "./assistant-chats-port.hooks";

/** Structural slice of the chat library's last-conversation store (admin takes no dependency on the chat package). */
export interface LastConversationStore {
  /** The remembered conversation id, or `null` when there is none or storage is unusable. */
  read(): string | null;
  /** Remembers `conversationId` as the one to land on next time, replacing any earlier one. */
  write(conversationId: string): void;
  /** Forgets the remembered id — for a conversation that was deleted or is no longer reachable. */
  clear(): void;
}

/** Structural slice of the chat library's own port shape (object arguments plus an optional pad). */
export interface ChatLibraryPort {
  listConversations(required: Record<string, never>, optional: Record<string, never>): Promise<AssistantConversation[]>;
  /** `firstMessage` seeds the server-side title heuristic; omit it for an untitled empty chat. */
  createConversation(required: { firstMessage?: string }, optional: Record<string, never>): Promise<AssistantConversation>;
  renameConversation(required: { id: string; title: string }, optional: Record<string, never>): Promise<void>;
  deleteConversation(required: { id: string }, optional: Record<string, never>): Promise<void>;
  loadMessages(required: { conversationId: string }, optional: Record<string, never>): Promise<ChatMessage[]>;
  saveMessage(required: { conversationId: string; message: ChatMessage }, optional: Record<string, never>): Promise<void>;
}

/** Structural slice of the chat library's client: the host builds it with its error classifier, sleep and reporter. */
export interface AssistantChatsClient {
  useAssistantChats(required: { port: ChatLibraryPort }, optional?: { lastConversation?: LastConversationStore | undefined }): ChatLibraryChats;
}

/** The chat library's own result: the same state as {@link UseAssistantChats}, with object-shaped actions plus an optional pad. */
export interface ChatLibraryChats extends Omit<UseAssistantChats, "select" | "create" | "remove" | "rename" | "onMessagesChange" | "ensureConversationId" | "persistUserTurn"> {
  select: (required: { id: string }, optional?: Record<string, never>) => void;
  create: (required: Record<string, never>, optional?: Record<string, never>) => Promise<void>;
  remove: (required: { id: string }, optional?: Record<string, never>) => Promise<void>;
  rename: (required: { id: string; title: string }, optional?: Record<string, never>) => Promise<void>;
  onMessagesChange: (required: { messages: ChatMessage[] }, optional?: Record<string, never>) => void;
  ensureConversationId: (required: Record<string, never>, optional?: Record<string, never>) => Promise<string | null>;
  persistUserTurn: (required: { conversationId: string; message: ChatMessage }, optional?: Record<string, never>) => Promise<void>;
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
  select: (required: { id: string }) => void;
  create: () => Promise<void>;
  remove: (required: { id: string }) => Promise<void>;
  rename: (required: { id: string; title: string }) => Promise<void>;
  onMessagesChange: (required: { messages: ChatMessage[] }) => void;
  /**
   * This pane's conversation id, adopting one if none is active yet. Awaited by
   * `assistant-transport.ts`'s `startRun` so turn 1's run carries the identity its agent-CLI session
   * id gets filed under — see the hook's own implementation doc for the amnesia defect that needs it.
   * Resolves `null` (never rejects) when creation fails.
   */
  ensureConversationId: () => Promise<string | null>;
  /**
   * Writes one user turn durably, awaited by `assistant-transport.ts`'s `startRun` BEFORE it
   * dispatches the run — see the implementation's own doc for the defect (a failed run's user
   * message reaching no agent and no later prompt). Never rejects; a failed write releases the id
   * so the delta-driven `flush` can still pick it up.
   */
  persistUserTurn: (required: { conversationId: string; message: ChatMessage }) => Promise<void>;
}


/** Adapt the host's chats port to the chat library's; the library owns all conversation state and retry behavior.
 *  Exported so the argument mapping is verified directly. */
export function sharedPort(port: AssistantChatsPort): ChatLibraryPort {
  return {
    listConversations: () => port.listConversations(),
    createConversation: ({ firstMessage }) => firstMessage === undefined ? port.createConversation({}) : port.createConversation({}, { firstMessage }),
    renameConversation: ({ id, title }) => port.renameConversation({ id, title }),
    deleteConversation: ({ id }) => port.deleteConversation({ id }),
    loadMessages: ({ conversationId }) => port.loadMessages({ conversationId }),
    saveMessage: ({ conversationId, message }) => port.saveMessage({ conversationId, message }),
  };
}

/**
 * The assistant's conversation list and active chat over the host's chats port.
 * @param input.port - The host's chats port (HTTP in production, a fake in tests).
 * @param input.client - The chat client carrying the host's error classifier, sleep and reporter (required; Jini ships no default).
 * @param input.lastConversation - Remembers the last open conversation per signed-in user; omitted, none is remembered.
 */
export function useAssistantChats(
  { port, client, lastConversation }: { port: AssistantChatsPort; client: AssistantChatsClient; lastConversation?: LastConversationStore },
  _optional: Record<string, never> = {},
): UseAssistantChats {
  const chats = client.useAssistantChats({ port: sharedPort(port) }, { lastConversation });
  // Keep the action callbacks stable while forwarding to the library's object-shaped boundary.
  const actions = useMemo(() => ({
    select: ({ id }: { id: string }, _options = {}) => chats.select({ id }, {}),
    create: () => chats.create({}, {}),
    remove: ({ id }: { id: string }, _options = {}) => chats.remove({ id }, {}),
    rename: ({ id, title }: { id: string; title: string }, _options = {}) => chats.rename({ id, title }, {}),
    onMessagesChange: ({ messages }: { messages: ChatMessage[] }, _options = {}) => chats.onMessagesChange({ messages }, {}),
    ensureConversationId: () => chats.ensureConversationId({}, {}),
    persistUserTurn: ({ conversationId, message }: { conversationId: string; message: ChatMessage }, _options = {}) => chats.persistUserTurn({ conversationId, message }, {}),
  }), [chats.select, chats.create, chats.remove, chats.rename, chats.onMessagesChange, chats.ensureConversationId, chats.persistUserTurn]);
  return { ...chats, ...actions };
}
