
import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { AgentSessionStore } from './ports.js';
import { createSqlAgentSessionStore, validateSessionKernel, type AgentSessionDatabase } from './sql.js';
export type { AgentSessionDatabase } from './sql.js';
/** Simple session-id mapping over a borrowed, migrated kernel; the host supplies the core Clock. */
export function createPgliteAgentSessionStore<DB extends AgentSessionDatabase>(input:{kernel:StorageKernel<DB>;clock:Clock},_optional={}):AgentSessionStore {
 validateSessionKernel({ kernel: input.kernel, dialect: 'postgres', transports: ['pglite','pglite-socket'] });
 return createSqlAgentSessionStore({ kernel: input.kernel, clock: input.clock });
}
