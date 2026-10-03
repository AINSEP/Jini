/** C2 factory validation accepts supported transports, and never opens/configures/closes a host kernel. */
import { expect, it, vi } from 'vitest';
import { createSqliteAgentSessionStore } from '../sqlite.js';
import { createPgliteAgentSessionStore } from '../pglite.js';
import { createPostgresAgentSessionStore } from '../postgres.js';
it.each([
 [createSqliteAgentSessionStore,'sqlite','better-sqlite3'],
 [createPgliteAgentSessionStore,'postgres','pglite'],
 [createPgliteAgentSessionStore,'postgres','pglite-socket'],
 [createPostgresAgentSessionStore,'postgres','node-postgres'],
] as const)('accepts %s on %s/%s without I/O', (create,dialect,transport)=>{
 const run=vi.fn(),execute=vi.fn(),close=vi.fn();
 const store=create({kernel:{dialect,transport,run,execute,close} as any});
 expect(Object.keys(store).sort()).toEqual(['clearSessionId','getSessionId','setSessionId']);
 expect(run).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
});
it.each([createSqliteAgentSessionStore,createPgliteAgentSessionStore,createPostgresAgentSessionStore])('rejects mismatched kernels before I/O',create=>{
 const run=vi.fn(),close=vi.fn();
 expect(()=>create({kernel:{dialect:'wrong',transport:'wrong',run,close} as any})).toThrow('invalid agent session kernel');
 expect(run).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
});

it('query failures retain their cause under the public unavailable error',async()=>{
 const cause=new Error('driver query failed');const run=vi.fn(async()=>{throw cause;});
 const store=createSqliteAgentSessionStore({kernel:{dialect:'sqlite',transport:'better-sqlite3',run} as any});
 for(const action of [()=>store.getSessionId({ conversationId: 'c', agentId: 'a' }),()=>store.setSessionId({ conversationId: 'c', agentId: 'a', sessionId: 's' }),()=>store.clearSessionId({ conversationId: 'c', agentId: 'a' })]){
  await expect(action()).rejects.toMatchObject({name:'AgentSessionStoreError',code:'unavailable',message:'agent session store unavailable',cause});
 }
 expect(run).toHaveBeenCalledTimes(3);
});
