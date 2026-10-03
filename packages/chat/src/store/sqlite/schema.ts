/**
 * @module store/sqlite/schema
 *
 * Canonical unchanged DDL for ai_chats and ai_chat_messages. Hosts own their database,
 * migration ledger and connection configuration. A host with migrations retains its frozen
 * migration statements; a fresh fixture or host without a migrator may call the explicit helper.
 * Store construction never invokes it, chooses a file, or sets connection-wide pragmas.
 */
// Separate parent/message tables avoid repeating an owner's credential hash on every message,
// permit an empty "new conversation", and let a list render without loading transcripts.
// Retention then removes one parent and cascades its messages rather than duplicating expiry rules.
import type { SqliteClient } from '@jini-ai/db/sqlite';

/**
 * The canonical chat-history schema.
 *
 * Notes on the parts that are easy to get wrong:
 *
 * - **`scope_id`** is the host's partition key (workspace/tenant/project). It is `NOT NULL` from
 *   the first migration on purpose: adding it later is trivial, but *backfilling* it is not —
 *   pre-existing rows carry no evidence of which partition they belonged to, so a late addition
 *   forces a choice between deleting history and guessing.
 * - **`owner_kind` + the CHECK pair** make "a guest row with a `user_id`" unrepresentable rather
 *   than merely discouraged.
 * - **`owner_id`** holds a user id for `user`, and a *hash* of the session key for `guest`. The
 *   raw token never reaches this table.
 * - **`title_source`** exists so an agent-generated title cannot clobber a manual rename. That
 *   rule is enforced in the store, but it needs a column to be enforceable at all.
 * - **`position`** orders messages, not `created_at`: two inserts inside the same millisecond
 *   are ordinary under concurrent writers, and a tie there corrupts replay order permanently.
 *   `UNIQUE (conversation_id, position)` turns a position-assignment bug into a loud constraint
 *   violation instead of a silently scrambled transcript.
 * - **`expires_at NULL`** means "never expires". The retention sweep filters on
 *   `expires_at IS NOT NULL`, so authenticated history is out of its reach by construction, not
 *   by a predicate that could drift.
 */
export const CHAT_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS ai_chats (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL,
  owner_kind    TEXT NOT NULL CHECK (owner_kind IN ('user','guest')),
  owner_id      TEXT NOT NULL,
  title         TEXT,
  title_source  TEXT NOT NULL DEFAULT 'fallback'
                CHECK (title_source IN ('fallback','generated','manual')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  expires_at    INTEGER
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
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  ended_at        INTEGER,
  UNIQUE (conversation_id, position)
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_order
  ON ai_chat_messages(conversation_id, position);
`;

/**
 * Creates the chat-history tables in the given database if they are absent.
 *
 * Idempotent, matching `ensureToolCatalogTables`'s convention. For a host whose database is
 * managed by its own migration system, prefer copying {@link CHAT_HISTORY_DDL} into a numbered
 * migration instead — see this module's header for why two migrators over one file is a hazard.
 *
 * The caller is responsible for `PRAGMA foreign_keys = ON`; without it the `ON DELETE CASCADE`
 * above is silently inert and deleting a conversation orphans its messages. This function does
 * not set it, because pragmas are connection-wide and a library has no business reconfiguring a
 * handle it was merely lent.
 */
export function ensureChatHistoryTables({ db }: { db: Pick<SqliteClient, 'exec'> }): void {
  db.exec(CHAT_HISTORY_DDL);
}
