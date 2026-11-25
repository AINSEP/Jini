/** One SQL query body upstreamed from the existing host adapter; no resource/schema ownership. */
// Legacy project/conversation CRUD trusts access to a local database file; this owner-bound store
// serves shared databases instead. Choose by trust model: borrowing a handle must not grant access
// to every tenant, and this adapter neither chooses that handle's file nor owns its lifetime.
/**
 * Every read/write uses the authenticated (scope_id, owner_kind, owner_id) tuple; store construction
 * must not turn a shared database into access to other owners' conversations. Append reads and
 * assigns position in one transaction under the conversation lock: PostgreSQL READ COMMITTED alone
 * cannot serialize two appends as SQLite BEGIN IMMEDIATE does. The unique conversation/position
 * constraint remains the backstop, and nested appends join the host's existing transaction.
 */
import type { Kysely } from 'kysely';
import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/core/contracts/storage';
import { foldersFromReceipts } from '../../core/accepted-input.js';
import { redactUserMessage, type UserTextRedactionOptions } from '../../core/user-text-redaction.js';
import type { ChatMessage } from '../../core/messages.js';
import { MID_RUN_USER_MESSAGE_EVENT_NAME } from '../../core/turn-usage.js';
import type { ChatStore, ChatOwnerScope } from '../ports.js';
import type { ChatDatabase } from './tables.js';
import { copyScope, atStoreBoundary, chatKernelTables, runChatQuery } from './boundary.js';
import { parseJsonColumn, type MessageRow } from './store-rows.js';
import {
  getConversation, historyList, historyRead, listConversations, listMessages, messageById, messageRowsWithValidity,
  messagesVersion, pageConversations, pageMessages, type SqlStoreContext,
} from './store-queries.js';
import { createConversation, deleteConversation, renameConversation, touchConversation, writeMessage } from './store-writes.js';

/** Project only existing ai_* fields: resumable and lastRunEventId belong to run state. */
// Both fields disappear on a transcript round trip today. Adding columns alone would let the
// browser persist claims about a run it does not own. First associate the run with its conversation
// and let the daemon persist authoritative stream/terminal state, then extend storage for it.
// The legacy messages store does retain last_run_event_id; that is a separate trust model, not
// evidence that this projection preserves it. A schema extension also needs host-owned follow-up
// migrations, because changing the DDL constant cannot update databases already migrated.
export function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id, role: row.role as ChatMessage['role'], content: row.content,
    ...agentFields(row),
    ...jsonFields(row),
    ...runFields(row),
    createdAt: Number(row.created_at),
    ...(row.started_at === null ? {} : { startedAt: Number(row.started_at) }),
    ...(row.ended_at === null ? {} : { endedAt: Number(row.ended_at) }),
  };
}

/** Empty agent columns are omitted, not projected as empty strings. */
function agentFields(row: MessageRow): Pick<ChatMessage, 'agentId' | 'agentName'> {
  return {
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.agent_name ? { agentName: row.agent_name } : {}),
  };
}

/** Unparseable or absent JSON columns are omitted rather than failing the read. */
function jsonFields(row: MessageRow): Pick<ChatMessage, 'events' | 'attachments' | 'folders'> {
  const events = parseJsonColumn(row.events_json);
  const attachments = parseJsonColumn(row.attachments_json);
  const folders = foldersFromReceipts({ events });
  return {
    ...(events === undefined ? {} : { events }),
    ...(folders.length ? { folders } : {}),
    ...(attachments === undefined ? {} : { attachments }),
  };
}

/** Project metadata without retaining assistant event trees. User folder receipts still hydrate
 * through the existing mapper; unusual assistant receipts with folders need the same projection. */
function rawMessageMetadata({ row }: { row: MessageRow }, _optional = {}): ChatMessage {
  const hasFolderReceipt = row.events_json?.includes(`"name":"${MID_RUN_USER_MESSAGE_EVENT_NAME}"`) && row.events_json.includes('"folders"');
  const needsReceipts = row.role === 'user' || hasFolderReceipt;
  const message = toMessage({ ...row, events_json: needsReceipts ? row.events_json : null });
  delete message.events;
  return message;
}

/** Empty run columns are omitted. */
function runFields(row: MessageRow): Pick<ChatMessage, 'runId' | 'runStatus'> {
  return {
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.run_status ? { runStatus: row.run_status as NonNullable<ChatMessage['runStatus']> } : {}),
  };
}

type RawMessageRow = MessageRow & { events_json_valid: number | null };

/** Keep malformed-column tolerance without reserializing event trees. SQLite validates in SQL;
 * PostgreSQL 14 lacks a safe built-in JSON try-cast, so validate and discard one row's parsed value.
 * @complexity O(row JSON size) time; PG14 temporarily allocates one event tree, SQLite none. */
export function validatedEventsJson({ row }: { row: Pick<RawMessageRow, "events_json" | "events_json_valid"> }, _optional = {}): string | undefined {
  if (!row.events_json) return undefined;
  if (row.events_json_valid !== null) return Number(row.events_json_valid) === 1 ? row.events_json : undefined;
  try { JSON.parse(row.events_json); return row.events_json; }
  catch { return undefined; }
}

/** Emit metadata and opaque event JSON separately, so neither an aggregate response string nor
 * all parsed assistant events coexist. The borrowed query still holds O(total stored JSON) strings.
 * @complexity O(total JSON bytes) time/retained raw strings; PG validation peaks at one event tree. */
async function* messageJsonChunks(
  { rows }: { rows: RawMessageRow[] },
  { orderMessages = messages => messages }: { orderMessages?: (messages: ChatMessage[]) => ChatMessage[] } = {},
): AsyncIterable<string> {
  const byId = new Map(rows.map(row => [row.id, row]));
  const messages = orderMessages(rows.map(row => rawMessageMetadata({ row })));
  yield '{"messages":[';
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    const eventsJson = validatedEventsJson({ row: byId.get(message.id)! });
    if (index > 0) yield ',';
    const metadataJson = JSON.stringify(message);
    if (eventsJson === undefined) { yield metadataJson; continue; }
    yield metadataJson.slice(0, -1) + ',"events":';
    yield eventsJson;
    yield '}';
  }
  yield ']}';
}

/**
 * Returns a {@link ChatHistoryStore} that can only ever see `scope`'s own conversations.
 *
 * @param kernel the borrowed kernel. Nothing here opens, closes or configures a database; SQLite's
 *   `ON DELETE CASCADE` needs `foreign_keys = ON`, which the host must enable.
 * @param scope the isolation predicate, resolved from the host's authentication. For a guest,
 *   `ownerId` must already be a hash of the session key (`tenant-scope.ts`).
 * @param clock the host's core Clock; tests pass a fake for deterministic time.
 * @complexity each method is one to four indexed statements; conversation summaries scan their
 *   messages and embedded events in SQL; `messages` is O(messages in the conversation).
 */
export function createSqlChatStore<DB extends ChatDatabase>(
  { kernel, scope: inputScope, clock }: { kernel: StorageKernel<Kysely<DB>, DB>; scope: ChatOwnerScope; clock: Clock },
  redactionOptions: UserTextRedactionOptions = {},
): ChatStore {
  // The single subset boundary: DB must contain both required table definitions. Extra host tables
  // stay on the exact borrowed kernel; its transaction context is never projected or recreated.
  const ctx: SqlStoreContext = {
    kernel: chatKernelTables<DB>({ kernel }, {}),
    run: body => runChatQuery({ kernel: kernel, body: body }),
    scope: copyScope({ scope: inputScope }),
    clock,
    toMessage,
  };
  return wrapAtStoreBoundary(createRawChatStore({ ctx, redactionOptions }));
}

/** The raw store: every method delegates to a query/write function; errors are not yet translated. */
function createRawChatStore({ ctx, redactionOptions }: { ctx: SqlStoreContext; redactionOptions: UserTextRedactionOptions }): ChatStore {
  return {
    history: {
      list: (_required, options = {}) => historyList({ ctx, options }),
      read: ({ chatId }, options = {}) => historyRead({ ctx, chatId, options }),
    },
    list: () => listConversations({ ctx }),
    get: ({ id }, _optional = {}) => getConversation({ ctx, id }),
    create: (input, _optional = {}) => createConversation({ ctx, input }),
    rename: ({ id, title }, { source = "manual" } = {}) => renameConversation({ ctx, id, title, source }),
    touch: ({ id }, options = {}) => touchConversation({ ctx, id, options }),
    delete: ({ id }, _optional = {}) => deleteConversation({ ctx, id }),
    messages: ({ conversationId }, { includeEvents = true } = {}) => listMessages({ ctx, conversationId }, { includeEvents }),
    message: ({ conversationId, messageId }, _optional = {}) => messageById({ ctx, conversationId, messageId }),
    messagesVersion: ({ conversationId }, _optional = {}) => messagesVersion({ ctx, conversationId }),
    async messagesJson({ conversationId }, optional = {}) {
      return messageJsonChunks({ rows: await messageRowsWithValidity({ ctx, conversationId }) }, optional);
    },
    appendMessage: ({ conversationId, message }, _optional = {}) => appendRedacted({ ctx, redactionOptions, conversationId, message }),
    pageConversations: (_required, options = {}) => pageConversations({ ctx, options }),
    pageMessages: (input, options = {}) => pageMessages({ ctx, input, options }),
  };
}

/** Redact the user text first, write once, then report (never log) that a secret was removed. */
async function appendRedacted(
  { ctx, redactionOptions, conversationId, message }: { ctx: SqlStoreContext; redactionOptions: UserTextRedactionOptions; conversationId: string; message: ChatMessage },
): Promise<ChatMessage | null> {
  const prepared = redactUserMessage({ message }, { ...(redactionOptions.redactUserText ? { redactUserText: redactionOptions.redactUserText } : {}) });
  const saved = await writeMessage({ ctx, conversationId, message: prepared.message });
  if (!saved || !prepared.secretRedacted) return saved;
  const signal = { secretRedacted: true as const, count: prepared.count };
  redactionOptions.onSecretRedacted?.(signal);
  return { ...saved, secretRedaction: signal };
}

/** Wrap every operation so a driver failure surfaces as a structured {@link ChatStoreError}. */
function wrapAtStoreBoundary(store: ChatStore): ChatStore {
  return {
    history: {
      list: (required, optional = {}) => atStoreBoundary({ operation: () => store.history!.list(required, optional) }),
      read: (required, optional = {}) => atStoreBoundary({ operation: () => store.history!.read(required, optional) }),
    },
    list: () => atStoreBoundary({ operation: () => store.list() }),
    get: (required, optional = {}) => atStoreBoundary({ operation: () => store.get(required, optional) }),
    create: (required, optional = {}) => atStoreBoundary({ operation: () => store.create(required, optional) }),
    rename: (required, optional = {}) => atStoreBoundary({ operation: () => store.rename(required, optional) }),
    touch: (required, optional = {}) => atStoreBoundary({ operation: () => store.touch(required, optional) }),
    delete: (required, optional = {}) => atStoreBoundary({ operation: () => store.delete(required, optional) }),
    messages: (required, optional = {}) => atStoreBoundary({ operation: () => store.messages(required, optional) }),
    message: (required, optional = {}) => atStoreBoundary({ operation: () => store.message!(required, optional) }),
    messagesVersion: (required, optional = {}) => atStoreBoundary({ operation: () => store.messagesVersion!(required, optional) }),
    messagesJson: (required, optional = {}) => atStoreBoundary({ operation: () => store.messagesJson!(required, optional) }),
    appendMessage: (required, optional = {}) => atStoreBoundary({ operation: () => store.appendMessage(required, optional) }),
    pageConversations: (required, optional = {}) => atStoreBoundary({ operation: () => store.pageConversations(required, optional) }),
    pageMessages: (required, optional = {}) => atStoreBoundary({ operation: () => store.pageMessages(required, optional) }),
  };
}
