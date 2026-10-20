/** Real better-sqlite3 kernel with the host-owned run tables the runtime adapters borrow. */
import { createRequire } from 'node:module';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { ensureChatHistoryTables } from '../../sqlite/index.js';
import type { ChatDatabase, ChatKernel } from '../kernel.js';

const require = createRequire(new URL('../../../../../db/package.json', import.meta.url));
const Database = require('better-sqlite3');

export const RUN_DDL = `
CREATE TABLE assistant_agent_sessions (conversation_id TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (conversation_id, agent_id));
CREATE TABLE assistant_run_attempts (message_id TEXT PRIMARY KEY REFERENCES ai_chat_messages(id) ON DELETE CASCADE, engine TEXT NOT NULL, accepted_json TEXT NOT NULL,
 recovery_count INTEGER NOT NULL, recovery_deadline INTEGER, recovery_elapsed_ms INTEGER NOT NULL, attempt_started_at INTEGER NOT NULL, last_progress_at INTEGER NOT NULL,
 cancel_reason TEXT, session_id TEXT, session_confirmed INTEGER NOT NULL, child_pid INTEGER, child_started_at TEXT, attempt_base_json TEXT NOT NULL);`;

export interface RuntimeFixture {
  kernel: ChatKernel<ChatDatabase>;
  sql(text: string, ...params: unknown[]): void;
  rows<T>(text: string, ...params: unknown[]): T[];
  close(): void;
}

export function runtimeFixture(): RuntimeFixture {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  ensureChatHistoryTables({ db });
  db.exec(RUN_DDL);
  return {
    kernel: sqliteKernel<ChatDatabase>(db),
    sql: (text, ...params) => { db.prepare(text).run(...params); },
    rows: (text, ...params) => db.prepare(text).all(...params),
    close: () => db.close(),
  };
}
