/** Unchanged legacy local-chat tables; explicitly bootstrapped by server storage. */
export const LEGACY_CHAT_DDL = `    CREATE TABLE IF NOT EXISTS conversations (
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
  `;
