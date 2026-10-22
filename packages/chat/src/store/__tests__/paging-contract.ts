/** C1 paging: exact tuple order, continuation binding, and bounded live views. */
import assert from 'node:assert/strict';
import type { ChatPageCursor } from '../ports.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { Fixture } from './fixtures.js';
const ALICE = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
const BOB = { ...ALICE, ownerId: 'bob' };

export function chatPagingContract({ name, makeFixture }: { name: string; makeFixture: () => Promise<Fixture> }) {
 describe(`${name} paging`, () => {
 let f: Fixture;
 beforeEach(async () => { f = await makeFixture(); });
 afterEach(async () => { await f?.close(); });
 it('provides bounded conversation and message reads on the owner-scoped store', async () => {
  const s = f.make(ALICE, { nowMs: () => 42 });
  expect(typeof s.pageConversations).toBe('function');
  expect(typeof s.pageMessages).toBe('function');
  expect(s.search).toBeUndefined();
 });
 it('pages tied timestamps with UTF-8 ordinal opaque ids, without skips or duplicates', async () => {
  const s = f.make(ALICE, { nowMs: () => 42 });
  const ids = ['a', 'Z', 'é', '😀', '\uE000', '中', "' OR 1=1 --"];
  for (const id of ids) await s.create({ id });
  await f.make(BOB).create({ id: 'foreign', title: 'secret excerpt' });
  let cursor: ChatPageCursor | undefined; const seen: string[] = [];
  do {
   const page = await s.pageConversations({}, { limit: 2, ...(cursor ? { cursor } : {}) });
   expect(page.items.length).toBeLessThanOrEqual(2);
   seen.push(...page.items.map((c) => c.id)); cursor = page.nextCursor;
  } while (cursor);
  expect(seen).toEqual(["' OR 1=1 --", 'Z', 'a', 'é', '中', '\uE000', '😀']);
 });
 it('orders different recencies descending and retains deleted anchor continuations', async () => {
  let ts = 1; const s = f.make(ALICE, { nowMs: () => ts++ });
  for (const id of ['a', 'b', 'c']) await s.create({ id });
  const first = await s.pageConversations({}, { limit: 1 });
  expect(first.items.map((c) => c.id)).toEqual(['c']);
  assert.ok(first.nextCursor);
  await s.delete({ id: 'c' });
  const second = await s.pageConversations({}, { limit: 1, cursor: first.nextCursor });
  expect(second.items.map((c) => c.id)).toEqual(['b']);
  assert.ok(second.nextCursor);
  expect((await s.pageConversations({}, { limit: 1, cursor: second.nextCursor })).items.map((c) => c.id)).toEqual(['a']);
 });
 it('accepts limits 1 and 200, defaults to 50, and refuses invalid bounds', async () => {
  const s = f.make(ALICE, { nowMs: () => 42 });
  for (let i=0;i<201;i++) await s.create({ id: `c${String(i).padStart(3,'0')}` });
  expect((await s.pageConversations({})).items).toHaveLength(50);
  expect((await s.pageConversations({}, {limit:1})).items).toHaveLength(1);
  expect((await s.pageConversations({}, {limit:200})).items).toHaveLength(200);
  // Include null as a malformed runtime input while keeping ChatPageOptions strict.
  for (const limit of [0, 201, -1, 1.5, NaN, Infinity, null]) {
   await expect(Reflect.apply(s.pageConversations,s,[{}, {limit}])).rejects.toMatchObject({name:'ChatStoreError',code:'invalid-input'});
   await expect(Reflect.apply(s.pageMessages,s,[{conversationId:'absent'},{limit}])).rejects.toMatchObject({code:'invalid-input'});
  }
 });
 it('rejects owner, workspace, kind, read-kind and conversation cursor reuse before a data read', async () => {
  const s = f.make(ALICE, { nowMs: () => 42 });
  await s.create({id:'a'}); await s.create({id:'b'});
  for (const id of ['m1','m2']) await s.appendMessage({ conversationId: 'a', message: {id,role:'user',content:id} });
  const c = (await s.pageConversations({}, {limit:1})).nextCursor;
  const m = (await s.pageMessages({conversationId:'a'},{limit:1})).nextCursor;
  assert.ok(c); assert.ok(m);
  const calls = f.readCount();
  for (const scope of [BOB,{...ALICE,scopeId:'other'},{...ALICE,ownerKind:'guest' as const}]) {
   await expect(f.make(scope).pageConversations({}, {cursor:c})).rejects.toMatchObject({code:'invalid-cursor'});
   await expect(f.make(scope).pageMessages({conversationId:'a'},{cursor:m})).rejects.toMatchObject({code:'invalid-cursor'});
  }
  await expect(s.pageMessages({conversationId:'a'},{cursor:c})).rejects.toMatchObject({code:'invalid-cursor'});
  await expect(s.pageConversations({}, {cursor:m})).rejects.toMatchObject({code:'invalid-cursor'});
  await expect(s.pageMessages({conversationId:'b'},{cursor:m})).rejects.toMatchObject({code:'invalid-cursor'});
  for (const cursor of ['', 'nonsense', 'x'.repeat(9000)]) await expect(s.pageConversations({}, {cursor})).rejects.toMatchObject({code:'invalid-cursor'});
  expect(f.readCount()).toBe(calls);
 });
 it('keeps message positions on updates and discovers append after a deleted anchor', async () => {
  const s = f.make(ALICE, { nowMs: () => 42 }); await s.create({id:'c'});
  for (const id of ['z','a','é']) await s.appendMessage({ conversationId: 'c', message: {id,role:'user',content:id,createdAt:42} });
  const first = await s.pageMessages({conversationId:'c'},{limit:1});
  expect(first.items.map((m)=>m.id)).toEqual(['z']);
  assert.ok(first.nextCursor);
  await s.appendMessage({ conversationId: 'c', message: {id:'z',role:'assistant',content:'revised'} });
  await f.deleteMessage('z');
  await s.appendMessage({ conversationId: 'c', message: {id:'new',role:'assistant',content:'new'} });
  const rest = await s.pageMessages({conversationId:'c'},{cursor:first.nextCursor});
  expect(rest.items.map((m)=>[m.id,m.content])).toEqual([['a','a'],['é','é'],['new','new']]);
  expect(rest.nextCursor).toBeUndefined();
 });
 it('unknown and other-owned message pages have exactly the same empty output', async () => {
  const s=f.make(ALICE); await s.create({id:'c'}); await s.appendMessage({ conversationId: 'c', message: {id:'secret',role:'user',content:'private'} });
  for(const id of ['c','absent']) expect(await f.make(BOB).pageMessages({conversationId:id})).toEqual({items:[]});
  expect(await f.make(BOB).pageConversations({})).toEqual({items:[]});
 });
 it('a page selects only limit plus one rows instead of loading the compatibility transcript', async()=>{
  const s=f.make(ALICE); await s.create({id:'c'});
  for (let i=0;i<7;i++) await s.appendMessage({ conversationId: 'c', message: {id:`m${i}`,role:'user',content:'text'} });
  f.resetReadRows();
  const page=await s.pageMessages({conversationId:'c'},{limit:2});
  expect(page.items.map((m)=>m.id)).toEqual(['m0','m1']);
  expect(f.readRows()).toBe(3);
  f.resetReadRows(); await s.pageConversations({}, {limit:1}); expect(f.readRows()).toBe(1);
 });
 });
}
