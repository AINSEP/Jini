/** C1 boundaries beyond the characterization suites: generic conflicts and immutable binding. */
import assert from 'node:assert/strict';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { Fixture } from './fixtures.js';
const ALICE = {scopeId:'ws',ownerKind:'user',ownerId:'alice'} as const;
export function chatAdditionalContract({ name, makeFixture }: { name: string; makeFixture: ()=>Promise<Fixture> }){
 describe(`${name} additional invariants`,()=>{
 let f:Fixture;
 beforeEach(async()=>{f=await makeFixture();});afterEach(async()=>{await f?.close();});
 it('copies the owner tuple so mutation cannot rebind a store',async()=>{
  const scope={...ALICE,ownerId:'alice'}; const s=f.make(scope);
  await s.create({id:'alice'}); scope.ownerId='bob';
  await f.make(scope).create({id:'bob'});
  await s.create({id:'still-alice'});
  expect((await s.list()).map((c:{id:string})=>c.id).sort()).toEqual(['alice','still-alice']);
  expect((await f.make(scope).list()).map((c:{id:string})=>c.id)).toEqual(['bob']);
 });
 it('duplicate creates hide the existing owner and preserve their causes',async()=>{
  const s=f.make(ALICE); await s.create({id:'taken'});
  for(const scope of [ALICE,{...ALICE,ownerId:'bob'}]){
   await expect(f.make(scope).create({id:'taken'})).rejects.toMatchObject({name:'ChatStoreError',code:'conflict',message:'Chat store conflict.',cause:expect.any(Error)});
  }
  expect((await s.get({ id: 'taken' }))?.messageCount).toBe(0);
 });
 it('upserts change only the ai_* mutable fields and re-read exactly one projected row',async()=>{
  const s=f.make(ALICE, { nowMs: ()=>42 });await s.create({id:'c'});
  await s.appendMessage({ conversationId: 'c', message: {id:'m',role:'assistant',agentId:'original',agentName:'Original',content:'first',createdAt:11} });
  await s.appendMessage({ conversationId: 'c', message: {id:'second',role:'user',content:'second'} });
  f.resetReadRows();
  const result=await s.appendMessage({ conversationId: 'c', message: {id:'m',role:'user',agentId:'changed',agentName:'Changed',content:'final',createdAt:99,runId:'r',runStatus:'succeeded',startedAt:22,endedAt:33,resumable:true,lastRunEventId:'7'} });
  expect(result).toEqual({id:'m',role:'assistant',agentId:'original',agentName:'Original',content:'final',createdAt:11,runId:'r',runStatus:'succeeded',startedAt:22,endedAt:33});
  expect(f.readRows()).toBe(3); // owner + position + directly written row, no transcript scan
  expect((await s.get({ id: 'c' }))?.messageCount).toBe(2);
 });
 it('malformed optional JSON leaves readable text and no damaged optional values',async()=>{
  const s=f.make(ALICE);await s.create({id:'c'});await s.appendMessage({ conversationId: 'c', message: {id:'m',role:'user',content:'readable'} });
  await f.kernel.run((db)=>db.updateTable('ai_chat_messages').set({events_json:'broken',attachments_json:'{'}).execute());
  const [m]=await s.messages({ conversationId: 'c' });assert.ok(m);expect(m.content).toBe('readable');expect(m.events).toBeUndefined();expect(m.attachments).toBeUndefined();
 });
 it('retention includes equality, cascades, bounds 1..500 and preserves missing expiry',async()=>{
  const s=f.make(ALICE); await s.create({id:'forever'});await s.create({id:'expired',expiresAt:100});
  await s.appendMessage({ conversationId: 'expired', message: {id:'m',role:'user',content:'expired'} });
  for(const limit of [0,501,-1,1.5,NaN]) await expect(f.maintenance.sweepExpired({ now: 100 }, { limit: limit })).rejects.toMatchObject({code:'invalid-input'});
  expect(await f.maintenance.sweepExpired({ now: 99 }, { limit: 1 })).toBe(0);
  expect(await f.maintenance.sweepExpired({ now: 100 }, { limit: 500 })).toBe(1);expect(await f.messageCount()).toBe(0);
  expect((await s.list()).map((c:{id:string})=>c.id)).toEqual(['forever']);
 });
 });
}
