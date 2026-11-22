
import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/core/contracts/storage';
import type { AgentSessionStore } from './ports.js';
import { createSqlAgentSessionStore, validateSessionKernel, type AgentSessionDatabase } from './sql.js';
import type { Kysely } from 'kysely';
export type { AgentSessionDatabase } from './sql.js';
/** Simple session-id mapping over a borrowed, migrated kernel; the host supplies the core Clock. */
export function createPostgresAgentSessionStore<DB extends AgentSessionDatabase>(input:{kernel:StorageKernel<Kysely<DB>, DB>;clock:Clock},_optional={}):AgentSessionStore {
 validateSessionKernel({ kernel: input.kernel, dialect: 'postgres', transports: ['node-postgres'] });
 return createSqlAgentSessionStore({ kernel: input.kernel, clock: input.clock });
}
