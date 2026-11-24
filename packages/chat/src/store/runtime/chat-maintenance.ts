import type { StorageKernel } from '@jini-ai/core/contracts/storage';
import type { Kysely } from 'kysely';
import type { ChatDatabase } from '../sql/tables.js';
import type { ChatHistoryMaintenance } from '../ports.js';
import { createSqliteChatMaintenance } from '../sqlite/index.js';
import { createPgliteChatMaintenance } from '../pglite/index.js';
import { createPostgresChatMaintenance } from '../postgres/index.js';

/**
 * Privileged expiry maintenance for whichever dialect the host's borrowed chat kernel uses,
 * selected by its transport. Maintenance authority stays at composition time: hand the result to
 * `sweepExpiredChats`/`startChatExpirySweep`, never to an owner-scoped store, so no request
 * handler can sweep other owners. The selected adapter still validates the dialect.
 * @throws ChatStoreError invalid-input when the kernel's dialect does not match its transport.
 * @complexity O(1); no I/O at construction.
 */
export function createChatMaintenanceForKernel<DB extends ChatDatabase>(
  { kernel }: { kernel: StorageKernel<Kysely<DB>, DB> },
  _optional = {},
): ChatHistoryMaintenance {
  if (kernel.transport === 'better-sqlite3') return createSqliteChatMaintenance({ kernel });
  if (kernel.transport === 'pglite' || kernel.transport === 'pglite-socket') return createPgliteChatMaintenance({ kernel });
  return createPostgresChatMaintenance({ kernel });
}
