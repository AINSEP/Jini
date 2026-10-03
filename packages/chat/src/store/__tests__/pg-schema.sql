
CREATE TABLE IF NOT EXISTS ai_chats (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL,
  owner_kind    TEXT NOT NULL CHECK (owner_kind IN ('user','guest')),
  owner_id      TEXT NOT NULL,
  title         TEXT,
  title_source  TEXT NOT NULL DEFAULT 'fallback'
                CHECK (title_source IN ('fallback','generated','manual')),
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  expires_at    BIGINT
);

CREATE INDEX IF NOT EXISTS idx_ai_chats_owner
  ON ai_chats(scope_id, owner_kind, owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_chats_expiry
  ON ai_chats(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  agent_id        TEXT,
  agent_name      TEXT,
  events_json     TEXT,
  attachments_json TEXT,
  run_id          TEXT,
  run_status      TEXT,
  position        INTEGER NOT NULL,
  created_at      BIGINT NOT NULL,
  started_at      BIGINT,
  ended_at        BIGINT,
  UNIQUE (conversation_id, position)
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_order
  ON ai_chat_messages(conversation_id, position);
