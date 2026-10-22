/** C2 borrowed-kernel SQL effects: rollback, FK cascade, deterministic clock and no construction I/O. */
import { expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { AgentSessionDatabase } from '../sql.js';
import type { Clock } from '@jini-ai/core/primitives';
import type { AgentSessionStore } from '../ports.js';
import { sessionContract } from './contract.js';
export interface SqlSessionFixture { kernel: StorageKernel<AgentSessionDatabase>; store:AgentSessionStore; close():Promise<void>; }
export function sqlSessionContract(make:()=>Promise<SqlSessionFixture>,create:(input:{kernel:StorageKernel<AgentSessionDatabase>},options?:{clock?:Clock})=>AgentSessionStore):void {
 sessionContract(make);
 it('shares the injected transaction for insert, overwrite and clear rollback',async()=>{
  const f=await make();try{
   await f.store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'before' });await f.store.setSessionId({ conversationId: 'a:b', agentId: 'keep', sessionId: 'keep' });
   const failure=new Error('abort caller transaction');
   await expect(f.kernel.transaction(async()=>{
    await f.store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'after' });await f.store.clearSessionId({ conversationId: 'a:b', agentId: 'keep' });
    await f.store.setSessionId({ conversationId: 'a', agentId: 'new', sessionId: 'inserted' });throw failure;
   })).rejects.toThrow(failure);
   expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'c' })).toBe('before');expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'keep' })).toBe('keep');
   expect(await f.store.getSessionId({ conversationId: 'a', agentId: 'new' })).toBeNull();
  }finally{await f.close();}
 });
 it('uses assistant_agent_sessions FK and cascades exactly the deleted conversation',async()=>{
  const f=await make();try{
   await expect(f.store.setSessionId({ conversationId: 'unknown', agentId: 'c', sessionId: 'foreign' })).rejects.toThrow();
   await f.store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'first' });await f.store.setSessionId({ conversationId: 'a', agentId: 'b:c', sessionId: 'second' });
   expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'c' })).toBe('first');
   await f.kernel.execute(sql`DELETE FROM ai_chats WHERE id = ${'a:b'}`);
   expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'c' })).toBeNull();expect(await f.store.getSessionId({ conversationId: 'a', agentId: 'b:c' })).toBe('second');
  }finally{await f.close();}
 });
 // REGRESSION: fails if the SQL session factory reads options.now rather than options.clock.nowMs().
 it('construction performs no I/O or ownership changes; writes use the injected clock',async()=>{
  const f=await make();try{
   const run=vi.spyOn(f.kernel,'run'),execute=vi.spyOn(f.kernel,'execute'),close=vi.spyOn(f.kernel,'close');
   const clock: Clock & { time: number } = { time: 4_102_444_800_123, nowMs() { return this.time; } };
   const store=create({kernel:f.kernel},{clock});
   expect(run).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
   await store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'clock' });
   const rows=await f.kernel.query<{updated_at:string|number}>(sql`SELECT updated_at FROM assistant_agent_sessions WHERE conversation_id=${'a:b'} AND agent_id=${'c'}`);
   expect(Number(rows[0]?.updated_at)).toBe(clock.time);
   clock.time += 1;
   await store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'advanced' });
   const advanced=await f.kernel.query<{updated_at:string|number}>(sql`SELECT updated_at FROM assistant_agent_sessions WHERE conversation_id=${'a:b'} AND agent_id=${'c'}`);
   expect(Number(advanced[0]?.updated_at)).toBe(clock.time);
   expect(await store.getSessionId({ conversationId: 'a:b', agentId: 'c' })).toBe('advanced');
  }finally{await f.close();}
 });
 it('concurrent upserts preserve one primary-key row',async()=>{
  const f=await make();try{
   await Promise.all(Array.from({length:12},(_,i)=>f.store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: String(i) })));
   const rows=await f.kernel.query<{n:string|number}>(sql`SELECT COUNT(*) AS n FROM assistant_agent_sessions`);
   expect(Number(rows[0]?.n)).toBe(1);
   expect(Array.from({length:12},(_,i)=>String(i))).toContain(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'c' }));
  }finally{await f.close();}
 });
}
