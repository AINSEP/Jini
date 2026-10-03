/** C1 cross-connection proof; no single-connection Promise.all substitute. */
import { expect, it } from 'vitest';
import type { Fixture } from './fixtures.js';
const scope={scopeId:'ws',ownerKind:'user',ownerId:'alice'} as const;
export function twoConnectionContract({ name, open }: { name: string; open: ()=>Promise<{a:Fixture;b:Fixture;close():Promise<void>}> }){
 it(`${name}: independent connections serialize gap-free positions`,async()=>{
  const {a,b,close}=await open();
  try{
   const sa=a.make(scope),sb=b.make(scope);await sa.create({id:'c'});
   const saved=await Promise.all(Array.from({length:12},(_,i)=>(i%2?sa:sb).appendMessage({ conversationId: 'c', message: {id:`m${i}`,role:'user',content:`m${i}`} })));
   expect(saved.map(m=>m?.id).sort()).toEqual(Array.from({length:12},(_,i)=>`m${i}`).sort());
   const rows=await a.kernel.run((db:any)=>db.selectFrom('ai_chat_messages').select(['id','position']).orderBy('position').execute());
   expect(rows.map((r:any)=>Number(r.position))).toEqual(Array.from({length:12},(_,i)=>i));
   expect(new Set(rows.map((r:any)=>r.id)).size).toBe(12);
  }finally{await close();}
 });
 it(`${name}: a terminal commit wins over a controlled waiting late save on another connection`,async()=>{
  const {a,b,close}=await open();
  try{
   const sa=a.make(scope),sb=b.make(scope);await sa.create({id:'c'});
   await a.kernel.run((db:any)=>db.insertInto('guard').values({id:'r',settled:0}).execute());
   let entered!:()=>void,release!:()=>void;
   const held=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
   const final=a.kernel.transaction(async()=>{
    await a.kernel.lockKey('run:r');entered();await gate;
    await sa.appendMessage({ conversationId: 'c', message: {id:'reply',role:'assistant',content:'final',runStatus:'succeeded'} });
    await a.kernel.run((db:any)=>db.updateTable('guard').set({settled:1}).where('id','=','r').execute());
   });
   await held;
   const late=b.kernel.transaction(async()=>{
    await b.kernel.lockKey('run:r');
    const r=await b.kernel.run((db:any)=>db.selectFrom('guard').select('settled').where('id','=','r').executeTakeFirstOrThrow());
    if(Number(r.settled)===0) await sb.appendMessage({ conversationId: 'c', message: {id:'reply',role:'assistant',content:'stale'} });
   });
   release();await Promise.all([final,late]);
   expect((await sb.messages({ conversationId: 'c' })).map((m:any)=>[m.content,m.runStatus])).toEqual([['final','succeeded']]);
  }finally{await close();}
 });
}
