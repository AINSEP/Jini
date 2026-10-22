/** Same-kernel composition with run lock before conversation lock, including controlled late save. */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { Fixture } from './fixtures.js';
const SCOPE={scopeId:'ws',ownerKind:'user',ownerId:'alice'} as const;
export function chatTransactionContract({ name, makeFixture }: { name: string; makeFixture: ()=>Promise<Fixture> }){
 describe(`${name} transactions`,()=>{
 let f:Fixture;
 beforeEach(async()=>{f=await makeFixture();});afterEach(async()=>{await f?.close();});
 it('joins the exact kernel transaction so a throwing write rolls back ledger and transcript',async()=>{
  const s=f.make(SCOPE); await s.create({id:'c'});
  await expect(f.kernel.transaction(async()=>{
   await f.kernel.lockKey('run:r');
   await f.kernel.run((db:any)=>db.insertInto('guard').values({id:'r',settled:0}).execute());
   await s.appendMessage({ conversationId: 'c', message: {id:'m',role:'assistant',content:'uncommitted'} });
   throw new Error('abort both');
  })).rejects.toThrow('abort both');
  expect(await s.messages({ conversationId: 'c' })).toEqual([]);
  expect(await f.kernel.run((db:any)=>db.selectFrom('guard').selectAll().execute())).toEqual([]);
 });
 it('controlled terminal settlement prevents a queued late browser save from replacing final text',async()=>{
  const s=f.make(SCOPE);await s.create({id:'c'});
  await f.kernel.run((db:any)=>db.insertInto('guard').values({id:'r',settled:0}).execute());
  let signal!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>{signal=r;});const gate=new Promise<void>(r=>{release=r;});
  const final=f.kernel.transaction(async()=>{
   await f.kernel.lockKey('run:r'); signal();await gate;
   await s.appendMessage({ conversationId: 'c', message: {id:'reply',role:'assistant',content:'terminal',runStatus:'succeeded'} });
   await f.kernel.run((db:any)=>db.updateTable('guard').set({settled:1}).where('id','=','r').execute());
  });
  await entered;
  const late=f.kernel.transaction(async()=>{
   await f.kernel.lockKey('run:r');
   const state=await f.kernel.run((db:any)=>db.selectFrom('guard').select('settled').where('id','=','r').executeTakeFirstOrThrow());
   if(Number(state.settled)===0) await s.appendMessage({ conversationId: 'c', message: {id:'reply',role:'assistant',content:'late draft',runStatus:'running'} });
  });
  release();await Promise.all([final,late]);
  expect((await s.messages({ conversationId: 'c' })).map((m:any)=>[m.content,m.runStatus])).toEqual([['terminal','succeeded']]);
 });
 });
}
