/**
 * @module db/conversations/conversations
 * Owns conversation CRUD and list/get queries with per-conversation run summaries and
 * total run-duration aggregation. Imports only the core/ kernel (types + rows helper).
 */
import type { SqliteDb } from '@jini-ai/db/sqlite';
import type { DbRow } from '@jini-ai/db/core';
import type { ChatSessionMode } from '../index.js';
import { rows } from '@jini-ai/db/core';

/**
 * @internal Builds the summary query shared by `listConversations` and `getConversation`: every
 * conversation matching `filterColumn = ?`, each enriched with message count, the latest assistant
 * run summary, and total accumulated run duration across all terminal runs.
 */
function conversationSummarySql(filterColumn: 'project_id' | 'id') {
  return `WITH selected_conversations AS (
          SELECT id, project_id AS projectId, title, session_mode AS sessionMode,
                 created_at AS createdAt, updated_at AS updatedAt
            FROM conversations
           WHERE ${filterColumn} = ?
        ),
        latest_runs AS (
          SELECT conversation_id AS conversationId,
                 run_status AS latestRunStatus,
                 started_at AS latestRunStartedAt,
                 ended_at AS latestRunEndedAt,
                 events_json AS latestRunEventsJson
            FROM (
              SELECT m.conversation_id,
                     m.run_status,
                     m.started_at,
                     m.ended_at,
                     m.events_json,
                     ROW_NUMBER() OVER (
                       PARTITION BY m.conversation_id
                       ORDER BY m.position DESC
                     ) AS rn
                FROM messages m
                JOIN selected_conversations c ON c.id = m.conversation_id
               WHERE m.role = 'assistant'
                 AND m.run_status IS NOT NULL
            )
           WHERE rn = 1
        ),
        message_counts AS (
          SELECT m.conversation_id AS conversationId,
                 COUNT(*) AS messageCount
            FROM messages m
            JOIN selected_conversations c ON c.id = m.conversation_id
           GROUP BY m.conversation_id
        ),
        total_run_durations AS (
          SELECT m.conversation_id AS conversationId,
                 SUM(${TERMINAL_RUN_DURATION_SQL}) AS totalDurationMs
            FROM messages m
            JOIN selected_conversations c ON c.id = m.conversation_id
           WHERE m.role = 'assistant'
             AND m.run_status IN ('succeeded', 'failed', 'canceled')
           GROUP BY m.conversation_id
        )
        SELECT c.id, c.projectId, c.title, c.sessionMode, c.createdAt, c.updatedAt,
               COALESCE(mc.messageCount, 0) AS messageCount,
               lr.latestRunStatus, lr.latestRunStartedAt,
               lr.latestRunEndedAt, lr.latestRunEventsJson,
               trd.totalDurationMs
          FROM selected_conversations c
          LEFT JOIN latest_runs lr ON lr.conversationId = c.id
          LEFT JOIN message_counts mc ON mc.conversationId = c.id
          LEFT JOIN total_run_durations trd ON trd.conversationId = c.id`;
}

/**
 * Returns all conversations for a project, newest first, each enriched with message count,
 * the latest assistant run summary, and total accumulated run duration across all terminal runs.
 * @param db Open SQLite database handle.
 * @param projectId The project whose conversations to list.
 */
export function listConversations({ db, projectId }: { db: SqliteDb; projectId: string }) {
  return rows(db
    .prepare(`${conversationSummarySql('project_id')}\n         ORDER BY c.updatedAt DESC`)
    .all(projectId)).map(normalizeConversation);
}

/**
 * Fetches a single conversation by id with its latest run summary and total run duration.
 * Returns null when no matching conversation exists.
 * @param db Open SQLite database handle.
 * @param id Conversation id.
 */
export function getConversation({ db, id }: { db: SqliteDb; id: string }) {
  const r = db.prepare(conversationSummarySql('id')).get(id) as DbRow | undefined;
  return r ? normalizeConversation(r) : null;
}

/** @internal Shapes a raw SQLite row into the canonical conversation object, including run summary. */
function normalizeConversation(r: DbRow) {
  const latestRun = conversationRunSummaryFromRow({
    runStatus: r.latestRunStatus,
    startedAt: r.latestRunStartedAt,
    endedAt: r.latestRunEndedAt,
    eventsJson: r.latestRunEventsJson,
  });
  return {
    id: r.id,
    projectId: r.projectId,
    title: r.title ?? null,
    sessionMode: normalizeConversationSessionMode({ value: r.sessionMode }),
    messageCount: Number(r.messageCount),
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    ...numberProperty('totalDurationMs', r.totalDurationMs),
    latestRun: latestRun ?? undefined,
  };
}

/**
 * Coerces an arbitrary database value to a valid ChatSessionMode, defaulting to 'design'.
 * Upholds the invariant that no conversation ever carries an unknown session mode.
 * @param value Raw value read from the session_mode column.
 * @returns A valid ChatSessionMode: 'chat', 'plan', or 'design'.
 */
export function normalizeConversationSessionMode({ value }: { value: unknown }): ChatSessionMode {
  return value === 'chat' || value === 'plan' ? value : 'design';
}

/** @internal Converts a nullable SQLite value to a finite number, or undefined when absent or non-finite. */
function finiteNumber(value: unknown): number | undefined {
  const n = value == null ? undefined : Number(value);
  return n !== undefined && Number.isFinite(n) ? n : undefined;
}

/**
 * @internal Produces a single-key object `{ [key]: number }` only when value is a finite number,
 * omitting the key entirely otherwise. Generic over `key` (rather than plain `string`) so the
 * spread of its return type into a caller's object literal carries a real, statically-known
 * optional property instead of collapsing to an index signature the compiler then can't see
 * through at the call site.
 */
function numberProperty<K extends string>(key: K, value: unknown): Partial<Record<K, number>> {
  const n = finiteNumber(value);
  return n === undefined ? {} : ({ [key]: n } as Record<K, number>);
}

/** @internal The SQL CASE expression that resolves a terminal run's duration (over messages alias `m`): wall-clock diff when both timestamps exist, otherwise the latest usage event's durationMs. */
const TERMINAL_RUN_DURATION_SQL = `CASE
            WHEN m.started_at IS NOT NULL AND m.ended_at IS NOT NULL THEN
              CASE
                WHEN CAST(m.ended_at AS INTEGER) >= CAST(m.started_at AS INTEGER)
                  THEN CAST(m.ended_at AS INTEGER) - CAST(m.started_at AS INTEGER)
                ELSE 0
              END
            ELSE (
              SELECT CASE
                       WHEN json_extract(usage_event.value, '$.durationMs') >= 0
                         THEN json_extract(usage_event.value, '$.durationMs')
                       ELSE 0
                     END
                FROM json_each(
                  CASE
                    WHEN json_valid(m.events_json) AND json_type(m.events_json) = 'array'
                      THEN m.events_json
                    ELSE '[]'
                  END
                ) AS usage_event
               WHERE usage_event.type = 'object'
                 AND json_extract(usage_event.value, '$.kind') = 'usage'
                 AND json_type(usage_event.value, '$.durationMs') IN ('integer', 'real')
               ORDER BY CAST(usage_event.key AS INTEGER) DESC
               LIMIT 1
            )
          END`;

/** @internal Converts a raw message row (runStatus/startedAt/endedAt/eventsJson) into a run summary object, or null when no run status is present. */
function conversationRunSummaryFromRow(row: DbRow) {
  if (typeof row.runStatus !== 'string') return null;
  const startedAt = finiteNumber(row.startedAt);
  const endedAt = finiteNumber(row.endedAt);
  const durationMs = startedAt !== undefined && endedAt !== undefined
    ? Math.max(0, endedAt - startedAt)
    : latestUsageDurationMs(row.eventsJson);
  return {
    status: row.runStatus,
    ...numberProperty('startedAt', startedAt),
    ...numberProperty('endedAt', endedAt),
    ...numberProperty('durationMs', durationMs),
  };
}

/** @internal Parses events_json to find the most recent usage event's durationMs; returns undefined when events_json is absent or malformed. */
function latestUsageDurationMs(eventsJson: unknown): number | undefined {
  const events = parseEventsArray(eventsJson);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const durationMs = usageEventDurationMs(events[i]);
    if (durationMs !== undefined) return Math.max(0, durationMs);
  }
  return undefined;
}

/** @internal Parses events_json as an array; absent, malformed, or non-array JSON yields an empty list. */
function parseEventsArray(eventsJson: unknown): unknown[] {
  if (typeof eventsJson !== 'string' || eventsJson.length === 0) return [];
  try {
    const events: unknown = JSON.parse(eventsJson);
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

/** @internal Returns a usage event's finite durationMs, or undefined for any other event shape. */
function usageEventDurationMs(event: unknown): number | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const { kind, durationMs } = event as { kind?: unknown; durationMs?: unknown };
  return kind === 'usage' && typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : undefined;
}

/**
 * Inserts a new conversation row and returns the full conversation record (including run summary).
 * Normalizes sessionMode before persisting so the stored value is always a valid ChatSessionMode.
 * @param db Open SQLite database handle.
 * @param c Conversation fields to insert.
 */
export function insertConversation({ db, c }: { db: SqliteDb; c: DbRow }) {
  db.prepare(
    `INSERT INTO conversations
       (id, project_id, title, session_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    c.id,
    c.projectId,
    c.title ?? null,
    normalizeConversationSessionMode({ value: c.sessionMode }),
    c.createdAt,
    c.updatedAt,
  );
  return getConversation({ db, id: c.id });
}

/**
 * Applies a partial patch to an existing conversation, merging with the current record.
 * Returns null when the conversation does not exist; otherwise returns the updated record.
 * @param db Open SQLite database handle.
 * @param id Conversation id to update.
 * @param patch Fields to overwrite; sessionMode and updatedAt are normalized before persisting.
 */
export function updateConversation({ db, id, patch }: { db: SqliteDb; id: string; patch: DbRow }) {
  const existing = getConversation({ db, id });
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    sessionMode: Object.prototype.hasOwnProperty.call(patch, 'sessionMode')
      ? normalizeConversationSessionMode({ value: patch.sessionMode })
      : existing.sessionMode,
    updatedAt: typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now(),
  };
  db.prepare(
    `UPDATE conversations
        SET title = ?, session_mode = ?, updated_at = ? WHERE id = ?`,
  ).run(merged.title ?? null, merged.sessionMode, merged.updatedAt, id);
  return getConversation({ db, id });
}

/**
 * Removes a conversation row by id. Cascading deletes on messages are handled by the schema.
 * @param db Open SQLite database handle.
 * @param id Conversation id to delete.
 */
export function deleteConversation({ db, id }: { db: SqliteDb; id: string }) {
  db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
}
