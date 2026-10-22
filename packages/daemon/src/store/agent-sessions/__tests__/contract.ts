/** C2 exact pair/overwrite/clear semantics run against every adapter without adapter conditions. */
import { expect, it } from 'vitest';
import type { AgentSessionStore } from '../ports.js';
export interface SessionFixture { store: AgentSessionStore; close(): Promise<void>; }
export function sessionContract(make: () => Promise<SessionFixture>): void {
 it('opaque pair encodings are independent, including ambiguous delimiter pairs',async()=>{
  const f=await make();try{
   expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'c' })).toBeNull();
   await f.store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'first' });await f.store.setSessionId({ conversationId: 'a', agentId: 'b:c', sessionId: 'second' });
   await f.store.setSessionId({ conversationId: 'a:b', agentId: 'other', sessionId: 'third' });
   expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'c' })).toBe('first');
   expect(await f.store.getSessionId({ conversationId: 'a', agentId: 'b:c' })).toBe('second');
   expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'other' })).toBe('third');
   expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'missing' })).toBeNull();
  }finally{await f.close();}
 });
 it('overwrite and idempotent clear affect only the selected pair',async()=>{
  const f=await make();try{
   await f.store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'old' });await f.store.setSessionId({ conversationId: 'a:b', agentId: 'other', sessionId: 'keep' });
   await f.store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'new' });expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'c' })).toBe('new');
   await f.store.clearSessionId({ conversationId: 'a:b', agentId: 'c' });await f.store.clearSessionId({ conversationId: 'a:b', agentId: 'c' });
   expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'c' })).toBeNull();expect(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'other' })).toBe('keep');
  }finally{await f.close();}
 });
 it('concurrent sets leave one complete successor',async()=>{
  const f=await make();try{
   await Promise.all(['x','y','z'].map(id=>f.store.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: id })));
   expect(['x','y','z']).toContain(await f.store.getSessionId({ conversationId: 'a:b', agentId: 'c' }));
  }finally{await f.close();}
 });
}
