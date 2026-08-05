/**
 * @module db/chat-history/store
 *
 * The SQLite implementation of `@jini-ai/chat/core`'s `ChatHistoryStore`, bound to one owner.
 *
 * The load-bearing property of this file is that **there is no way to obtain an unscoped store**.
 * {@link createChatHistoryStore} takes the scope up front and closes over it; every statement
 * below carries `scope_id = ? AND owner_kind = ? AND owner_id = ?` in its `WHERE` clause, and no
 * exported function accepts a bare conversation id without one. A route handler that forgets the
 * predicate cannot compile, because it never holds the pieces to write the query itself.
 *
 * This is a deliberate departure from this package's older `db/conversations` module, whose
 * `getConversation(db, id)` / `deleteConversation(db, id)` / `listMessages(db, conversationId)`
 * take no owner at all. That module's trust boundary is "you can open this local SQLite file",
 * which is correct for a single-user desktop app and unusable for a shared multi-tenant one.
 * Both exist; pick by trust model, not by convenience.
 *
 * The handle is **injected, never opened here**. `connection.ts`'s `openDatabase` owns
 * `<dataDir>/app.sqlite`; a host with its own database passes its own handle and this module
 * writes into it without ever knowing its path. That injection is what lets the same adapter
 * serve this package's daemon and a host CMS without either one adopting the other's file.
 */
import type {
  ChatConversation,
  ChatHistoryMaintenance,
  ChatHistoryStore,
  ChatMessage,
  ChatOwnerScope,
  ChatTitleSource,
  CreateChatConversationInput,
} from '@jini-ai/chat';

import type { DbRow, SqliteDb } from '../core/types.js';

/** Columns that make up a `ChatConversation`, aliased once so every read projects identically. */
const CONVERSATION_COLUMNS = `
  c.id            AS id,
  c.title         AS title,
  c.title_source  AS titleSource,
  c.created_at    AS createdAt,
  c.updated_at    AS updatedAt,
  c.expires_at    AS expiresAt,
  (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.conversation_id = c.id) AS messageCount
`;

/** The isolation predicate. Every statement in this file uses this exact clause. */
const OWNER_PREDICATE = `c.scope_id = ? AND c.owner_kind = ? AND c.owner_id = ?`;

function toConversation(row: DbRow): ChatConversation {
  return {
    id: row.id,
    title: row.title ?? null,
    titleSource: (row.titleSource ?? 'fallback') as ChatTitleSource,
    messageCount: Number(row.messageCount ?? 0),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    ...(row.expiresAt === null || row.expiresAt === undefined ? {} : { expiresAt: Number(row.expiresAt) }),
  };
}

/**
 * KNOWN GAP — `resumable` and `lastRunEventId` are dropped, deliberately, and adding columns is
 * NOT the fix.
 *
 * `ChatMessage` declares both (`@jini-ai/chat/core`'s `messages.ts`): `resumable` marks a failed run
 * recoverable by resuming the agent's existing session rather than restarting it, and
 * `lastRunEventId` is the cursor to resume from. Neither the projection below, nor `appendMessage`'s
 * insert, nor `CHAT_HISTORY_DDL` carries them, so a message round-tripped through this store comes
 * back with both `undefined` and a failed run cannot be resumed at its cursor. It fails silently —
 * `toMessage` omits absent keys rather than throwing, so the caller gets a well-formed `ChatMessage`.
 *
 * Why the obvious fix is wrong. Both fields describe a RUN, and the daemon owns run state
 * (`@jini-ai/daemon`'s `run-lifecycle.ts` is what decides `resumable` from the terminal event). The
 * component writing through this store today is the host's BROWSER, which knows only what its chat
 * pane handed it. Adding the columns would ask the component that does not own the data to persist
 * it — the values would be as trustworthy as whatever the client happened to send. The ordering that
 * actually works is: associate a run with a conversation id first, then let the daemon persist
 * run-linked state as it streams, and only then add storage for it, at which point there is a
 * consumer to validate the shape against.
 *
 * Two further facts worth having before touching this. First, this is the multi-tenant store; its
 * sibling `db/messages/messages.ts` DOES carry `last_run_event_id`, so the two message stores in
 * this package genuinely disagree and neither is evidence about the other. Second,
 * `CHAT_HISTORY_DDL` is copied verbatim into the reference implementation's
 * `0023_ai_chat_history.sql` and guarded by a
 * structural parity test there; that migration is already applied, so any column added here also
 * needs a follow-up `ALTER TABLE` on the host side and a parity test taught to compare the pair
 * against this constant.
 */
function toMessage(row: DbRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    ...(row.agentId ? { agentId: row.agentId } : {}),
    ...(row.agentName ? { agentName: row.agentName } : {}),
    ...(row.eventsJson ? { events: safeParse(row.eventsJson) } : {}),
    ...(row.attachmentsJson ? { attachments: safeParse(row.attachmentsJson) } : {}),
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.runStatus ? { runStatus: row.runStatus } : {}),
    ...(row.createdAt === null || row.createdAt === undefined ? {} : { createdAt: Number(row.createdAt) }),
    ...(row.startedAt === null || row.startedAt === undefined ? {} : { startedAt: Number(row.startedAt) }),
    ...(row.endedAt === null || row.endedAt === undefined ? {} : { endedAt: Number(row.endedAt) }),
  };
}

/**
 * A malformed JSON column yields `undefined` rather than throwing.
 *
 * A single corrupt `events_json` — a half-written row from a crash mid-stream, say — must not
 * make an entire conversation unreadable. The message's text lives in its own column and is
 * still recoverable; losing the event timeline for one turn is a far better outcome than a list
 * view that throws.
 */
function safeParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Returns a {@link ChatHistoryStore} that can only ever see `scope`'s own conversations.
 *
 * @param db an open `better-sqlite3` handle owned by the caller. This function neither opens nor
 *   closes it, and does not set pragmas on it — see `schema.ts` on `foreign_keys`.
 * @param scope the isolation predicate, resolved from the host's authentication. For a `guest`,
 *   `ownerId` must already be a hash of the session key; this module never hashes and never
 *   verifies that it was hashed.
 * @param now injectable clock, for tests that need deterministic timestamps.
 */
export function createChatHistoryStore(
  db: SqliteDb,
  scope: ChatOwnerScope,
  now: () => number = Date.now,
): ChatHistoryStore {
  const owner = [scope.scopeId, scope.ownerKind, scope.ownerId] as const;

  /** `true` only when this scope owns the conversation — the gate every message write passes. */
  function owns(conversationId: string): boolean {
    const row = db
      .prepare(`SELECT 1 FROM ai_chats c WHERE c.id = ? AND ${OWNER_PREDICATE}`)
      .get(conversationId, ...owner);
    return row !== undefined;
  }

  return {
    async list(): Promise<ChatConversation[]> {
      const rows = db
        .prepare(
          `SELECT ${CONVERSATION_COLUMNS} FROM ai_chats c
            WHERE ${OWNER_PREDICATE}
            ORDER BY c.updated_at DESC`,
        )
        .all(...owner) as DbRow[];
      return rows.map(toConversation);
    },

    async get(id: string): Promise<ChatConversation | null> {
      const row = db
        .prepare(
          `SELECT ${CONVERSATION_COLUMNS} FROM ai_chats c
            WHERE c.id = ? AND ${OWNER_PREDICATE}`,
        )
        .get(id, ...owner) as DbRow | undefined;
      return row ? toConversation(row) : null;
    },

    async create(input: CreateChatConversationInput): Promise<ChatConversation> {
      const ts = now();
      db.prepare(
        `INSERT INTO ai_chats
           (id, scope_id, owner_kind, owner_id, title, title_source, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        scope.scopeId,
        scope.ownerKind,
        scope.ownerId,
        input.title ?? null,
        input.titleSource ?? 'fallback',
        ts,
        ts,
        input.expiresAt ?? null,
      );
      const created = await this.get(input.id);
      // Unreachable in practice: the INSERT above used this exact scope, so the scoped read
      // that follows cannot miss it. Asserted rather than `!`-ed so a future change to either
      // statement fails loudly here instead of returning a malformed conversation.
      if (!created) throw new Error(`ai_chats: created conversation ${input.id} was not readable in its own scope`);
      return created;
    },

    async rename(id: string, title: string, source: ChatTitleSource = 'manual'): Promise<ChatConversation | null> {
      // A generated title never overwrites one the user typed. Expressed in the WHERE clause
      // rather than a read-then-write so a concurrent rename cannot slip between the two.
      const guard = source === 'generated' ? ` AND c.title_source <> 'manual'` : '';
      db.prepare(
        `UPDATE ai_chats AS c
            SET title = ?, title_source = ?, updated_at = ?
          WHERE c.id = ? AND ${OWNER_PREDICATE}${guard}`,
      ).run(title, source, now(), id, ...owner);
      return this.get(id);
    },

    async touch(id: string, options?: { expiresAt?: number }): Promise<void> {
      const ts = now();
      if (options?.expiresAt === undefined) {
        db.prepare(`UPDATE ai_chats AS c SET updated_at = ? WHERE c.id = ? AND ${OWNER_PREDICATE}`)
          .run(ts, id, ...owner);
        return;
      }
      db.prepare(
        `UPDATE ai_chats AS c SET updated_at = ?, expires_at = ? WHERE c.id = ? AND ${OWNER_PREDICATE}`,
      ).run(ts, options.expiresAt, id, ...owner);
    },

    async delete(id: string): Promise<void> {
      // Messages go via `ON DELETE CASCADE`, which requires `PRAGMA foreign_keys = ON` on this
      // connection. See `schema.ts` — a library setting connection-wide pragmas on a borrowed
      // handle would be worse than documenting the requirement.
      db.prepare(`DELETE FROM ai_chats AS c WHERE c.id = ? AND ${OWNER_PREDICATE}`).run(id, ...owner);
    },

    async messages(conversationId: string): Promise<ChatMessage[]> {
      const rows = db
        .prepare(
          `SELECT m.id, m.role, m.content, m.agent_id AS agentId, m.agent_name AS agentName,
                  m.events_json AS eventsJson, m.attachments_json AS attachmentsJson,
                  m.run_id AS runId, m.run_status AS runStatus, m.created_at AS createdAt,
                  m.started_at AS startedAt, m.ended_at AS endedAt
             FROM ai_chat_messages m
             JOIN ai_chats c ON c.id = m.conversation_id
            WHERE m.conversation_id = ? AND ${OWNER_PREDICATE}
            ORDER BY m.position`,
        )
        .all(conversationId, ...owner) as DbRow[];
      return rows.map(toMessage);
    },

    async appendMessage(conversationId: string, message: ChatMessage): Promise<ChatMessage | null> {
      if (!owns(conversationId)) return null;

      // One `BEGIN IMMEDIATE` around read-then-write: `MAX(position) + 1` computed outside a
      // write transaction is the classic way two concurrent turns claim the same slot. The
      // `UNIQUE (conversation_id, position)` constraint is the backstop if this is ever bypassed.
      //
      // `owns()` above is NOT sufficient on its own, which is why the upsert below carries its own
      // conversation predicate. `owns()` authorizes the *conversation* being written to; the upsert's
      // conflict target is `id`, the GLOBAL primary key on messages. Without the `WHERE`, appending a
      // message id that already exists in someone else's conversation updated THAT row — the caller
      // legitimately owned the conversation it named, so nothing here refused it, and it then got
      // `null` back (a 404 at the route) after the write had landed. See the
      // "colliding id to its OWN chat" case in `__tests__/isolation.test.ts`.
      const write = db.transaction((m: ChatMessage) => {
        const existing = db
          .prepare(`SELECT position FROM ai_chat_messages WHERE id = ? AND conversation_id = ?`)
          .get(m.id, conversationId) as DbRow | undefined;

        const position = existing
          ? Number(existing.position)
          : Number(
              (
                db
                  .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ai_chat_messages WHERE conversation_id = ?`)
                  .get(conversationId) as DbRow
              ).next,
            );

        db.prepare(
          `INSERT INTO ai_chat_messages
             (id, conversation_id, role, content, agent_id, agent_name, events_json,
              attachments_json, run_id, run_status, position, created_at, started_at, ended_at)
           VALUES (@id, @conversationId, @role, @content, @agentId, @agentName, @eventsJson,
                   @attachmentsJson, @runId, @runStatus, @position, @createdAt, @startedAt, @endedAt)
           ON CONFLICT(id) DO UPDATE SET
             content          = excluded.content,
             events_json      = excluded.events_json,
             attachments_json = excluded.attachments_json,
             run_id           = excluded.run_id,
             run_status       = excluded.run_status,
             started_at       = excluded.started_at,
             ended_at         = excluded.ended_at
           WHERE ai_chat_messages.conversation_id = excluded.conversation_id`,
        ).run({
          id: m.id,
          conversationId,
          role: m.role,
          content: m.content,
          agentId: m.agentId ?? null,
          agentName: m.agentName ?? null,
          eventsJson: m.events ? JSON.stringify(m.events) : null,
          attachmentsJson: m.attachments ? JSON.stringify(m.attachments) : null,
          runId: m.runId ?? null,
          runStatus: m.runStatus ?? null,
          position,
          createdAt: m.createdAt ?? now(),
          startedAt: m.startedAt ?? null,
          endedAt: m.endedAt ?? null,
        });

        // A new message is activity on the conversation; the list orders by `updated_at`, so
        // skipping this would leave an actively-used chat sinking down the list.
        db.prepare(`UPDATE ai_chats SET updated_at = ? WHERE id = ?`).run(now(), conversationId);
      });

      write(message);
      const saved = await this.messages(conversationId);
      return saved.find((m) => m.id === message.id) ?? null;
    },
  };
}

/**
 * Retention, across every owner — which is why it is a separate factory rather than a method on
 * a scoped store. Handing this to a store would mean an unscoped store had to exist.
 */
export function createChatHistoryMaintenance(db: SqliteDb): ChatHistoryMaintenance {
  return {
    async sweepExpired(now: number, limit = 500): Promise<number> {
      // Bounded by `limit` so a large backlog drains in chunks. An unbounded `DELETE` holds the
      // write lock long enough that concurrent inserts exhaust `busy_timeout` and fail outright.
      // `expires_at IS NOT NULL` keeps never-expiring history structurally out of reach.
      const result = db
        .prepare(
          `DELETE FROM ai_chats
             WHERE id IN (
               SELECT id FROM ai_chats
                WHERE expires_at IS NOT NULL AND expires_at <= ?
                LIMIT ?
             )`,
        )
        .run(now, limit);
      return result.changes;
    },
  };
}
