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
import { sql, type Kysely } from 'kysely';
import { createSystemClock, type Clock } from '@jini-ai/core/primitives';
import { isUniqueViolation, type StorageKernel } from '@jini-ai/db/kernel';
import { redactUserMessage, type UserTextRedactionOptions } from '../../core/user-text-redaction.js';
import type { ChatMessage } from '../../core/messages.js';
import type { ChatConversation, ChatStore, ChatOwnerScope, ChatTitleSource, CreateChatConversationInput, ChatPageOptions, ChatMessagePageInput } from '../ports.js';
import type { ChatDatabase } from './tables.js';
import { ChatStoreError } from '../errors.js';
import { copyScope, atStoreBoundary, runChatQuery } from './boundary.js';
import { pageLimit, decodeCursor, encodeCursor } from './cursor.js';

/** UTF-8 byte ordinal ordering, identical on SQLite BINARY and PostgreSQL C collation. */
function ordinalId(dialect: 'sqlite' | 'postgres', column: 'c.id' | 'm.id') {
  return dialect === 'sqlite' ? sql<string>`${sql.ref(column)} collate BINARY` : sql<string>`${sql.ref(column)} collate "C"`;
}

/** The lock every position-assigning append to one conversation takes. */
function conversationLockKey(conversationId: string): string {
  return `chat-conversation:${conversationId}`;
}

interface ConversationRow {
  id: string;
  title: string | null;
  title_source: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  message_count: number | string | bigint | null;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  agent_id: string | null;
  agent_name: string | null;
  events_json: string | null;
  attachments_json: string | null;
  run_id: string | null;
  run_status: string | null;
  created_at: number | null;
  started_at: number | null;
  ended_at: number | null;
}

function toConversation(row: ConversationRow): ChatConversation {
  return {
    id: row.id,
    title: row.title ?? null,
    titleSource: (row.title_source ?? "fallback") as ChatTitleSource,
    messageCount: Number(row.message_count ?? 0),
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

/** Project only existing ai_* fields: resumable and lastRunEventId belong to run state. */
// Both fields disappear on a transcript round trip today. Adding columns alone would let the
// browser persist claims about a run it does not own. First associate the run with its conversation
// and let the daemon persist authoritative stream/terminal state, then extend storage for it.
// The legacy messages store does retain last_run_event_id; that is a separate trust model, not
// evidence that this projection preserves it. A schema extension also needs host-owned follow-up
// migrations, because changing the DDL constant cannot update databases already migrated.
function toMessage(row: MessageRow): ChatMessage {
  const events = row.events_json ? safeParse(row.events_json) : undefined;
  const attachments = row.attachments_json ? safeParse(row.attachments_json) : undefined;
  return {
    id: row.id, role: row.role as ChatMessage['role'], content: row.content,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.agent_name ? { agentName: row.agent_name } : {}),
    ...(events === undefined ? {} : { events }),
    ...(attachments === undefined ? {} : { attachments }),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.run_status ? { runStatus: row.run_status as NonNullable<ChatMessage['runStatus']> } : {}),
    ...(row.created_at === null ? {} : { createdAt: Number(row.created_at) }),
    ...(row.started_at === null ? {} : { startedAt: Number(row.started_at) }),
    ...(row.ended_at === null ? {} : { endedAt: Number(row.ended_at) }),
  };
}

/**
 * Returns a {@link ChatHistoryStore} that can only ever see `scope`'s own conversations.
 *
 * @param kernel the borrowed kernel. Nothing here opens, closes or configures a database; SQLite's
 *   `ON DELETE CASCADE` needs `foreign_keys = ON`, which the host must enable.
 * @param scope the isolation predicate, resolved from the host's authentication. For a guest,
 *   `ownerId` must already be a hash of the session key (`tenant-scope.ts`).
 * @param optional Optional core Clock for deterministic host/tests; defaults to system wall time.
 * @complexity each method is one to four indexed statements; `list` is O(owned conversations),
 *   `messages` O(messages in the conversation).
 */
export function createSqlChatStore<DB extends ChatDatabase>(
  { kernel, scope: inputScope }: { kernel: StorageKernel<DB>; scope: ChatOwnerScope },
  { clock = createSystemClock(), ...redactionOptions }: { clock?: Clock } & UserTextRedactionOptions = {},
): ChatStore {
  const scope = copyScope({ scope: inputScope });
  const { scopeId, ownerKind, ownerId } = scope;
  // The single subset boundary: DB must contain both required table definitions. Extra host tables
  // stay on the exact borrowed kernel; its transaction context is never projected or recreated.
  const run = <T>(body: (db: Kysely<ChatDatabase>) => T | Promise<T>): Promise<T> =>
    runChatQuery({ kernel: kernel, body: body });

  /** This scope's conversations, projected as {@link ConversationRow}s with their message count. */
  function ownedConversations(db: Kysely<ChatDatabase>) {
    return db
      .selectFrom("ai_chats as c")
      .select((eb) => [
        "c.id",
        "c.title",
        "c.title_source",
        "c.created_at",
        "c.updated_at",
        "c.expires_at",
        eb
          .selectFrom("ai_chat_messages as m")
          .select((sb) => sb.fn.countAll().as("n"))
          .whereRef("m.conversation_id", "=", "c.id")
          .as("message_count"),
      ])
      .where("c.scope_id", "=", scopeId)
      .where("c.owner_kind", "=", ownerKind)
      .where("c.owner_id", "=", ownerId);
  }

  /** One owner-filtered indexed lookup; missing and foreign IDs both return null. */
  async function get({ id }: { readonly id: string }, _optional: Record<string, never> = {}): Promise<ChatConversation | null> {
    const row = await run((db) => ownedConversations(db).where("c.id", "=", id).executeTakeFirst());
    return row ? toConversation(row as ConversationRow) : null;
  }

  /** One scoped projection for all message reads, including the row returned by an upsert. */
  function ownedMessages(db: Kysely<ChatDatabase>, conversationId: string) {
    return db
        .selectFrom("ai_chat_messages as m")
        .innerJoin("ai_chats as c", "c.id", "m.conversation_id")
        .select([
          "m.id",
          "m.role",
          "m.content",
          "m.agent_id",
          "m.agent_name",
          "m.events_json",
          "m.attachments_json",
          "m.run_id",
          "m.run_status",
          "m.created_at",
          "m.started_at",
          "m.ended_at",
        ])
        .where("m.conversation_id", "=", conversationId)
        .where("c.scope_id", "=", scopeId)
        .where("c.owner_kind", "=", ownerKind)
        .where("c.owner_id", "=", ownerId);
  }

  /** Read owned messages in persisted position order; foreign IDs produce no rows. */
  async function messages({ conversationId }: ChatMessagePageInput, _optional: Record<string, never> = {}): Promise<ChatMessage[]> {
    const rows = await run(db => ownedMessages(db, conversationId).orderBy('m.position').execute());
    return rows.map(toMessage);
  }

  /** Writes and projects one message inside the borrowed transaction; null for absent/foreign IDs. */
  function writeMessage(conversationId: string, m: ChatMessage): Promise<ChatMessage | null> {
    return kernel.transaction(async () => {
      await kernel.lockKey(conversationLockKey(conversationId));
      const owned = await run((db) =>
        db
          .selectFrom("ai_chats")
          .select("id")
          .where("id", "=", conversationId)
          .where("scope_id", "=", scopeId)
          .where("owner_kind", "=", ownerKind)
          .where("owner_id", "=", ownerId)
          .executeTakeFirst()
      );
      if (!owned) return null;

      const existing = await run((db) =>
        db
          .selectFrom("ai_chat_messages")
          .select("position")
          .where("id", "=", m.id)
          .where("conversation_id", "=", conversationId)
          .executeTakeFirst()
      );
      const position = existing ? Number(existing.position) : await nextPosition(conversationId);

      // The conflict target is `id`, the GLOBAL key: the `where` keeps an id that already lives in
      // another conversation from updating THAT row (the contract's "colliding id to its OWN chat" case).
      await run((db) =>
        db
          .insertInto("ai_chat_messages")
          .values({
            id: m.id,
            conversation_id: conversationId,
            role: m.role,
            content: m.content,
            agent_id: m.agentId ?? null,
            agent_name: m.agentName ?? null,
            events_json: m.events ? JSON.stringify(m.events) : null,
            attachments_json: m.attachments ? JSON.stringify(m.attachments) : null,
            run_id: m.runId ?? null,
            run_status: m.runStatus ?? null,
            position,
            created_at: m.createdAt ?? clock.nowMs(),
            started_at: m.startedAt ?? null,
            ended_at: m.endedAt ?? null,
          })
          .onConflict((oc) =>
            oc
              .column("id")
              .doUpdateSet((eb) => ({
                content: eb.ref("excluded.content"),
                events_json: eb.ref("excluded.events_json"),
                attachments_json: eb.ref("excluded.attachments_json"),
                run_id: eb.ref("excluded.run_id"),
                run_status: eb.ref("excluded.run_status"),
                started_at: eb.ref("excluded.started_at"),
                ended_at: eb.ref("excluded.ended_at"),
              }))
              .where((eb) => eb("ai_chat_messages.conversation_id", "=", eb.ref("excluded.conversation_id")))
          )
          .execute()
      );

      // A new message is activity: the list orders by `updated_at`.
      await run((db) => db.updateTable("ai_chats").set({ updated_at: clock.nowMs() }).where("id", "=", conversationId).execute());
      // Re-read only the written row, while still in the same transaction and conversation lock.
      const saved = await run(db => ownedMessages(db, conversationId).where('m.id', '=', m.id).executeTakeFirst());
      return saved ? toMessage(saved) : null;
    });
  }

  async function nextPosition(conversationId: string): Promise<number> {
    const row = await run((db) =>
      db
        .selectFrom("ai_chat_messages")
        .select((eb) => eb.fn.max("position").as("max"))
        .where("conversation_id", "=", conversationId)
        .executeTakeFirst()
    );
    return row?.max === null || row?.max === undefined ? 0 : Number(row.max) + 1;
  }

  const store: ChatStore = {
    async list() {
      const rows = await run((db) => ownedConversations(db).orderBy("c.updated_at", "desc").execute());
      return rows.map((row) => toConversation(row as ConversationRow));
    },

    get,

    async create(input: CreateChatConversationInput, _optional: Record<string, never> = {}) {
      const ts = clock.nowMs();
      try {
      await run((db) =>
        db
          .insertInto("ai_chats")
          .values({
            id: input.id,
            scope_id: scopeId,
            owner_kind: ownerKind,
            owner_id: ownerId,
            title: input.title ?? null,
            title_source: input.titleSource ?? "fallback",
            created_at: ts,
            updated_at: ts,
            expires_at: input.expiresAt ?? null,
          })
          .execute()
      );
      } catch (cause) {
        if (isUniqueViolation(cause)) throw new ChatStoreError({ code: 'conflict' }, { cause });
        throw cause;
      }
      const created = await get({ id: input.id });
      // Unreachable: the insert used this exact scope. Asserted so a future change to either
      // statement fails loudly instead of returning a malformed conversation.
      if (!created) throw new Error(`ai_chats: created conversation ${input.id} was not readable in its own scope`);
      return created;
    },

    async rename({ id, title }: { readonly id: string; readonly title: string }, { source = "manual" }: { readonly source?: ChatTitleSource } = {}) {
      // A generated title never overwrites a typed one: in the WHERE clause, so a concurrent
      // rename cannot slip between a read and this write.
      await run((db) =>
        db
          .updateTable("ai_chats")
          .set({ title, title_source: source, updated_at: clock.nowMs() })
          .where("id", "=", id)
          .where("scope_id", "=", scopeId)
          .where("owner_kind", "=", ownerKind)
          .where("owner_id", "=", ownerId)
          .$if(source === "generated", (qb) => qb.where("title_source", "<>", "manual"))
          .execute()
      );
      return get({ id });
    },

    async touch({ id }: { readonly id: string }, options: { readonly expiresAt?: number } = {}) {
      const ts = clock.nowMs();
      await run((db) =>
        db
          .updateTable("ai_chats")
          .set(options?.expiresAt === undefined ? { updated_at: ts } : { updated_at: ts, expires_at: options.expiresAt })
          .where("id", "=", id)
          .where("scope_id", "=", scopeId)
          .where("owner_kind", "=", ownerKind)
          .where("owner_id", "=", ownerId)
          .execute()
      );
    },

    async delete({ id }: { readonly id: string }, _optional: Record<string, never> = {}) {
      // Messages, agent sessions and tool approvals go with it through `ON DELETE CASCADE`.
      await run((db) =>
        db
          .deleteFrom("ai_chats")
          .where("id", "=", id)
          .where("scope_id", "=", scopeId)
          .where("owner_kind", "=", ownerKind)
          .where("owner_id", "=", ownerId)
          .execute()
      );
    },

    messages,

    async appendMessage({ conversationId, message }: { readonly conversationId: string; readonly message: ChatMessage }, _optional: Record<string, never> = {}) {
      const prepared = redactUserMessage({ message }, { ...(redactionOptions.redactUserText ? { redactUserText: redactionOptions.redactUserText } : {}) });
      const saved = await writeMessage(conversationId, prepared.message);
      if (!saved || !prepared.secretRedacted) return saved;
      const signal = { secretRedacted: true as const, count: prepared.count };
      redactionOptions.onSecretRedacted?.(signal);
      return { ...saved, secretRedaction: signal };
    },

    async pageConversations(_required: Record<string, never>, options: ChatPageOptions = {}) {
      const limit = pageLimit({ options: options });
      const anchor = decodeCursor({ cursor: options?.cursor, kind: 'conversations', scope: scope, conversation: null });
      const id = ordinalId(kernel.dialect, 'c.id');
      const rows = await run(db => {
        let query = ownedConversations(db);
        if (anchor) query = query.where(eb => eb.or([
          eb('c.updated_at', '<', anchor[0]),
          eb.and([eb('c.updated_at', '=', anchor[0]), eb(id, '>', anchor[1])]),
        ]));
        return query.orderBy('c.updated_at', 'desc').orderBy(id, 'asc').limit(limit + 1).execute();
      });
      const items = rows.slice(0, limit).map(row => toConversation(row as ConversationRow));
      const last = items.at(-1);
      return { items, ...(rows.length > limit && last ? {
        nextCursor: encodeCursor({ kind: 'conversations', scope: scope, conversation: null, anchor: [last.updatedAt, last.id] }),
      } : {}) };
    },

    async pageMessages(input: ChatMessagePageInput, options: ChatPageOptions = {}) {
      const limit = pageLimit({ options: options });
      const anchor = decodeCursor({ cursor: options?.cursor, kind: 'messages', scope: scope, conversation: input.conversationId });
      const id = ordinalId(kernel.dialect, 'm.id');
      // One join, at most limit+1 rows, including the ownership check; no parent pre-read.
      const rows = await run(db => {
        let query = ownedMessages(db, input.conversationId).select('m.position');
        if (anchor) query = query.where(eb => eb.or([
          eb('m.position', '>', anchor[0]),
          eb.and([eb('m.position', '=', anchor[0]), eb(id, '>', anchor[1])]),
        ]));
        return query.orderBy('m.position', 'asc').orderBy(id, 'asc').limit(limit + 1).execute();
      });
      const page = rows.slice(0, limit), last = page.at(-1);
      return { items: page.map(toMessage), ...(rows.length > limit && last ? {
        nextCursor: encodeCursor({ kind: 'messages', scope: scope, conversation: input.conversationId, anchor: [Number(last.position), last.id] }),
      } : {}) };
    },
  };
  return {
    list: () => atStoreBoundary({ operation: () => store.list() }),
    get: (required, optional = {}) => atStoreBoundary({ operation: () => store.get(required, optional) }),
    create: (required, optional = {}) => atStoreBoundary({ operation: () => store.create(required, optional) }),
    rename: (required, optional = {}) => atStoreBoundary({ operation: () => store.rename(required, optional) }),
    touch: (required, optional = {}) => atStoreBoundary({ operation: () => store.touch(required, optional) }),
    delete: (required, optional = {}) => atStoreBoundary({ operation: () => store.delete(required, optional) }),
    messages: (required, optional = {}) => atStoreBoundary({ operation: () => store.messages(required, optional) }),
    appendMessage: (required, optional = {}) => atStoreBoundary({ operation: () => store.appendMessage(required, optional) }),
    pageConversations: (required, optional = {}) => atStoreBoundary({ operation: () => store.pageConversations(required, optional) }),
    pageMessages: (required, optional = {}) => atStoreBoundary({ operation: () => store.pageMessages(required, optional) }),
  };
}
