/**
 * @module db/agent-sessions
 * Owns the per-(conversation, agent) upstream CLI session cache used by the resume identity guard.
 * Imports only the core/ kernel (types). No other db concern is imported.
 *
 * NOTE (neutral port): no OD-specific columns or logic — every field (session id, prompt hash,
 * model, cwd, last message id) is generic resume-identity bookkeeping already matched 1:1 by the
 * already-ported `schema/migrate.ts` `agent_sessions` table. Ported verbatim aside from
 * de-branding the module doc comment.
 */
import type { SqliteDb } from '@jini-ai/db/sqlite';
import type { DbRow } from '@jini-ai/db/core';

/**
 * Returns the stored upstream CLI session id for a (conversation, agent) pair, or null if none exists.
 * Used as a quick existence check before the full record is needed.
 * @param db - Open SQLite database handle.
 * @param conversationId - Conversation scope for the session.
 * @param agentId - Agent whose session to look up.
 */
export function getAgentSession({ db, conversationId, agentId }: { readonly db: SqliteDb; readonly conversationId: string; readonly agentId: string }
): string | null {
  const row = db
    .prepare(
      `SELECT session_id FROM agent_sessions
        WHERE conversation_id = ? AND agent_id = ?`,
    )
    .get(conversationId, agentId) as DbRow | undefined;
  return row && typeof row.session_id === 'string' ? row.session_id : null;
}

/**
 * Creates or replaces the agent session record for a (conversation, agent) pair.
 * All nullable fields are stored as SQL NULL when omitted, preserving the resume guard's
 * ability to detect staleness via stablePromptHash and lastMessageId.
 * @param db - Open SQLite database handle.
 * @param input - Session fields to persist; conversationId, agentId, and sessionId are required.
 */
export function upsertAgentSession({ db, input }: { readonly db: SqliteDb; readonly input: {
    conversationId: string;
    agentId: string;
    sessionId: string;
    stablePromptHash?: string | null;
    model?: string | null;
    cwd?: string | null;
    lastMessageId?: string | null;
  } }
): void {
  db.prepare(
    `INSERT INTO agent_sessions
       (conversation_id, agent_id, session_id, stable_prompt_hash, model, cwd, last_message_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id, agent_id)
       DO UPDATE SET session_id = excluded.session_id,
                     stable_prompt_hash = excluded.stable_prompt_hash,
                     model = excluded.model,
                     cwd = excluded.cwd,
                     last_message_id = excluded.last_message_id,
                     updated_at = excluded.updated_at`,
  ).run(
    input.conversationId,
    input.agentId,
    input.sessionId,
    input.stablePromptHash ?? null,
    input.model ?? null,
    input.cwd ?? null,
    input.lastMessageId ?? null,
    Date.now(),
  );
}

/**
 * Fetches the full agent session record for a (conversation, agent) pair, or null if absent.
 * Callers that need only the session id should use {@link getAgentSession} instead.
 * @param db - Open SQLite database handle.
 * @param conversationId - Conversation scope for the session.
 * @param agentId - Agent whose session to retrieve.
 */
export function getAgentSessionRecord({ db, conversationId, agentId }: { readonly db: SqliteDb; readonly conversationId: string; readonly agentId: string }
): {
  sessionId: string;
  stablePromptHash: string | null;
  model: string | null;
  cwd: string | null;
  lastMessageId: string | null;
} | null {
  const row = db
    .prepare(
      `SELECT session_id, stable_prompt_hash, model, cwd, last_message_id FROM agent_sessions
        WHERE conversation_id = ? AND agent_id = ?`,
    )
    .get(conversationId, agentId) as DbRow | undefined;
  if (!row || typeof row.session_id !== 'string') return null;
  return {
    sessionId: row.session_id,
    stablePromptHash:
      typeof row.stable_prompt_hash === 'string' ? row.stable_prompt_hash : null,
    model: typeof row.model === 'string' ? row.model : null,
    cwd: typeof row.cwd === 'string' ? row.cwd : null,
    lastMessageId: typeof row.last_message_id === 'string' ? row.last_message_id : null,
  };
}

// Conversation cursor for the resume identity guard: the id of the latest
// COMPLETED assistant message in the conversation, EXCLUDING the current run's
// in-flight placeholder (`excludeMessageId`). At resolve time the session is in
// sync iff this equals the assistant message the session last produced —
// otherwise another agent completed a turn in between, or the session's own last
// message was edited/removed, and the session is behind. Returns null when there
// is no prior completed assistant turn.
//
// "Completed" means run_status = 'succeeded' — a run stamps its assistant
// message with the terminal status on finish, so an intervening agent run that
// FAILED or was CANCELED leaves a placeholder that produced no completed turn;
// counting it as advancement would force a needless cold reseed (silently
// disabling the resume perf path) even though the stored session is still the
// latest completed turn. In-flight placeholders have a null run_status and are
// likewise excluded.
//
// `resumableMessageId` is the one allowed exception: a resume-on-failure path
// may persist a session whose own last assistant turn FAILED transiently (the
// CLI session already committed a tool/artifact block and is resumable). That
// stored id is admitted through the filter so the session it owns still matches
// its cursor — while a DIFFERENT later failed/canceled turn (a different id)
// stays excluded, so genuine advancement by a later succeeded turn is still
// detected.
/**
 * Returns the conversation cursor used by the resume identity guard: the id of the most recent
 * completed (succeeded) assistant message, excluding the current in-flight placeholder.
 * See the inline comment above for the full invariant and the resumableMessageId exception.
 * @param db - Open SQLite database handle.
 * @param conversationId - Conversation to inspect.
 * @param excludeMessageId - The in-flight run's own placeholder message id to skip.
 * @param resumableMessageId - Optional id of a transiently-failed session's last message, admitted through the succeeded-only filter.
 * @returns The matching message id, or null if no prior completed turn exists.
 */
export function latestCompletedAssistantMessageId({ db, conversationId, excludeMessageId }: { readonly db: SqliteDb; readonly conversationId: string; readonly excludeMessageId: string }, { resumableMessageId = null }: { readonly resumableMessageId?: string | null } = {}
): string | null {
  const row = db
    .prepare(
      `SELECT id FROM messages
        WHERE conversation_id = ? AND role = 'assistant' AND id != ?
          AND (run_status = 'succeeded' OR id = ?)
        ORDER BY position DESC LIMIT 1`,
    )
    .get(conversationId, excludeMessageId, resumableMessageId) as DbRow | undefined;
  return row && typeof row.id === 'string' ? row.id : null;
}

/**
 * Updates the stable prompt hash for an existing agent session without touching other fields.
 * Called after the resume path confirms the prompt context is still stable, recording the
 * current hash so future identity checks can compare against it.
 * @param db - Open SQLite database handle.
 * @param conversationId - Conversation scope for the session.
 * @param agentId - Agent whose session to update.
 * @param stablePromptHash - The new prompt hash to record.
 */
export function updateAgentSessionStableHash({ db, conversationId, agentId, stablePromptHash }: { readonly db: SqliteDb; readonly conversationId: string; readonly agentId: string; readonly stablePromptHash: string }
): void {
  db.prepare(
    `UPDATE agent_sessions SET stable_prompt_hash = ?, updated_at = ?
      WHERE conversation_id = ? AND agent_id = ?`,
  ).run(stablePromptHash, Date.now(), conversationId, agentId);
}

/**
 * Deletes the agent session record for a (conversation, agent) pair.
 * Forces the next run to start a fresh upstream CLI session rather than attempting resume.
 * @param db - Open SQLite database handle.
 * @param conversationId - Conversation scope for the session.
 * @param agentId - Agent whose session to clear.
 */
export function clearAgentSession({ db, conversationId, agentId }: { readonly db: SqliteDb; readonly conversationId: string; readonly agentId: string }
): void {
  db.prepare(
    `DELETE FROM agent_sessions WHERE conversation_id = ? AND agent_id = ?`,
  ).run(conversationId, agentId);
}

export { LEGACY_AGENT_SESSIONS_DDL } from './schema.js';

import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { AgentSessionStore } from './ports.js';
import { createSqlAgentSessionStore, validateSessionKernel, type AgentSessionDatabase } from './sql.js';
export type { AgentSessionDatabase } from './sql.js';
/** Simple session-id mapping over a borrowed, migrated kernel; optional core Clock defaults to wall time. */
export function createSqliteAgentSessionStore<DB extends AgentSessionDatabase>(input:{kernel:StorageKernel<DB>},options:{clock?:Clock}={}):AgentSessionStore {
 validateSessionKernel({ kernel: input.kernel, dialect: 'sqlite', transports: ['better-sqlite3'] });
 return createSqlAgentSessionStore({ kernel: input.kernel }, options);
}
