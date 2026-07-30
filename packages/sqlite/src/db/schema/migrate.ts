/** @module db/schema/migrate
 * DDL for the daemon's SQLite database — creates the generic engine tables and indexes.
 * Imports only `core/`.
 *
 * NOTE (neutral port): ported from the upstream daemon's decomposed `db/schema` barrel. Two
 * deliberate changes: (1) OD-product tables (preview_comments, tabs, deployments, routines,
 * templates) and their per-feature migrators (critique, media/tasks, library-store, plugins)
 * are excluded — they belong in a consumer adapter, not the neutral engine; (2) OD's
 * forward-compatible `ALTER TABLE … ADD COLUMN` machinery (migrating pre-existing OD databases)
 * is dropped — Jini is greenfield, so every column lives in the base `CREATE`.
 *
 * `capability_definitions`/`capability_executions` were added 2026-07-24 (the SQLite half of
 * `ai-control-plane.md` §9's proposed capability catalog) and removed 2026-07-25: they had zero
 * consumers, so `migrate()` was creating two tables in every daemon's database that nothing read
 * or wrote. The registry (`@jini-ai/daemon`'s `ToolRegistry`) is the catalog until search-at-scale is
 * a real requirement, and `capability_executions` duplicated `ToolExecutionAuditRecord`
 * (`packages/daemon/src/tool-executor.ts`) in a strictly weaker shape — no `principalId`, no
 * `runId`, no per-phase event log. When the audit trail needs durability, back *that* record here
 * so there is one audit noun, rather than reviving a parallel one.
 */
import type { SqliteDb } from '../core/index.js';

/**
 * Idempotent schema bootstrap: creates the generic tables and indexes.
 * Safe to call repeatedly (all statements are `IF NOT EXISTS`).
 * Must be called once after `openDatabase`.
 * @param db - the open better-sqlite3 handle to migrate
 */
export function migrate(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pending_prompt TEXT,
      metadata_json TEXT,
      custom_instructions TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT,
      session_mode TEXT NOT NULL DEFAULT 'design',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conv_project
      ON conversations(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_sessions (
      conversation_id TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      stable_prompt_hash TEXT,
      -- Resume identity guard: the session is only safe to resume when the
      -- conversation has not changed shape under it. model/cwd are the runtime
      -- identity the upstream session was created with; a change forces a fresh
      -- session. last_message_id is the assistant message this session produced
      -- on its last turn -- if it is no longer the latest completed assistant
      -- turn (another agent ran in between, or it was edited away), the session
      -- is behind and we reseed the full transcript.
      model           TEXT,
      cwd             TEXT,
      last_message_id TEXT,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, agent_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      agent_id TEXT,
      agent_name TEXT,
      events_json TEXT,
      attachments_json TEXT,
      run_context_json TEXT,
      session_mode TEXT,
      run_id TEXT,
      run_status TEXT,
      last_run_event_id TEXT,
      telemetry_finalized_at INTEGER,
      started_at INTEGER,
      ended_at INTEGER,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv
      ON messages(conversation_id, position);
  `);
}
