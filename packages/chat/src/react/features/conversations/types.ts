/**
 * @file Ports and published shapes for the stored-conversation controller and its React binding.
 * Typed structurally so a host's own store bridge (an IPC preload object, a fetch client, a fake in
 * a test) satisfies {@link ConversationStorePort} without adapting it, and so a host's own summary
 * DTO flows through untouched as `TSummary`.
 */
import type { ChatMessage } from '../../../core/messages.js';
import type { ConversationListItem } from '../../components/ConversationList.js';

/** The two summary fields the controller itself reads; everything else a host's DTO carries is
 *  passed through as-is. `title` is `null` until the store auto-titles it or someone renames it. */
export interface ConversationSummaryLike {
  id: string;
  title: string | null;
}

/** The conversation store the controller calls. An `undefined` store makes every action a no-op. */
export interface ConversationStorePort<TSummary extends ConversationSummaryLike = ConversationSummaryLike> {
  /** Most-recently-active first. */
  listConversations: () => Promise<readonly TSummary[]>;
  loadConversationMessages: (input: { conversationId: string }) => Promise<ChatMessage[]>;
  createConversation: () => Promise<TSummary>;
  /** Drops the conversation and every message in it. */
  deleteConversation: (input: { id: string }) => Promise<void>;
  renameConversation: (input: { id: string; title: string }) => Promise<void>;
  /** Upserts one message by id into a conversation's transcript. A store is expected to refuse
   *  writes to a deleted conversation. */
  saveConversationMessage: (input: { conversationId: string; message: ChatMessage }) => Promise<void>;
}

/** Where failures are reported. */
export type ConversationLog = (...args: unknown[]) => void;

/** What the controller publishes. See `UseStoredConversations` for why `paneKey` is not `activeId`. */
export interface ConversationState<TSummary extends ConversationSummaryLike = ConversationSummaryLike> {
  conversations: readonly TSummary[];
  activeId: string | null;
  paneKey: string;
  initialMessages: ChatMessage[];
}

export interface ConversationController<TSummary extends ConversationSummaryLike = ConversationSummaryLike> {
  /** The current state. Same object identity until something changes (`useSyncExternalStore`). */
  getState: () => ConversationState<TSummary>;
  /** Calls `listener` after every state change; returns the unsubscribe. */
  subscribe: (input: { listener: () => void }) => () => void;
  /** Re-reads the list; on failure (or with no store) resolves to the list already published. */
  refresh: () => Promise<readonly TSummary[]>;
  select: (input: { id: string }) => void;
  create: () => Promise<void>;
  remove: (input: { id: string }) => Promise<void>;
  rename: (input: { id: string; title: string }) => Promise<void>;
  /** `ChatPane`'s `onMessagesChange` — see `UseStoredConversations.onMessagesChange`. */
  onMessagesChange: (input: { messages: ChatMessage[] }) => void;
}

export interface UseStoredConversations<TSummary extends ConversationSummaryLike = ConversationSummaryLike> {
  conversations: readonly TSummary[];
  activeId: string | null;
  /**
   * `ChatPane`'s `key`. Deliberately NOT `activeId`.
   *
   * `ChatPane` takes `initialMessages` only at MOUNT (`useConversation.ts`'s
   * `useState(options.initialMessages ?? [])`), so switching to a different conversation's
   * transcript means remounting the pane via a changed `key` — pushing new messages into a live
   * pane would fight its own state instead of replacing it. But `activeId` ALSO changes when an
   * untitled pane silently adopts a freshly created conversation mid-turn (see `onMessagesChange`
   * below), and re-keying on THAT would remount the pane out from under a reply it is currently
   * streaming. So the two stay separate: `paneKey` changes only on `select`/`create`/`remove`;
   * `activeId` tracks where the next write goes. Same split as `useAssistantChats`
   * (`../../hooks/assistant-chats-contracts.ts`), which found this the hard way.
   */
  paneKey: string;
  /** Messages to seed the pane with. Changes identity only on a real conversation switch. */
  initialMessages: ChatMessage[];
  select: (id: string) => void;
  create: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  /**
   * `ChatPane`'s `onMessagesChange`. Fires once on MOUNT with whatever `initialMessages` seeded it
   * with (`useChatPane.hooks.ts`'s effect on `conversation.messages`), so a fresh pane with nothing
   * selected calls this with `[]` at mount — `persistableMessages({ messages: [] }).length === 0` makes that a
   * no-op in the controller (`conversation-controller.ts`), rather than mistaking a mount
   * echo for new content to save.
   */
  onMessagesChange: (messages: ChatMessage[]) => void;
}

export interface ConversationDeleteConfirmationState {
  /** The title of the conversation currently asking to be confirmed, or `null` when nothing is
   *  pending. Falls back to the `untitled` label the same way `ConversationList` itself does. */
  pendingTitle: string | null;
  /**
   * `ConversationList`'s `confirmDelete` prop. Deliberately NOT `window.confirm` — a native modal
   * blocks the whole renderer, and in an Electron host that also freezes the IPC its window
   * answers on. This returns a promise that resolves only when the user answers the inline
   * confirmation the host's pane renders from `pendingTitle`.
   */
  confirmDelete: (item: ConversationListItem) => Promise<boolean>;
  /** Answers the pending confirmation, if any. A no-op when nothing is pending. */
  resolvePending: (input: { confirmed: boolean }) => void;
}
