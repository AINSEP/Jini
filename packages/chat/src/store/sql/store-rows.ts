/**
 * Pure row shapes, encoders and decoders for the owner-bound SQL chat store. Nothing here touches
 * a kernel, a transaction or a clock: the transactional writers in `store-writes.ts` and the query
 * builders in `store-queries.ts` import these, so encoding can change without moving a write
 * across a transaction boundary.
 */
import { sql } from 'kysely';
import type { OnConflictBuilder } from 'kysely';
import type { ChatMessage } from '../../core/messages.js';
import type { ChatConversation, ChatTitleSource } from '../ports.js';
import { ChatStoreError } from '../errors.js';
import type { ChatDatabase } from './tables.js';

export const MESSAGE_POSITION = 'm.position';

export const CONVERSATION_UPDATED_AT = 'c.updated_at';

/** UTF-8 byte ordinal ordering, identical on SQLite BINARY and PostgreSQL C collation. */
export function ordinalId(dialect: 'sqlite' | 'postgres', column: 'c.id' | 'm.id') {
  return dialect === 'sqlite' ? sql<string>`${sql.ref(column)} collate BINARY` : sql<string>`${sql.ref(column)} collate "C"`;
}

/** The lock every position-assigning append to one conversation takes. */
export function conversationLockKey(conversationId: string): string {
  return `chat-conversation:${conversationId}`;
}

export interface ConversationRow {
  id: string;
  title: string | null;
  title_source: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  pinned_at: number | null;
  message_count: number | string | bigint | null;
}

export interface MessageRow {
  id: string;
  role: string;
  content: string;
  agent_id: string | null;
  agent_name: string | null;
  events_json: string | null;
  attachments_json: string | null;
  run_id: string | null;
  run_status: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export function toConversation(row: ConversationRow): ChatConversation {
  return {
    id: row.id,
    title: row.title,
    titleSource: row.title_source as ChatTitleSource,
    ...(row.pinned_at === null ? {} : { pinned: true }),
    // COUNT(*) never yields null; Number() also maps a driver's string/bigint count.
    messageCount: Number(row.message_count),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.expires_at === null ? {} : { expiresAt: Number(row.expires_at) }),
  };
}

/**
 * A malformed JSON column yields `undefined` rather than throwing: one half-written `events_json`
 * must not make the whole conversation unreadable (same rule as Jini's store).
 */
function safeParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** A NULL (or empty) JSON column is absent; anything else goes through {@link safeParse}. */
export function parseJsonColumn(value: string | null): any {
  return value ? safeParse(value) : undefined;
}

/** Serialize an optional JSON column: an absent or empty value is stored as SQL NULL. */
function encodeJsonColumn(value: unknown): string | null {
  return value ? JSON.stringify(value) : null;
}

/**
 * The `ai_chat_messages` insert values for one message at a fixed position. `now` is only called
 * when the message carries no `createdAt`, so a counting clock sees exactly the reads it always did.
 */
export function encodeMessageRow(
  { message: m, conversationId, position, now }: { message: ChatMessage; conversationId: string; position: number; now: () => number },
  _optional = {},
) {
  return {
    id: m.id,
    conversation_id: conversationId,
    role: m.role,
    content: m.content,
    agent_id: m.agentId ?? null,
    agent_name: m.agentName ?? null,
    events_json: encodeJsonColumn(m.events),
    attachments_json: encodeJsonColumn(m.attachments),
    run_id: m.runId ?? null,
    run_status: m.runStatus ?? null,
    position,
    created_at: m.createdAt ?? now(),
    started_at: m.startedAt ?? null,
    ended_at: m.endedAt ?? null,
  };
}

/** Receipt-bearing user rows retain their public metadata while large assistant histories stay
 * outside recovery/acceptance projections. Both dialects evaluate the same CASE expression. */
export function messageEventsColumn({ includeEvents }: { includeEvents: boolean | "user" }, _options = {}) {
  if (includeEvents === 'user') return sql<string | null>`case when m.role = 'user' then m.events_json else null end`;
  return includeEvents ? sql<string | null>`m.events_json` : sql<string | null>`null`;
}

/** The bounded history reader's projection: no attachment, agent or run column is selected. */
export interface HistoryRow {
  id: string;
  role: string;
  content: string;
  position: number;
  created_at: number;
  events_json: string | null;
}

/** Reject an unbounded or malformed history read before any query runs. */
export function assertHistoryReadBounds({ limit, fromPosition }: { limit: number; fromPosition: number | undefined }): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ChatStoreError({ code: 'invalid-input' });
  if (fromPosition !== undefined && (!Number.isSafeInteger(fromPosition) || fromPosition < 0)) {
    throw new ChatStoreError({ code: 'invalid-input' });
  }
}

/** Project one history row; `events` is present (possibly undefined) only when tool events were asked for. */
export function toHistoryMessage(row: HistoryRow, { includeToolEvents }: { includeToolEvents: boolean }) {
  return { id: row.id, role: row.role as ChatMessage['role'], content: row.content,
    position: Number(row.position), createdAt: Number(row.created_at),
    ...(includeToolEvents ? { events: parseJsonColumn(row.events_json) } : {}),
  };
}

/** @throws {ChatStoreError} `invalid-input` for an out-of-range limit or an over-long/non-string query. */
export function assertHistoryListInputs({ limit, query }: { limit: number; query: unknown }, _optional = {}): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ChatStoreError({ code: 'invalid-input' });
  if (query !== undefined && (typeof query !== 'string' || query.length > 200)) {
    throw new ChatStoreError({ code: 'invalid-input' });
  }
}

export function updateOwnedMessageConflict(oc: OnConflictBuilder<ChatDatabase, "ai_chat_messages">) {
  return oc.column("id")
    .doUpdateSet((eb) => ({
      content: eb.ref("excluded.content"),
      events_json: eb.ref("excluded.events_json"),
      attachments_json: eb.ref("excluded.attachments_json"),
      run_id: eb.ref("excluded.run_id"),
      run_status: eb.ref("excluded.run_status"),
      started_at: eb.ref("excluded.started_at"),
      ended_at: eb.ref("excluded.ended_at"),
    }))
    .where((eb) => eb("ai_chat_messages.conversation_id", "=", eb.ref("excluded.conversation_id")));
}
