/** Owner-scoped, provider-neutral durable transcripts. See README for paging and composition. */
// The contract stays with chat's message model: placing it in a lower-level dependency would
// require a reverse dependency on ChatMessage or a second, drifting definition of that shape.
// Types only belong here; drivers, database lifetime and migration execution belong to adapters.
import type { ChatMessage } from '../core/messages.js';

export type ChatOwnerKind = 'user' | 'guest';
// Separate owner kinds preserve different disclosure/retention rules: an anonymous identifier is
// a bearer credential stored as a hash, while authenticated account history can be non-expiring.
export type ChatTitleSource = 'fallback' | 'generated' | 'manual';

export interface ChatOwnerScope {
  readonly scopeId: string;
  readonly ownerKind: ChatOwnerKind;
  /** Guest identifier is already hashed by the host. Never a raw bearer token. */
  readonly ownerId: string;
}

export interface ChatConversation {
  readonly id: string;
  readonly title: string | null;
  readonly titleSource: ChatTitleSource;
  // Compute counts with the conversation projection; fetching them one conversation at a time
  // would turn a list into N+1 database round trips.
  readonly messageCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Epoch milliseconds; absence means retained until explicitly deleted. */
  readonly expiresAt?: number;
}

export interface CreateChatConversationInput {
  readonly id: string;
  readonly title?: string | null;
  readonly titleSource?: ChatTitleSource;
  readonly expiresAt?: number;
}

/** Versioned opaque continuation, not an offset or a driver cursor object. */
export type ChatPageCursor = string;

export interface ChatPageOptions {
  /** Default 50; integer from 1 through 200. */
  readonly limit?: number;
  readonly cursor?: ChatPageCursor;
}

export interface ChatPage<T> {
  readonly items: readonly T[];
  /** Absent when this page has no continuation. */
  readonly nextCursor?: ChatPageCursor;
}

export interface ChatMessagePageInput {
  readonly conversationId: string;
}

export interface ChatSearchInput {
  /** Plain human text, never an FTS expression or SQL fragment. */
  readonly query: string;
  readonly conversationId?: string;
}

export interface ChatSearchHit {
  readonly conversationId: string;
  readonly messageId: string;
  readonly excerpt: string;
  /** Relative relevance within this response only, never cross-provider comparable. */
  readonly score?: number;
}

/** Optional capability. No implementation of this interface is promised in this move. */
export interface ChatSearchCapability {
  readonly consistency: 'immediate' | 'eventual';
  search(
    input: ChatSearchInput,
    options?: ChatPageOptions,
  ): Promise<ChatPage<ChatSearchHit>>;
}

/**
 * Every instance is permanently bound to one immutable owner scope.
 * Required identity/payload arguments and optional policy/paging arguments occupy separate bags.
 * Omitted rename source is manual; omitted touch expiry preserves the persisted expiry.
 * @example store.rename({ id, title }, { source: 'generated' }); store.pageConversations({}, { limit: 50 })
 */
// Binding authentication once removes the per-call opportunity to forget the owner predicate.
// A bare ID may name somebody else's conversation; the store must never expose an unscoped read.
export interface ChatStore {
  /** Compatibility read: all owned conversations, updatedAt descending. */
  list(): Promise<ChatConversation[]>;
  /** Unknown and other-owned IDs both return null. */
  // Distinguishing these misses would disclose that another owner's conversation exists.
  get(required: { readonly id: string }, optional?: Record<string, never>): Promise<ChatConversation | null>;
  create(input: CreateChatConversationInput, optional?: Record<string, never>): Promise<ChatConversation>;
  /** A generated title must not overwrite a manual title. Default source: manual. */
  // Persist title provenance and enforce this in the adapter, so hosts cannot accidentally let
  // an automatic title replace an operator's rename.
  rename(
    required: { readonly id: string; readonly title: string },
    optional?: { readonly source?: ChatTitleSource },
  ): Promise<ChatConversation | null>;
  touch(required: { readonly id: string }, optional?: { readonly expiresAt?: number }): Promise<void>;
  /** Cascades messages; unknown/other-owned IDs are no-ops. */
  delete(required: { readonly id: string }, optional?: Record<string, never>): Promise<void>;
  /** Compatibility read: all messages in stored position order; unauthorized returns []. */
  messages(required: ChatMessagePageInput, optional?: Record<string, never>): Promise<ChatMessage[]>;
  /** Idempotent update by message ID within its original conversation; unauthorized: null. */
  appendMessage(
    required: { readonly conversationId: string; readonly message: ChatMessage },
    optional?: Record<string, never>,
  ): Promise<ChatMessage | null>;
  pageConversations(required: Record<string, never>, optional?: ChatPageOptions): Promise<ChatPage<ChatConversation>>;
  pageMessages(
    input: ChatMessagePageInput,
    options?: ChatPageOptions,
  ): Promise<ChatPage<ChatMessage>>;
  readonly search?: ChatSearchCapability;
}

/** Eight-method subset for hosts/fakes without paging; shares the object call contract. */
export type ChatHistoryStore = Pick<
  ChatStore,
  | 'list' | 'get' | 'create' | 'rename' | 'touch' | 'delete'
  | 'messages' | 'appendMessage'
>;

/** Authority for cross-owner retention must never reach ordinary request handlers. */
export interface ChatHistoryMaintenance {
  /** Delete at most limit conversations; default 500, integer 1..500. */
  sweepExpired(required: { readonly now: number }, optional?: { readonly limit?: number }): Promise<number>;
}

/** Bind one immutable owner scope; no per-call escape to an unscoped store. */
export type ChatStoreFactory = (required: { readonly scope: ChatOwnerScope }, optional?: Record<string, never>) => ChatStore;

export type ChatStoreErrorCode =
  | 'invalid-input'
  | 'invalid-cursor'
  | 'conflict'
  | 'unavailable';

/** Runtime error class in src/store/errors.ts; preserve the original error as cause. */
export interface ChatStoreError extends Error {
  readonly name: 'ChatStoreError';
  readonly code: ChatStoreErrorCode;
}
