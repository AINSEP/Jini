import type { UserTextRedactionOptions } from '../../core/user-text-redaction.js';
/** Postgres transcript adapter. The host owns the opened, migrated kernel and its lifetime. */
import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/core/contracts/storage';
import type { ChatDatabase } from '../sql/tables.js';
import type { ChatOwnerScope, ChatStore, ChatHistoryMaintenance } from '../ports.js';
import { createSqlChatStore } from '../sql/store.js';
import { createSqlChatMaintenance } from '../sql/maintenance.js';
import { validateKernel } from '../sql/boundary.js';
import type { Kysely } from 'kysely';
export type { ChatDatabase, AiChatsTable, AiChatMessagesTable } from '../sql/tables.js';

/** Borrow an existing kernel, with no configuration, migration or connection lifecycle effects.
 * @example createPostgresChatStore({ kernel, scope, clock: { nowMs: () => 42 } })
 * @throws ChatStoreError invalid-input for a mismatched dialect/transport or owner scope.
 */
export function createPostgresChatStore<DB extends ChatDatabase>(
  required: { kernel: StorageKernel<Kysely<DB>, DB>; scope: ChatOwnerScope; clock: Clock },
  optional: UserTextRedactionOptions = {},
): ChatStore {
  validateKernel({ kernel: required.kernel, transports: ['node-postgres'], dialect: 'postgres' });
  return createSqlChatStore(required, optional);
}

/** Privileged bounded expiry maintenance; never hand this collaborator to request handlers. */
export function createPostgresChatMaintenance<DB extends ChatDatabase>(required: { kernel: StorageKernel<Kysely<DB>, DB> }): ChatHistoryMaintenance {
  validateKernel({ kernel: required.kernel, transports: ['node-postgres'], dialect: 'postgres' });
  return createSqlChatMaintenance(required);
}
