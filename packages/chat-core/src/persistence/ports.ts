/**
 * @module persistence/ports
 *
 * The storage-neutral contract for durable chat history: conversations and their messages,
 * scoped to an owner. Types and signatures only — this module imports no driver, opens no
 * file, and issues no DDL, so it stays inside `chat-core`'s `runtime: universal` promise.
 *
 * Why here and not in `@jini-ai/agentic`: `chat-core` already depends on `agentic`, so a port
 * living in `agentic` could not import {@link ChatMessage} — the type it exists to persist —
 * without inverting that edge. It would have to redefine the message shape (two sources of
 * truth) or be generic over an opaque type (a persistence abstraction naming nothing).
 *
 * Why the owner scope is baked into the port rather than passed per call: every read must be
 * `WHERE scope = ? AND owner = ? AND id = ?`, never `WHERE id = ?`. A port whose methods take
 * a bare id invites exactly one bug — a handler that forgets the predicate — and that bug is
 * an omission, so review does not reliably catch it. {@link ChatHistoryStore} is obtained
 * already-bound to a {@link ChatOwnerScope}; there is no method on it that can read across
 * owners. Hosts bind the scope from their own auth, which is the one part of this that cannot
 * be reused.
 */
import type { ChatMessage } from '../messages.js';

/**
 * Which kind of principal owns a conversation.
 *
 * `user` is an authenticated account; `guest` is an anonymous visitor identified only by an
 * opaque bearer token. They are separated rather than collapsed into one `ownerId` because the
 * retention and disclosure rules differ: guest history expires, user history does not, and a
 * guest's identifier is a credential that must be stored hashed.
 */
export type ChatOwnerKind = 'user' | 'guest';

/**
 * The isolation predicate, resolved by the host from its own authentication, and bound into a
 * store before any query runs.
 *
 * `scopeId` is the host's partition key — a workspace, a tenant, a project, whatever that host
 * partitions by. This package does not interpret it; it only guarantees every statement filters
 * on it.
 *
 * `ownerId` for a `guest` MUST already be hashed by the host. This package never sees, stores,
 * or logs a raw bearer token, and cannot verify that a caller honored this — it is stated here
 * because the constraint is real and the type system cannot express it.
 */
export interface ChatOwnerScope {
  readonly scopeId: string;
  readonly ownerKind: ChatOwnerKind;
  readonly ownerId: string;
}

/** Where a conversation's current title came from — see {@link ChatHistoryStore.rename}. */
export type ChatTitleSource = 'fallback' | 'generated' | 'manual';

/**
 * A conversation as the list UI needs it: enough to render a row without loading any messages.
 *
 * `messageCount` is computed by the adapter in the same round-trip as the list itself, so a
 * list of N conversations costs one query rather than N+1.
 */
export interface ChatConversation {
  readonly id: string;
  readonly title: string | null;
  readonly titleSource: ChatTitleSource;
  readonly messageCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Absent means no expiry — the row is retained until explicitly deleted. */
  readonly expiresAt?: number;
}

/** Everything a host may specify when starting a conversation. */
export interface CreateChatConversationInput {
  readonly id: string;
  readonly title?: string | null;
  readonly titleSource?: ChatTitleSource;
  /** Epoch ms. Omit for history that never expires. */
  readonly expiresAt?: number;
}

/**
 * Durable chat history for exactly one {@link ChatOwnerScope}.
 *
 * Every method is already scoped. `get(id)` for an id belonging to another owner resolves to
 * `null` rather than throwing — a caller must not be able to distinguish "does not exist" from
 * "exists but is not yours", since that distinction is itself an enumeration oracle.
 */
export interface ChatHistoryStore {
  /** Most-recently-updated first. */
  list(): Promise<ChatConversation[]>;
  /** `null` when the id does not exist *or* is not owned by this scope. */
  get(id: string): Promise<ChatConversation | null>;
  create(input: CreateChatConversationInput): Promise<ChatConversation>;
  /**
   * Sets the title and stamps `titleSource`. A `manual` title is never overwritten by a
   * `generated` one — that rule lives in the adapter so no host can forget it, and it is the
   * reason `titleSource` is a column rather than a UI concern.
   */
  rename(id: string, title: string, source?: ChatTitleSource): Promise<ChatConversation | null>;
  /** Bumps `updatedAt`, optionally extending expiry for a still-active guest session. */
  touch(id: string, options?: { readonly expiresAt?: number }): Promise<void>;
  /** Cascades to the conversation's messages. No-op when the id is not owned by this scope. */
  delete(id: string): Promise<void>;
  /** Ordered by position. Empty when the id is not owned by this scope. */
  messages(conversationId: string): Promise<ChatMessage[]>;
  /**
   * Inserts or updates one message, assigning the next position on insert.
   *
   * `null` when the conversation is not owned by this scope — so a mis-scoped write is a
   * no-op rather than a cross-owner insert.
   */
  appendMessage(conversationId: string, message: ChatMessage): Promise<ChatMessage | null>;
}

/**
 * Retention. Deliberately NOT on {@link ChatHistoryStore}: a sweep runs across every owner, so
 * putting it on a per-owner store would require an unscoped store to exist, which is the exact
 * escape hatch this design removes.
 */
export interface ChatHistoryMaintenance {
  /**
   * Hard-deletes conversations whose `expiresAt` is at or before `now`, cascading to messages.
   *
   * `limit` bounds one call so a large backlog is drained in chunks rather than held in a
   * single long write transaction — an unbounded `DELETE` is what starves concurrent inserts.
   * Returns the number of conversations deleted, so a caller can loop until it reports 0.
   */
  sweepExpired(now: number, limit?: number): Promise<number>;
}
