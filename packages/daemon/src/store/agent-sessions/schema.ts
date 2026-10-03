/** Rich legacy resume-identity table, separate from assistant_agent_sessions. */
export const LEGACY_AGENT_SESSIONS_DDL = `    CREATE TABLE IF NOT EXISTS agent_sessions (
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

`;
