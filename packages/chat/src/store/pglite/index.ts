/** Pglite transcript adapter. The host owns the opened, migrated kernel and its lifetime. */
import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { ChatDatabase } from '../sql/tables.js';
import type { ChatOwnerScope, ChatStore, ChatHistoryMaintenance } from '../ports.js';
import { createSqlChatStore } from '../sql/store.js';
import { createSqlChatMaintenance } from '../sql/maintenance.js';
import { validateKernel } from '../sql/boundary.js';
export type { ChatDatabase, AiChatsTable, AiChatMessagesTable } from '../sql/tables.js';

/** Borrow an existing kernel, with no configuration, migration or connection lifecycle effects.
 * @example createPgliteChatStore({ kernel, scope }, { clock: { nowMs: () => 42 } })
 * @throws ChatStoreError invalid-input for a mismatched dialect/transport or owner scope.
 */
export function createPgliteChatStore<DB extends ChatDatabase>(
  required: { kernel: StorageKernel<DB>; scope: ChatOwnerScope },
  optional: { clock?: Clock } = {},
): ChatStore {
  validateKernel({ kernel: required.kernel, transports: ['pglite', 'pglite-socket'], dialect: 'postgres' });
  return createSqlChatStore(required, optional);
}

/** Privileged bounded expiry maintenance; never hand this collaborator to request handlers. */
export function createPgliteChatMaintenance<DB extends ChatDatabase>(required: { kernel: StorageKernel<DB> }): ChatHistoryMaintenance {
  validateKernel({ kernel: required.kernel, transports: ['pglite', 'pglite-socket'], dialect: 'postgres' });
  return createSqlChatMaintenance(required);
}
