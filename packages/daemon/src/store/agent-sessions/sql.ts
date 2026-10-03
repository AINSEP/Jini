/** One simple-session query implementation over the host's borrowed, migrated kernel. */
import { createSystemClock, type Clock } from '@jini-ai/core/primitives';
import type { ColumnType,Kysely } from 'kysely';
import type { StorageKernel,StorageDialect,StorageTransport } from '@jini-ai/db/kernel';
import type { AgentSessionStore } from './ports.js';
import { AgentSessionStoreError } from './errors.js';

/** Hosts can add tables; the adapter requires only this unchanged mapping table. */
export interface AgentSessionDatabase {
 assistant_agent_sessions: {
  conversation_id:string;agent_id:string;session_id:string;
  updated_at:number|string|ColumnType<number|string,number,number>;
 };
}
/** Factory validation is pure; PGlite supports embedded and socket transports. */
export function validateSessionKernel<DB>({ kernel, dialect, transports }: { readonly kernel: StorageKernel<DB>; readonly dialect: StorageDialect; readonly transports: readonly StorageTransport[] }):void {
 if (!kernel || kernel.dialect!==dialect || !transports.includes(kernel.transport)) throw new AgentSessionStoreError({ code: 'invalid-input' });
}
/**
 * The single table-subset projection preserves the original kernel's transaction context.
 * DB's bound proves the required table; this erasure does not bridge separate Kysely versions.
 */
function runSessionQuery<DB extends AgentSessionDatabase,T>(kernel:StorageKernel<DB>,body:(db:Kysely<AgentSessionDatabase>)=>Promise<T>):Promise<T> {
 return kernel.run(db=>body(db as unknown as Kysely<AgentSessionDatabase>));
}
/** Translate opaque driver failures without losing their cause or mutating host state. */
async function atSessionBoundary<T>(operation:()=>Promise<T>):Promise<T> {
 try {return await operation();}
 catch(cause) {throw new AgentSessionStoreError({ code: 'unavailable' }, {cause});}
}
/**
 * Constructs a three-method mapping with no migration, pragma, open, close, or query at construction.
 * All queries join the host kernel's existing transaction; concurrent set is one atomic upsert.
 * @param kernel Borrowed host kernel with assistant_agent_sessions already migrated.
 * @param optional Core Clock, evaluated once per set; defaults to system wall time.
 * @returns Session-id port; missing pairs read null and clear is idempotent.
 * @throws AgentSessionStoreError when a driver/query fails.
 * @complexity Each operation is one primary-key statement, O(log n) index lookup for n pairs.
 */
export function createSqlAgentSessionStore<DB extends AgentSessionDatabase>({ kernel }: { readonly kernel: StorageKernel<DB> }, { clock = createSystemClock() }: { readonly clock?: Clock } = {}):AgentSessionStore {
 return {
  getSessionId({ conversationId, agentId }: { readonly conversationId: string; readonly agentId: string }) {
   return atSessionBoundary(async()=>{
    const row=await runSessionQuery(kernel,db=>db.selectFrom('assistant_agent_sessions').select('session_id')
     .where('conversation_id','=',conversationId).where('agent_id','=',agentId).executeTakeFirst());
    return row?.session_id ?? null;
   });
  },
  setSessionId({ conversationId, agentId, sessionId }: { readonly conversationId: string; readonly agentId: string; readonly sessionId: string }) {
   return atSessionBoundary(async()=>{
    const updatedAt=clock.nowMs();
    await runSessionQuery(kernel,db=>db.insertInto('assistant_agent_sessions')
     .values({conversation_id:conversationId,agent_id:agentId,session_id:sessionId,updated_at:updatedAt})
     .onConflict(oc=>oc.columns(['conversation_id','agent_id']).doUpdateSet({session_id:sessionId,updated_at:updatedAt})).execute());
   });
  },
  clearSessionId({ conversationId, agentId }: { readonly conversationId: string; readonly agentId: string }) {
   return atSessionBoundary(async()=>{await runSessionQuery(kernel,db=>db.deleteFrom('assistant_agent_sessions')
    .where('conversation_id','=',conversationId).where('agent_id','=',agentId).execute());});
  },
 };
}
