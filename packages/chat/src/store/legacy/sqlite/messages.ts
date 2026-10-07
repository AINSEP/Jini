import { redactUserText, type SecretRedactionSignal, type UserTextRedactionOptions } from '../../../core/user-text-redaction.js';
/**
 * @module db/messages/messages
 * Chat message CRUD, streamed-event append, and telemetry finalization. Imports only the
 * core/ kernel (SqliteDb, DbRow, ChatSessionMode, parseJsonOrUndef).
 *
 * NOTE (neutral port): drops six OD-product JSON columns with no generic engine equivalent —
 * `comment_attachments_json` (the preview-comments/canvas-annotation feature, explicitly out of
 * scope for this port), `produced_files_json` and `trace_object_files_json` (design-canvas file
 * output tracking), `feedback_json` (Critique Theater's scoring feedback), `pre_turn_file_names_json`
 * (design-canvas per-turn file context), and `applied_plugin_snapshot_json` (OD's plugin host). The
 * already-ported `schema/migrate.ts` messages table was pre-trimmed to match; see that file and
 * `source-map.md`'s Design Decisions for the same drop list.
 */
import type { SqliteDb } from '@jini-ai/db/sqlite';
import type { DbRow } from '@jini-ai/db/core';
import type { ChatSessionMode } from '../index.js';
import { parseJsonOrUndef } from '@jini-ai/db/core';

/** @internal Column alias list used by both `listMessages` and `upsertMessage`'s re-fetch. */
const MESSAGE_COLS = `id, role, content, agent_id AS agentId, agent_name AS agentName,
  run_id AS runId, run_status AS runStatus,
  last_run_event_id AS lastRunEventId,
  events_json AS eventsJson,
  attachments_json AS attachmentsJson,
  session_mode AS sessionMode,
  run_context_json AS runContextJson,
  created_at AS createdAt, started_at AS startedAt, ended_at AS endedAt,
  position`;

/**
 * Returns all messages for a conversation in ascending position order, with JSON columns parsed.
 * @param db - Open SQLite connection.
 * @param conversationId - Conversation whose messages to fetch.
 * @returns Normalized message objects ready for API serialization.
 */
export function listMessages({ db, conversationId }: { db: SqliteDb; conversationId: string }) {
  return (db
    .prepare(
      `SELECT ${MESSAGE_COLS}
         FROM messages
        WHERE conversation_id = ?
        ORDER BY position ASC`,
    )
    .all(conversationId) as DbRow[])
    .map(normalizeMessage);
}

/**
 * Thrown by `upsertMessage` when the caller presents a message `id` together with a
 * `conversationId` that does not match the conversation the row already belongs to (`id` is a
 * global primary key, not scoped per-conversation, so this is the only signal available). Rather
 * than silently updating the wrong conversation's message — or silently doing nothing — while
 * still bumping the caller-supplied `conversationId`'s `updated_at`, this is a hard failure: it is
 * always a caller/transport bug (a confused id, or a multi-tenant mixup) and never a legitimate
 * state to paper over.
 */
export class MessageConversationMismatchError extends Error {
  public readonly messageId: string;
  public readonly actualConversationId: string;
  public readonly requestedConversationId: string;
  constructor(
    { messageId, actualConversationId, requestedConversationId }: { messageId: string; actualConversationId: string; requestedConversationId: string },
  ) {
    super(
      `upsertMessage: message id ${JSON.stringify(messageId)} belongs to a different conversation ` +
        `(${JSON.stringify(actualConversationId)}), not ${JSON.stringify(requestedConversationId)}`,
    );
    this.name = 'MessageConversationMismatchError';
    this.messageId = messageId;
    this.actualConversationId = actualConversationId;
    this.requestedConversationId = requestedConversationId;
  }
}

/**
 * Inserts or updates a message row and bumps the parent conversation's `updated_at` for recency sorting.
 * On insert, appends to the end of the conversation's position sequence.
 * On update, preserves `telemetry_finalized_at` once set (one-way latch).
 *
 * The existence check, position calculation, insert-or-update, and conversation `updated_at` bump
 * all run inside one `better-sqlite3` transaction (opened with `BEGIN IMMEDIATE` via `.immediate()`,
 * not the default deferred `BEGIN`) so the whole read-then-write sequence is atomic: a concurrent
 * connection's own `upsertMessage` call for the same conversation cannot read the pre-write
 * `MAX(position)` while this one is still in flight and thereby compute the same next position —
 * `BEGIN IMMEDIATE` acquires the write lock before this transaction's first read, so a concurrent
 * writer blocks (or fails with `SQLITE_BUSY`, per its own busy-timeout policy) until this one
 * commits, rather than interleaving.
 *
 * `id` is the messages table's global primary key (not scoped per-conversation), so a row can only
 * ever belong to one conversation. If the caller-supplied `m.id` already exists under a different
 * `conversationId`, this throws {@link MessageConversationMismatchError} instead of silently
 * updating the wrong conversation's row (or the wrong conversation's `updated_at`).
 *
 * @param db - Open SQLite connection.
 * @param conversationId - Owning conversation id.
 * @param m - Message fields; JSON sub-fields are stringified automatically.
 * @returns The normalized, re-fetched message row, or null if the row vanished between write and read.
 * @throws {MessageConversationMismatchError} if `m.id` already exists under a different conversation.
 */
export function upsertMessage({ db, conversationId, m: incoming }: { db: SqliteDb; conversationId: string; m: DbRow }, options: UserTextRedactionOptions = {}): (ReturnType<typeof normalizeMessage> & { secretRedaction?: SecretRedactionSignal }) | null {
  const redaction = incoming.role === 'user' && typeof incoming.content === 'string'
    ? (options.redactUserText ?? redactUserText)({ text: incoming.content })
    : null;
  const m = redaction ? { ...incoming, content: redaction.text } : incoming;
  const runUpsert = db.transaction(() => {
    const existing = db
      .prepare(`SELECT conversation_id AS conversationId, position FROM messages WHERE id = ?`)
      .get(m.id) as (DbRow & { conversationId: string }) | undefined;

    if (existing && existing.conversationId !== conversationId) {
      throw new MessageConversationMismatchError({ messageId: m.id, actualConversationId: existing.conversationId, requestedConversationId: conversationId });
    }

    const now = Date.now();
    if (existing) {
      db.prepare(
        `UPDATE messages
            SET role = ?, content = ?, agent_id = ?, agent_name = ?,
                run_id = ?, run_status = ?, last_run_event_id = ?,
                events_json = ?, attachments_json = ?,
                session_mode = ?, run_context_json = ?,
                telemetry_finalized_at = CASE
                  WHEN ? THEN COALESCE(telemetry_finalized_at, ?)
                  ELSE telemetry_finalized_at
                END,
                started_at = ?, ended_at = ?
          WHERE id = ? AND conversation_id = ?`,
      ).run(
        m.role,
        m.content,
        m.agentId ?? null,
        m.agentName ?? null,
        m.runId ?? null,
        m.runStatus ?? null,
        m.lastRunEventId ?? null,
        m.events ? JSON.stringify(m.events) : null,
        m.attachments ? JSON.stringify(m.attachments) : null,
        normalizeMessageSessionModeForStorage(m.sessionMode),
        m.runContext ? JSON.stringify(m.runContext) : null,
        m.telemetryFinalized === true ? 1 : 0,
        now,
        m.startedAt ?? null,
        m.endedAt ?? null,
        m.id,
        conversationId,
      );
    } else {
      const max = db
        .prepare(
          `SELECT COALESCE(MAX(position), -1) AS m FROM messages WHERE conversation_id = ?`,
        )
        .get(conversationId) as DbRow | undefined;
      const position = (max?.m ?? -1) + 1;
      const createdAt = typeof m.createdAt === 'number' && Number.isFinite(m.createdAt)
        ? m.createdAt
        : now;
      // 18 values: id, conversation_id, role, content, agent_id, agent_name,
      // run_id, run_status, last_run_event_id, events_json, attachments_json,
      // session_mode, run_context_json, telemetry_finalized_at, started_at,
      // ended_at, position, created_at.
      db.prepare(
        `INSERT INTO messages
           (id, conversation_id, role, content, agent_id, agent_name,
            run_id, run_status, last_run_event_id, events_json,
            attachments_json, session_mode, run_context_json,
            telemetry_finalized_at, started_at, ended_at, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        m.id,
        conversationId,
        m.role,
        m.content,
        m.agentId ?? null,
        m.agentName ?? null,
        m.runId ?? null,
        m.runStatus ?? null,
        m.lastRunEventId ?? null,
        m.events ? JSON.stringify(m.events) : null,
        m.attachments ? JSON.stringify(m.attachments) : null,
        normalizeMessageSessionModeForStorage(m.sessionMode),
        m.runContext ? JSON.stringify(m.runContext) : null,
        m.telemetryFinalized === true ? now : null,
        m.startedAt ?? null,
        m.endedAt ?? null,
        position,
        createdAt,
      );
    }
    // Bump conversation activity so recency-sorted listings (e.g. `listConversations`) reflect this write.
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
      now,
      conversationId,
    );
    const row = db
      .prepare(`SELECT ${MESSAGE_COLS} FROM messages WHERE id = ? AND conversation_id = ?`)
      .get(m.id, conversationId) as DbRow | undefined;
    return row ? normalizeMessage(row) : null;
  });
  const saved = runUpsert.immediate();
  if (!saved || !redaction?.secretRedacted) return saved;
  const signal = { secretRedacted: true as const, count: redaction.count };
  options.onSecretRedacted?.(signal);
  return { ...saved, secretRedaction: signal };
}

/**
 * Reads whether telemetry has been finalized for a message without loading the full row.
 * Used to decide whether to enqueue a finalization job.
 * @returns `{ exists: false }` when the message is not found; otherwise `{ exists: true, finalizedAt }`.
 */
export function getMessageTelemetryFinalizationState({ db, messageId }: { db: SqliteDb; messageId: string }) {
  const row = db
    .prepare(
      `SELECT telemetry_finalized_at AS telemetryFinalizedAt
         FROM messages
        WHERE id = ?`,
    )
    .get(messageId) as DbRow | undefined;
  if (!row) {
    return {
      exists: false,
      finalizedAt: null,
    };
  }
  return {
    exists: true,
    finalizedAt:
      typeof row.telemetryFinalizedAt === 'number' ? row.telemetryFinalizedAt : null,
  };
}

/**
 * Appends a `{ kind: 'status', label, detail? }` event to the message's events array.
 * Deduplicates consecutive identical status events so the UI does not stutter on repeated flushes.
 * @param db - Open SQLite connection.
 * @param messageId - Target message id.
 * @param event - Must carry a non-empty `label`; `detail` is optional.
 * @returns The updated events array, or null if the message does not exist or label is empty.
 */
export function appendMessageStatusEvent({ db, messageId, event }: { db: SqliteDb; messageId: string; event: DbRow }) {
  const label = typeof event?.label === 'string' ? event.label.trim() : '';
  const detail = typeof event?.detail === 'string' ? event.detail.trim() : '';
  if (!label) return null;
  const row = db
    .prepare(`SELECT events_json AS eventsJson FROM messages WHERE id = ?`)
    .get(messageId) as DbRow | undefined;
  if (!row) return null;
  const parsed = parseJsonOrUndef(row.eventsJson);
  const events = Array.isArray(parsed) ? parsed : [];
  const last = events[events.length - 1];
  if (last?.kind === 'status' && last.label === label && (last.detail ?? '') === detail) {
    return events;
  }
  const nextEvent = detail
    ? { kind: 'status', label, detail }
    : { kind: 'status', label };
  const next = [...events, nextEvent];
  db.prepare(`UPDATE messages SET events_json = ? WHERE id = ?`)
    .run(JSON.stringify(next), messageId);
  return next;
}

/**
 * Appends an arbitrary agent event to the message's events array, also streaming `text` deltas
 * into the `content` column so the message text grows incrementally during a run.
 * Deduplicates byte-identical consecutive events.
 * @param db - Open SQLite connection.
 * @param messageId - Target message id.
 * @param event - Must carry a non-empty `kind`; `text` field is appended to content when kind is 'text'.
 * @returns The updated events array, or null if the message does not exist or kind is empty.
 */
export function appendMessageAgentEvent({ db, messageId, event }: { db: SqliteDb; messageId: string; event: DbRow }) {
  if (!event || typeof event !== 'object') return null;
  const kind = typeof event.kind === 'string' ? event.kind : '';
  if (!kind) return null;
  const row = db
    .prepare(`SELECT content, events_json AS eventsJson FROM messages WHERE id = ?`)
    .get(messageId) as DbRow | undefined;
  if (!row) return null;
  const parsed = parseJsonOrUndef(row.eventsJson);
  const events = Array.isArray(parsed) ? parsed : [];
  const last = events[events.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(event)) {
    return events;
  }
  const next = [...events, event];
  const textDelta = kind === 'text' && typeof event.text === 'string' ? event.text : '';
  db.prepare(`UPDATE messages SET content = COALESCE(content, '') || ?, events_json = ? WHERE id = ?`)
    .run(textDelta, JSON.stringify(next), messageId);
  return next;
}

/**
 * Hard-deletes a single message row by id.
 * @param db - Open SQLite connection.
 * @param id - Message id to remove.
 */
export function deleteMessage({ db, id }: { db: SqliteDb; id: string }) {
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
}

/** @internal Converts a raw SQLite row to a plain object with JSON columns parsed and null coerced to undefined. */
function normalizeMessage(row: DbRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    agentId: row.agentId ?? undefined,
    agentName: row.agentName ?? undefined,
    runId: row.runId ?? undefined,
    runStatus: row.runStatus ?? undefined,
    lastRunEventId: row.lastRunEventId ?? undefined,
    events: parseJsonOrUndef(row.eventsJson),
    attachments: parseJsonOrUndef(row.attachmentsJson),
    sessionMode: normalizeMessageSessionMode(row.sessionMode),
    runContext: parseJsonOrUndef(row.runContextJson),
    createdAt: row.createdAt ?? undefined,
    startedAt: row.startedAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
  };
}

/** @internal Validates that a stored session_mode value is a known ChatSessionMode; returns undefined for unrecognised values. */
function normalizeMessageSessionMode(value: unknown): ChatSessionMode | undefined {
  return value === 'chat' || value === 'design' || value === 'plan' ? value : undefined;
}

/** @internal Same validation as normalizeMessageSessionMode but returns null (SQLite-safe) for unrecognised values. */
function normalizeMessageSessionModeForStorage(value: unknown): ChatSessionMode | null {
  return value === 'chat' || value === 'design' || value === 'plan' ? value : null;
}
