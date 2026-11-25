/**
 * Read-side queries of the owner-bound SQL chat store. Every query goes through the injected
 * {@link SqlStoreContext}, so the immutable owner scope, the borrowed kernel and the clock are
 * passed in, never captured from module state.
 */
import { sql, type Kysely } from 'kysely';
import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/core/contracts/storage';
import type { ChatMessage } from '../../core/messages.js';
import { MID_RUN_USER_MESSAGE_EVENT_NAME } from '../../core/turn-usage.js';
import type { ChatConversation, ChatHistoryReader, ChatMessagePageInput, ChatOwnerScope, ChatPageOptions } from '../ports.js';
import type { ChatDatabase } from './tables.js';
import { pageLimit, decodeCursor, encodeCursor } from './cursor.js';
import { sqliteReadVersion } from './read-version.js';
import {
  CONVERSATION_UPDATED_AT, MESSAGE_POSITION, assertHistoryListInputs, assertHistoryReadBounds, messageEventsColumn,
  ordinalId, toConversation, toHistoryMessage,
  type ConversationRow, type MessageRow,
} from './store-rows.js';

/** Everything one store instance needs, injected once by `createSqlChatStore`. */
export interface SqlStoreContext {
  readonly kernel: StorageKernel<Kysely<ChatDatabase>, ChatDatabase>;
  /** The single subset boundary: runs `body` on the borrowed kernel through the table-subset projection. */
  readonly run: <T>(body: (db: Kysely<ChatDatabase>) => T | Promise<T>) => Promise<T>;
  readonly scope: ChatOwnerScope;
  readonly clock: Clock;
  /** Projects a stored row to its public shape (owned by `store.ts`, which also exports it). */
  readonly toMessage: (row: MessageRow) => ChatMessage;
}

type MessageReadOptions = { includeEvents?: boolean | "user" };
type HistoryListOptions = NonNullable<Parameters<ChatHistoryReader['list']>[1]>;
type HistoryReadOptions = NonNullable<Parameters<ChatHistoryReader['read']>[1]>;

// Count embedded user messages in SQL: list/get still return summaries, never whole transcripts.
// Writers store `JSON.stringify` output (no whitespace, as appendedEventsJson also relies on), so
// each mid-run event holds this exact text once; text inside a JSON string has escaped quotes and
// cannot match, and invalid JSON stays readable (it counts what it holds, never throws). Plain
// length/replace run on SQLite and PostgreSQL 14+, unlike `IS JSON` (PostgreSQL 16+).
const MID_RUN_NEEDLE = `"name":"${MID_RUN_USER_MESSAGE_EVENT_NAME}"`;
const MID_RUN_COUNT = sql<number>`((length(coalesce(m.events_json, '')) - length(replace(coalesce(m.events_json, ''), ${sql.lit(MID_RUN_NEEDLE)}, ''))) / ${sql.lit(MID_RUN_NEEDLE.length)})`;

/** This scope's conversations, projected as {@link ConversationRow}s with their message count. */
export function ownedConversations({ ctx, db }: { ctx: SqlStoreContext; db: Kysely<ChatDatabase> }) {
  const { scopeId, ownerKind, ownerId } = ctx.scope;
  return db
    .selectFrom("ai_chats as c")
    .select((eb) => [
      "c.id",
      "c.title",
      "c.title_source",
      "c.created_at",
      CONVERSATION_UPDATED_AT,
      "c.expires_at",
      "c.pinned_at",
      eb
        .selectFrom("ai_chat_messages as m")
        .select(sql<number>`coalesce(sum(1 + case when m.role = 'assistant' then ${MID_RUN_COUNT} else 0 end), 0)`.as("n"))
        .whereRef("m.conversation_id", "=", "c.id")
        .as("message_count"),
    ])
    .where("c.scope_id", "=", scopeId)
    .where("c.owner_kind", "=", ownerKind)
    .where("c.owner_id", "=", ownerId);
}

/** One owner-filtered indexed lookup; missing and foreign IDs both return null. */
export async function getConversation({ ctx, id }: { ctx: SqlStoreContext; id: string }): Promise<ChatConversation | null> {
  const row = await ctx.run((db) => ownedConversations({ ctx, db }).where("c.id", "=", id).executeTakeFirst());
  return row ? toConversation(row as ConversationRow) : null;
}

/** All owned conversations, most recently active first. */
export async function listConversations({ ctx }: { ctx: SqlStoreContext }): Promise<ChatConversation[]> {
  const rows = await ctx.run((db) => ownedConversations({ ctx, db }).orderBy(CONVERSATION_UPDATED_AT, "desc").execute());
  return rows.map((row) => toConversation(row as ConversationRow));
}

/** One scoped projection for all message reads, including the row returned by an upsert. */
export function ownedMessages(
  { ctx, db, conversationId }: { ctx: SqlStoreContext; db: Kysely<ChatDatabase>; conversationId: string },
  { includeEvents = true }: MessageReadOptions = {},
) {
  const { scopeId, ownerKind, ownerId } = ctx.scope;
  return db
      .selectFrom("ai_chat_messages as m")
      .innerJoin("ai_chats as c", "c.id", "m.conversation_id")
      .select([
        "m.id",
        "m.role",
        "m.content",
        "m.agent_id",
        "m.agent_name",
        "m.attachments_json",
        "m.run_id",
        "m.run_status",
        "m.created_at",
        "m.started_at",
        "m.ended_at",
      ])
      .select(messageEventsColumn({ includeEvents }).as('events_json'))
      .where("m.conversation_id", "=", conversationId)
      .where("c.scope_id", "=", scopeId)
      .where("c.owner_kind", "=", ownerKind)
      .where("c.owner_id", "=", ownerId);
}

/** Read owned messages in persisted position order; foreign IDs produce no rows. */
export async function listMessages(
  { ctx, conversationId }: { ctx: SqlStoreContext } & ChatMessagePageInput,
  { includeEvents = true }: MessageReadOptions = {},
): Promise<ChatMessage[]> {
  const rows = await ctx.run(db => ownedMessages({ ctx, db, conversationId }, { includeEvents }).orderBy(MESSAGE_POSITION).execute());
  return rows.map(ctx.toMessage);
}

/** One indexed, owner-scoped row; browser save fences do not need the conversation's history. */
export async function messageById({ ctx, conversationId, messageId }: { ctx: SqlStoreContext; conversationId: string; messageId: string }) {
  const row = await ctx.run(db => ownedMessages({ ctx, db, conversationId }).where('m.id', '=', messageId).executeTakeFirst());
  return row ? ctx.toMessage(row) : null;
}

/** SQLite's connection/external-commit counters avoid reading message rows at all. PG uses
 * MVCC versions from only this conversation's indexed metadata, never large event columns.
 * @complexity O(1) SQLite; O(n) PG message metadata for n messages; O(1) returned bytes.
 */
export async function messagesVersion({ ctx, conversationId }: { ctx: SqlStoreContext; conversationId: string }) {
  const { kernel } = ctx;
  const { scopeId, ownerKind, ownerId } = ctx.scope;
  const row = await ctx.run(db => db.selectFrom('ai_chats as c').select(eb => {
    const version = kernel.dialect === 'sqlite' ? sqliteReadVersion({ kernel })
      : sql<string>`md5(coalesce(${eb.selectFrom('ai_chat_messages as m')
        .select(sql<string>`string_agg(m.id || ':' || cast(m.xmin as text), ',' order by m.position)`.as('versions'))
        .whereRef('m.conversation_id', '=', 'c.id')}, ''))`;
    return version.as('version');
  })
    .where('c.id', '=', conversationId).where('c.scope_id', '=', scopeId)
    .where('c.owner_kind', '=', ownerKind).where('c.owner_id', '=', ownerId).executeTakeFirst());
  return row?.version ?? null;
}

/** Owned message rows in position order, each with SQLite's `json_valid` verdict on its events column. */
export async function messageRowsWithValidity({ ctx, conversationId }: { ctx: SqlStoreContext; conversationId: string }) {
  const valid = ctx.kernel.dialect === 'sqlite' ? sql<number | null>`json_valid(m.events_json)` : sql<number | null>`null`;
  return ctx.run(db => ownedMessages({ ctx, db, conversationId }).select(valid.as('events_json_valid')).orderBy(MESSAGE_POSITION).execute());
}

/** Search + continuation filters for the history list, before ordering and the page limit. */
function historyConversationFilter(
  { ctx, db, query, anchor }: { ctx: SqlStoreContext; db: Kysely<ChatDatabase>; query: string | undefined; anchor: readonly [number, string] | undefined },
) {
  const id = ordinalId(ctx.kernel.dialect, 'c.id');
  let statement = ownedConversations({ ctx, db }).select(eb => eb.selectFrom('ai_chat_messages as first')
    .select('first.content').whereRef('first.conversation_id', '=', 'c.id').where('first.role', '=', 'user')
    .orderBy('first.position').limit(1).as('first_user_line'));
  if (query?.trim()) {
    // Escape LIKE wildcards: user search is literal text, never an SQL/FTS expression.
    const pattern = '%' + query.trim().toLowerCase().replace(/[!%_]/g, char => '!' + char) + '%';
    statement = statement.where(eb => eb.or([
      sql<boolean>`lower(c.title) like ${pattern} escape '!'`,
      eb.exists(eb.selectFrom('ai_chat_messages as found').select('found.id')
        .whereRef('found.conversation_id', '=', 'c.id')
        .where(sql<boolean>`lower(found.content) like ${pattern} escape '!'`)),
    ]));
  }
  if (anchor) statement = statement.where(eb => eb.or([
    eb(CONVERSATION_UPDATED_AT, '<', anchor[0]),
    eb.and([eb(CONVERSATION_UPDATED_AT, '=', anchor[0]), eb(id, '>', anchor[1])]),
  ]));
  return statement;
}

/** Literal search uses two scoped projections, not a transcript fetch per conversation.
 * A continuation is bound to this owner and orders by activity descending, then ID ascending.
 * @throws {ChatStoreError} For invalid inputs or a cursor belonging to another scope.
 * @complexity The database scans owned content for search; at most limit+1 rows are returned.
 */
export async function historyList({ ctx, options }: { ctx: SqlStoreContext; options: HistoryListOptions }) {
  const { query, limit = 20, cursor } = options;
  assertHistoryListInputs({ limit, query });
  const { scope } = ctx;
  const anchor = decodeCursor({ cursor: cursor ?? undefined, kind: 'conversations', scope, conversation: null });
  const id = ordinalId(ctx.kernel.dialect, 'c.id');
  const rows = await ctx.run(db => historyConversationFilter({ ctx, db, query, anchor })
    .orderBy(CONVERSATION_UPDATED_AT, 'desc').orderBy(id, 'asc').limit(limit + 1).execute());
  const items = rows.slice(0, limit).map(row => ({ ...toConversation(row as ConversationRow), firstUserLine: row.first_user_line ?? '' }));
  const last = items.at(-1);
  const nextCursor = rows.length > limit && last
    ? encodeCursor({ kind: 'conversations', scope, conversation: null, anchor: [last.updatedAt, last.id] })
    : null;
  return { items, nextCursor };
}

/** No attachment column is read. O(limit) rows; default tail is reversed into position order. */
export async function historyRead({ ctx, chatId, options }: { ctx: SqlStoreContext; chatId: string; options: HistoryReadOptions }) {
  const { fromPosition, limit = 50, includeToolEvents = false } = options;
  assertHistoryReadBounds({ limit, fromPosition });
  const rows = await ctx.run(db => {
    let statement = ownedMessages({ ctx, db, conversationId: chatId }).clearSelect().select([
      'm.id', 'm.role', 'm.content', MESSAGE_POSITION, 'm.created_at',
    ]);
    if (fromPosition !== undefined) statement = statement.where(MESSAGE_POSITION, '>=', fromPosition);
    return statement.select(includeToolEvents ? sql<string | null>`m.events_json`.as('events_json') : sql<null>`null`.as('events_json'))
      .orderBy(MESSAGE_POSITION, fromPosition === undefined ? 'desc' : 'asc').limit(limit + 1).execute();
  });
  const page = rows.slice(0, limit);
  if (fromPosition === undefined) page.reverse();
  return { messages: page.map(row => toHistoryMessage(row, { includeToolEvents })), hasMore: rows.length > limit };
}

/** One cursor page of owned conversations, activity descending then ID ascending. */
export async function pageConversations({ ctx, options }: { ctx: SqlStoreContext; options: ChatPageOptions }) {
  const { scope } = ctx;
  const limit = pageLimit({ options: options });
  const anchor = decodeCursor({ cursor: options?.cursor, kind: 'conversations', scope: scope, conversation: null });
  const id = ordinalId(ctx.kernel.dialect, 'c.id');
  const rows = await ctx.run(db => {
    let query = ownedConversations({ ctx, db });
    if (anchor) query = query.where(eb => eb.or([
      eb(CONVERSATION_UPDATED_AT, '<', anchor[0]),
      eb.and([eb(CONVERSATION_UPDATED_AT, '=', anchor[0]), eb(id, '>', anchor[1])]),
    ]));
    return query.orderBy(CONVERSATION_UPDATED_AT, 'desc').orderBy(id, 'asc').limit(limit + 1).execute();
  });
  const items = rows.slice(0, limit).map(row => toConversation(row as ConversationRow));
  const last = items.at(-1);
  return { items, ...(rows.length > limit && last ? {
    nextCursor: encodeCursor({ kind: 'conversations', scope: scope, conversation: null, anchor: [last.updatedAt, last.id] }),
  } : {}) };
}

/** One cursor page of an owned conversation's messages, position ascending then ID ascending. */
export async function pageMessages({ ctx, input, options }: { ctx: SqlStoreContext; input: ChatMessagePageInput; options: ChatPageOptions }) {
  const { scope } = ctx;
  const limit = pageLimit({ options: options });
  const anchor = decodeCursor({ cursor: options?.cursor, kind: 'messages', scope: scope, conversation: input.conversationId });
  const id = ordinalId(ctx.kernel.dialect, 'm.id');
  // One join, at most limit+1 rows, including the ownership check; no parent pre-read.
  const rows = await ctx.run(db => {
    let query = ownedMessages({ ctx, db, conversationId: input.conversationId }).select(MESSAGE_POSITION);
    if (anchor) query = query.where(eb => eb.or([
      eb(MESSAGE_POSITION, '>', anchor[0]),
      eb.and([eb(MESSAGE_POSITION, '=', anchor[0]), eb(id, '>', anchor[1])]),
    ]));
    return query.orderBy(MESSAGE_POSITION, 'asc').orderBy(id, 'asc').limit(limit + 1).execute();
  });
  const page = rows.slice(0, limit), last = page.at(-1);
  return { items: page.map(ctx.toMessage), ...(rows.length > limit && last ? {
    nextCursor: encodeCursor({ kind: 'messages', scope: scope, conversation: input.conversationId, anchor: [Number(last.position), last.id] }),
  } : {}) };
}
