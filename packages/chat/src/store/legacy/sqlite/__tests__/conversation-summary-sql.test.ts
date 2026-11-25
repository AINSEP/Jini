/**
 * Pins the exact SQL text and bind-parameter order the legacy conversation summary query produces
 * (shared by listConversations and getConversation). The query is assembled from named fragments;
 * a refactor of that assembly must keep every byte, because SQLite plan caches and the golden
 * parity with the Open Design daemon key off the statement text.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { getConversation, listConversations } from '../conversations.js';

const GET_SQL = [
  "WITH selected_conversations AS (",
  "          SELECT id, project_id AS projectId, title, session_mode AS sessionMode,",
  "                 created_at AS createdAt, updated_at AS updatedAt",
  "            FROM conversations",
  "           WHERE id = ?",
  "        ),",
  "        latest_runs AS (",
  "          SELECT conversation_id AS conversationId,",
  "                 run_status AS latestRunStatus,",
  "                 started_at AS latestRunStartedAt,",
  "                 ended_at AS latestRunEndedAt,",
  "                 events_json AS latestRunEventsJson",
  "            FROM (",
  "              SELECT m.conversation_id,",
  "                     m.run_status,",
  "                     m.started_at,",
  "                     m.ended_at,",
  "                     m.events_json,",
  "                     ROW_NUMBER() OVER (",
  "                       PARTITION BY m.conversation_id",
  "                       ORDER BY m.position DESC",
  "                     ) AS rn",
  "                FROM messages m",
  "                JOIN selected_conversations c ON c.id = m.conversation_id",
  "               WHERE m.role = 'assistant'",
  "                 AND m.run_status IS NOT NULL",
  "            )",
  "           WHERE rn = 1",
  "        ),",
  "        message_counts AS (",
  "          SELECT m.conversation_id AS conversationId,",
  "                 COUNT(*) AS messageCount",
  "            FROM messages m",
  "            JOIN selected_conversations c ON c.id = m.conversation_id",
  "           GROUP BY m.conversation_id",
  "        ),",
  "        total_run_durations AS (",
  "          SELECT m.conversation_id AS conversationId,",
  "                 SUM(CASE",
  "            WHEN m.started_at IS NOT NULL AND m.ended_at IS NOT NULL THEN",
  "              CASE",
  "                WHEN CAST(m.ended_at AS INTEGER) >= CAST(m.started_at AS INTEGER)",
  "                  THEN CAST(m.ended_at AS INTEGER) - CAST(m.started_at AS INTEGER)",
  "                ELSE 0",
  "              END",
  "            ELSE (",
  "              SELECT CASE",
  "                       WHEN json_extract(usage_event.value, '$.durationMs') >= 0",
  "                         THEN json_extract(usage_event.value, '$.durationMs')",
  "                       ELSE 0",
  "                     END",
  "                FROM json_each(",
  "                  CASE",
  "                    WHEN json_valid(m.events_json) AND json_type(m.events_json) = 'array'",
  "                      THEN m.events_json",
  "                    ELSE '[]'",
  "                  END",
  "                ) AS usage_event",
  "               WHERE usage_event.type = 'object'",
  "                 AND json_extract(usage_event.value, '$.kind') = 'usage'",
  "                 AND json_type(usage_event.value, '$.durationMs') IN ('integer', 'real')",
  "               ORDER BY CAST(usage_event.key AS INTEGER) DESC",
  "               LIMIT 1",
  "            )",
  "          END) AS totalDurationMs",
  "            FROM messages m",
  "            JOIN selected_conversations c ON c.id = m.conversation_id",
  "           WHERE m.role = 'assistant'",
  "             AND m.run_status IN ('succeeded', 'failed', 'canceled')",
  "           GROUP BY m.conversation_id",
  "        )",
  "        SELECT c.id, c.projectId, c.title, c.sessionMode, c.createdAt, c.updatedAt,",
  "               COALESCE(mc.messageCount, 0) AS messageCount,",
  "               lr.latestRunStatus, lr.latestRunStartedAt,",
  "               lr.latestRunEndedAt, lr.latestRunEventsJson,",
  "               trd.totalDurationMs",
  "          FROM selected_conversations c",
  "          LEFT JOIN latest_runs lr ON lr.conversationId = c.id",
  "          LEFT JOIN message_counts mc ON mc.conversationId = c.id",
  "          LEFT JOIN total_run_durations trd ON trd.conversationId = c.id",
].join('\n');

function recordingDb() {
  const prepared: Array<{ sql: string; method: 'all' | 'get'; args: unknown[] }> = [];
  const db = {
    prepare: (sqlText: string) => ({
      all: (...args: unknown[]) => { prepared.push({ sql: sqlText, method: 'all', args }); return []; },
      get: (...args: unknown[]) => { prepared.push({ sql: sqlText, method: 'get', args }); return undefined; },
    }),
  };
  return { db: db as never, prepared };
}

describe('conversationSummarySql pins', () => {
  it('getConversation prepares the exact summary SQL filtered by id and binds only the id', () => {
    const { db, prepared } = recordingDb();
    expect(getConversation({ db, id: 'conv-1' })).toBeNull();
    expect(prepared).toEqual([{ sql: GET_SQL, method: 'get', args: ['conv-1'] }]);
  });

  it('listConversations prepares the same summary filtered by project_id plus the ORDER BY tail, binding only the project id', () => {
    const { db, prepared } = recordingDb();
    expect(listConversations({ db, projectId: 'proj-1' })).toEqual([]);
    expect(prepared).toHaveLength(1);
    const [call] = prepared;
    expect(call!.method).toBe('all');
    expect(call!.args).toEqual(['proj-1']);
    expect(call!.sql).toBe(GET_SQL.replace('WHERE id = ?', 'WHERE project_id = ?') + '\n         ORDER BY c.updatedAt DESC');
    expect(createHash('sha256').update(call!.sql).digest('hex')).toBe('8c17e506244be8337b65e83459dac523264918a3ca061d64a417b69e60d2e0bf');
  });

  it('the id and project_id variants differ only in the filter column', () => {
    const { db, prepared } = recordingDb();
    getConversation({ db, id: 'x' });
    listConversations({ db, projectId: 'x' });
    const [byId, byProject] = prepared;
    expect(byProject!.sql.replace('project_id = ?', 'id = ?').replace('\n         ORDER BY c.updatedAt DESC', '')).toBe(byId!.sql);
  });
});
