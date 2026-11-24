/** Transport-selected session-id adapter over the host's borrowed, migrated kernel. */
import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/core/contracts/storage';
import type { Kysely } from 'kysely';
import type { AgentSessionStore } from './ports.js';
import type { AgentSessionDatabase } from './sql.js';
import { createSqliteAgentSessionStore } from './sqlite.js';
import { createPgliteAgentSessionStore } from './pglite.js';
import { createPostgresAgentSessionStore } from './postgres.js';

/**
 * Selects the simple session-id adapter by the borrowed kernel's transport, so a host that can open
 * any supported dialect passes its kernel instead of re-implementing this switch. Never calls the
 * rich legacy `agent_sessions` API; uses `assistant_agent_sessions` with the host's FK cascade and
 * the adapters' overwrite/clear semantics. The selected adapter still validates the dialect.
 * @throws AgentSessionStoreError invalid-input when the kernel's dialect does not match its transport.
 * @complexity O(1); no I/O at construction.
 */
export function createAgentSessionStoreForKernel<DB extends AgentSessionDatabase>(
  { kernel, clock }: { kernel: StorageKernel<Kysely<DB>, DB>; clock: Clock },
  _optional = {},
): AgentSessionStore {
  switch (kernel.transport) {
    case 'better-sqlite3': return createSqliteAgentSessionStore({ kernel, clock });
    case 'pglite':
    case 'pglite-socket': return createPgliteAgentSessionStore({ kernel, clock });
    default: return createPostgresAgentSessionStore({ kernel, clock });
  }
}
