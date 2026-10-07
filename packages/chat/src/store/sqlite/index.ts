import type { UserTextRedactionOptions } from '../../core/user-text-redaction.js';
/** Sqlite transcript adapter. The host owns the opened, migrated kernel and its lifetime. */
// Use this owner-bound store for shared databases: legacy/sqlite conversations filter by
// project_id with no owner predicate and assume a single-user local trust model.
import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { ChatDatabase } from '../sql/tables.js';
import type { ChatOwnerScope, ChatStore, ChatHistoryMaintenance } from '../ports.js';
import { createSqlChatStore } from '../sql/store.js';
import { createSqlChatMaintenance } from '../sql/maintenance.js';
import { validateKernel } from '../sql/boundary.js';
export type { ChatDatabase, AiChatsTable, AiChatMessagesTable } from '../sql/tables.js';

/** Borrow an existing kernel, with no configuration, migration or connection lifecycle effects.
 * @example createSqliteChatStore({ kernel, scope }, { clock: { nowMs: () => 42 } })
 * @throws ChatStoreError invalid-input for a mismatched dialect/transport or owner scope.
 */
export function createSqliteChatStore<DB extends ChatDatabase>(
  required: { kernel: StorageKernel<DB>; scope: ChatOwnerScope },
  optional: { clock?: Clock } & UserTextRedactionOptions = {},
): ChatStore {
  validateKernel({ kernel: required.kernel, transports: ['better-sqlite3'], dialect: 'sqlite' });
  return createSqlChatStore(required, optional);
}

/** Privileged bounded expiry maintenance; never hand this collaborator to request handlers. */
export function createSqliteChatMaintenance<DB extends ChatDatabase>(required: { kernel: StorageKernel<DB> }): ChatHistoryMaintenance {
  validateKernel({ kernel: required.kernel, transports: ['better-sqlite3'], dialect: 'sqlite' });
  return createSqlChatMaintenance(required);
}

import { sqliteKernel, type SqliteConnectionSource } from '@jini-ai/db/kernel/sqlite';
export { CHAT_HISTORY_DDL, ensureChatHistoryTables } from './schema.js';

/** Compatibility wrapper over db's memoized kernel; joins the exact raw-handle kernel context.
 * @example createChatHistoryStore({ db, scope }, { clock: { nowMs: () => 42 } })
 */
export function createChatHistoryStore({ db, scope }: { db: SqliteConnectionSource; scope: ChatOwnerScope }, optional: { clock?: Clock } & UserTextRedactionOptions = {}): ChatStore {
  return createSqliteChatStore({ kernel: sqliteKernel<ChatDatabase>(db), scope }, optional);
}

/** Compatibility retention wrapper; the caller still owns the handle and its configuration. */
export function createChatHistoryMaintenance({ db }: { db: SqliteConnectionSource }): ChatHistoryMaintenance {
  return createSqliteChatMaintenance({ kernel: sqliteKernel<ChatDatabase>(db) });
}
